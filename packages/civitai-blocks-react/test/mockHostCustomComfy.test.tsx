import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBuzzWorkflow, WorkflowSubmitError } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport, disallowedAccountError } from '../src/testing.js';

/**
 * customComfy coverage for `createMockHost`: the `{ kind:'customComfy', recipe,
 * params }` arm of the {@link WorkflowBody} discriminated union flows through the
 * SAME kind-agnostic money path as `textToImage` (estimate → submit → poll →
 * terminal), so a scaffolded App Block's `dev:harness` loop + unit/e2e tests can
 * exercise a customComfy sample generation with NO backend. Mirrors
 * `mockHostScenarios.test.tsx` (the textToImage generation-scenario suite) — the
 * mock must honor the identical `generation` / `buzz` scenario config for both
 * kinds and must NOT validate the (server-only) recipe registry. Exercised
 * against the REAL SDK hooks + transport.
 */

const ORIGIN = window.location.origin;

/**
 * A customComfy recipe body. `recipe` is an arbitrary registered-recipe id — the
 * mock stands in for the server and MUST accept any id (the recipe registry is
 * server-only). `params.accountType` is where the preferred Buzz pool lives on a
 * customComfy body (vs the top-level `accountType` on a textToImage body).
 */
const COMFY_BODY = {
  kind: 'customComfy' as const,
  recipe: 'seamless-pano-360',
  params: { prompt: 'a misty forest, 360 panorama' },
};

/** Drive submit → poll(×n) to a terminal state and return the snapshot. */
async function runComfyGen(
  result: { current: ReturnType<typeof useBuzzWorkflow> },
  body: typeof COMFY_BODY = COMFY_BODY,
  polls = 1,
) {
  let snap!: {
    workflowId: string;
    status: string;
    error?: string;
    cost?: { total: number };
    imageUrls?: string[];
    spentAccountType?: string;
  };
  await act(async () => {
    snap = (await result.current.submit(body)) as typeof snap;
  });
  if (snap.status === 'failed') return snap;
  for (let i = 0; i < polls; i += 1) {
    await act(async () => {
      snap = (await result.current.poll(snap.workflowId)) as typeof snap;
    });
    if (snap.status === 'succeeded' || snap.status === 'failed') break;
  }
  return snap;
}

/**
 * Submit a customComfy body and expect a REJECTION — the
 * civitai/civitai-app-starters#251 arm. A failure-shaped reply with NO price
 * means the submit ERRORED (the host's `failureSnapshot(err)`), so `submit()`
 * rejects instead of handing back a workflow that was never queued. The kind
 * -agnostic contract this file exists to pin extends to that arm too.
 */
async function comfySubmitExpectingRejection(
  result: { current: ReturnType<typeof useBuzzWorkflow> },
  body: typeof COMFY_BODY = COMFY_BODY,
): Promise<WorkflowSubmitError> {
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.submit(body).then(
      (snap) => ({ unexpectedlyResolved: snap }),
      (err) => err,
    );
  });
  expect(outcome).toBeInstanceOf(WorkflowSubmitError);
  return outcome as WorkflowSubmitError;
}

describe('createMockHost — customComfy generation', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  it('estimate returns a cost for a customComfy body (non-empty sentinel workflowId survives the inbound validator)', async () => {
    // A plausible fixed display estimate (~15-20 Buzz) via the shared costPerGen
    // knob — no customComfy-specific config surface.
    uninstall = createMockHost({ generation: { costPerGen: 17 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      await result.current.estimate(COMFY_BODY);
    });
    // The snapshot survived the SDK inbound validator (which drops empty-workflowId
    // snapshots) → the cost landed.
    await waitFor(() => expect(result.current.result?.cost?.total).toBe(17));
    expect(result.current.result?.workflowId).toBeTruthy();
  });

  it('estimate returns the default cost when no scenario cost is configured', async () => {
    uninstall = createMockHost({ pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      await result.current.estimate(COMFY_BODY);
    });
    await waitFor(() => expect(typeof result.current.result?.cost?.total).toBe('number'));
    // Default legacy cost (8) — a cost is always returned.
    expect(result.current.result?.cost?.total).toBe(8);
  });

  it('submit → poll → succeeded carries an image url + cost', async () => {
    uninstall = createMockHost({ generation: { costPerGen: 17 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runComfyGen(result);
    expect(snap.status).toBe('succeeded');
    expect(snap.cost?.total).toBe(17);
    // Default synthetic result: a single prominently-labeled MOCK placeholder.
    expect(snap.imageUrls?.length).toBeGreaterThan(0);
    expect(snap.imageUrls?.[0]).toContain('text=MOCK');
  });

  it('costPerGen as a function receives the full customComfy body (recipe reaches costFor)', async () => {
    uninstall = createMockHost({
      generation: {
        costPerGen: (req) => (req.kind === 'customComfy' && req.recipe === 'seamless-pano-360' ? 19 : 3),
      },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runComfyGen(result);
    expect(snap.cost?.total).toBe(19);
  });

  it('custom images appear on the succeeded customComfy snapshot', async () => {
    uninstall = createMockHost({
      generation: { images: ['https://example.test/pano.png'] },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runComfyGen(result);
    expect(snap.status).toBe('succeeded');
    expect(snap.imageUrls).toEqual(['https://example.test/pano.png']);
  });

  it('accepts ANY recipe id without registry validation (the registry is server-only)', async () => {
    uninstall = createMockHost({ pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // A totally-made-up recipe id must still succeed — the mock never resolves it
    // against a registry (fail-open, unlike the real fail-closed server).
    const snap = await runComfyGen(result, {
      kind: 'customComfy' as const,
      recipe: 'totally-made-up-recipe-xyz',
      params: { prompt: 'anything' },
    });
    expect(snap.status).toBe('succeeded');
  });

  // ---- scenario config applies identically to customComfy ----

  it('failNext rejects the first customComfy submit then succeeds', async () => {
    uninstall = createMockHost({ generation: { failNext: 1 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await comfySubmitExpectingRejection(result);
    expect(err.code).toBe('exception');
    expect(err.snapshot.error).toMatch(/simulated/i);

    const second = await runComfyGen(result);
    expect(second.status).toBe('succeeded');
  });

  it('failRate 1 always rejects a customComfy submit', async () => {
    uninstall = createMockHost({ generation: { failRate: 1 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await comfySubmitExpectingRejection(result);
    expect(err.code).toBe('exception');
  });

  // The errored-submit producer is kind-agnostic too (#251).
  it('failSubmitException rejects a customComfy submit with the failureSnapshot shape', async () => {
    uninstall = createMockHost({
      generation: { failSubmitException: true, failSubmitExceptionMessage: 'graph rejected' },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await comfySubmitExpectingRejection(result);
    expect(err.code).toBe('exception');
    expect(err.snapshot.error).toBe('graph rejected');
    expect(err.snapshot.cost).toBeUndefined();
  });

  it('a simulated balance that cannot cover the gen fails customComfy with insufficient-Buzz', async () => {
    uninstall = createMockHost({
      buzz: { balance: 5 },
      generation: { costPerGen: 17 },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runComfyGen(result);
    expect(snap.status).toBe('failed');
    expect(snap.error).toMatch(/insufficient buzz/i);
  });

  it('buzz.insufficient forces the insufficient path for customComfy regardless of balance', async () => {
    uninstall = createMockHost({
      buzz: { balance: 1000, insufficient: true },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runComfyGen(result);
    expect(snap.status).toBe('failed');
    expect(snap.error).toMatch(/insufficient buzz/i);
  });

  it('debits the simulated balance on a successful customComfy gen', async () => {
    host = createMockHost({ buzz: { balance: 40 }, generation: { costPerGen: 17 }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await runComfyGen(result);
    expect(host.buzz.getBalance()).toBe(23);
  });

  it('stamps spentAccountType from the customComfy params.accountType (pick-aware)', async () => {
    // Default wallet is yellow-dominant → the pick-blind stamp would be 'yellow'.
    // A customComfy body carries its preferred pool under params.accountType; a
    // pick of 'green' must win.
    uninstall = createMockHost({ pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runComfyGen(result, {
      kind: 'customComfy' as const,
      recipe: 'seamless-pano-360',
      params: { prompt: 'a misty forest', accountType: 'green' },
    });
    expect(snap.status).toBe('succeeded');
    expect(snap.spentAccountType).toBe('green');
  });

  it('rejects a disallowed customComfy params.accountType with the real backend message', async () => {
    uninstall = createMockHost({ disallowedAccountTypes: ['yellow'], pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await comfySubmitExpectingRejection(result, {
      kind: 'customComfy' as const,
      recipe: 'seamless-pano-360',
      params: { prompt: 'a misty forest', accountType: 'yellow' },
    });
    expect(err.code).toBe('exception');
    expect(err.snapshot.error).toBe(disallowedAccountError('yellow'));
  });
});
