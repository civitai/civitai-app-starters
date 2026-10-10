import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppWorkflow, BlockGatedImage } from '@civitai/app-sdk/blocks';

import { useBlockContext } from '../src/hooks/useBlockContext.js';
import { useBuzzWorkflow, WorkflowSubmitError } from '../src/hooks/useBuzzWorkflow.js';
import { useResourcePicker } from '../src/hooks/useResourcePicker.js';
import { useRequestConsent } from '../src/hooks/useRequestConsent.js';
import { useBlockToken } from '../src/hooks/useBlockToken.js';
import { useAppWorkflows } from '../src/hooks/useAppWorkflows.js';
import { useGatedImages } from '../src/hooks/useGatedImages.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Exercises `createMockHost` end-to-end against the REAL SDK hooks + transport.
 * The mock host fires its replies from `window.location.origin`, so the
 * transport's allowlist must include that origin (mirrors the dev-harness
 * requirement). Mirrors the useBuzzWorkflow / useResourcePicker scaffolds.
 */

// The mock host fires replies from window.location.origin, so the transport's
// allowlist must include it (mirrors the dev-harness requirement). Read it
// dynamically so the test isn't coupled to the happy-dom default.
const ORIGIN = window.location.origin;

const TEXT_BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat' },
};

describe('createMockHost', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    // The transport must accept messages from the mock host's origin.
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it('delivers BLOCK_INIT with the configured viewer + page context', async () => {
    uninstall = createMockHost({ viewer: { id: 42, username: 'tester', status: 'active' } }).install();
    const { result } = renderHook(() => useBlockContext());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.context?.slotId).toBe('app.page');
    expect(result.current.viewer).toEqual({ id: 42, username: 'tester', status: 'active' });
  });

  it('delivers an anon BLOCK_INIT when viewer is null', async () => {
    uninstall = createMockHost({ viewer: null }).install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.viewer).toBeNull();
  });

  it('estimate→submit→poll resolves to a succeeded snapshot with image + cost', async () => {
    uninstall = createMockHost({ pollsUntilDone: 2, cost: 12 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    // Wait for init so the transport flushes outbound to the mock host.
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      await result.current.estimate(TEXT_BODY);
    });
    await waitFor(() => expect(result.current.status).toBe('confirming'));
    expect(result.current.result?.cost?.total).toBe(12);

    await act(async () => {
      await result.current.submit(TEXT_BODY);
    });
    await waitFor(() => expect(result.current.status).toBe('polling'));

    // First poll → processing (pollsUntilDone=2), second → succeeded.
    await act(async () => {
      await result.current.poll(result.current.result!.workflowId);
    });
    expect(result.current.status).toBe('polling');

    await act(async () => {
      await result.current.poll(result.current.result!.workflowId);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result?.cost?.total).toBe(12);
    expect(result.current.result?.imageUrls?.[0]).toContain('placehold.co');
  });

  it('failMode "all" REJECTS submit as out of Buzz (exception, no cost), as production does', async () => {
    uninstall = createMockHost({ consentGranted: true, failMode: 'all' }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit(TEXT_BODY).then(
        (snap) => ({ unexpectedlyResolved: snap }),
        (err) => err,
      );
    });
    expect(outcome).toBeInstanceOf(WorkflowSubmitError);
    const err = outcome as WorkflowSubmitError;
    expect(err.code).toBe('exception');
    expect(err.snapshot.cost).toBeUndefined();
    expect(err.snapshot.error).toMatch(/insufficient buzz/i);
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('OPEN_RESOURCE_PICKER returns the canned LoRA pick', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown;
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA' });
    });
    expect(picked).toMatchObject({ modelType: 'LORA', baseModel: 'SDXL 1.0' });
  });

  it('OPEN_RESOURCE_PICKER resolves null when the canned pick is dismissed', async () => {
    uninstall = createMockHost({ cannedPicks: { LORA: null } }).install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown = 'unset';
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA' });
    });
    expect(picked).toBeNull();
  });

  it('OPEN_RESOURCE_PICKER with `multiple` returns the default two LoRAs, in order', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown;
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA', multiple: { max: 3 } });
    });
    expect((picked as { versionId: number; modelName: string }[]).map((p) => [p.versionId, p.modelName])).toEqual([
      [666002, 'Sinfully Stylish'],
      [777003, 'Ink Wash Lines'],
    ]);
  });

  it('OPEN_RESOURCE_PICKER with `multiple` cuts the canned list to `max`, keeping order', async () => {
    const pick = (versionId: number) => ({
      versionId,
      modelId: versionId + 1,
      modelName: `L${versionId}`,
      versionName: 'v1',
      baseModel: 'SDXL 1.0',
      modelType: 'LORA',
    });
    uninstall = createMockHost({ cannedMultiPicks: [pick(30), pick(10), pick(20), pick(40)] }).install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown;
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA', multiple: { max: 3 } });
    });
    expect((picked as { versionId: number }[]).map((p) => p.versionId)).toEqual([30, 10, 20]);
  });

  it('OPEN_RESOURCE_PICKER with `multiple` caps at 5 even when more are canned and asked for', async () => {
    const pick = (versionId: number) => ({
      versionId,
      modelId: versionId + 1,
      modelName: `L${versionId}`,
      versionName: 'v1',
      baseModel: 'SDXL 1.0',
      modelType: 'LORA',
    });
    uninstall = createMockHost({
      cannedMultiPicks: [7, 6, 5, 4, 3, 2, 1].map(pick),
    }).install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown;
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA', multiple: { max: 9 } });
    });
    expect((picked as { versionId: number }[]).map((p) => p.versionId)).toEqual([7, 6, 5, 4, 3]);
  });

  it.each([
    ['cannedMultiPicks: null', { cannedMultiPicks: null }],
    ['cannedMultiPicks: []', { cannedMultiPicks: [] }],
    ['cannedPicks.LORA: null (one dismiss setting covers both modes)', { cannedPicks: { LORA: null } }],
  ])('OPEN_RESOURCE_PICKER with `multiple` resolves [] when dismissed — %s', async (_, options) => {
    uninstall = createMockHost(options).install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown = 'unset';
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA', multiple: { max: 2 } });
    });
    expect(picked).toEqual([]);
  });

  it('the mock REFUSES a raw `multiple` + Checkpoint request with an error, like the host', async () => {
    uninstall = createMockHost().install();
    renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // The hook refuses this before sending, so post the raw message a
    // hand-rolled client would, and read the mock's raw reply.
    const replies: unknown[] = [];
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: unknown };
      if (d?.type === 'RESOURCE_PICKER_RESULT') replies.push(d.payload);
    };
    window.addEventListener('message', onMessage);
    try {
      window.parent.postMessage(
        {
          type: 'OPEN_RESOURCE_PICKER',
          payload: { requestId: 'raw-ckpt-multi', resourceType: 'Checkpoint', multiple: { max: 2 } },
        },
        '*',
      );
      await waitFor(() => expect(replies).toHaveLength(1));
      expect(replies[0]).toEqual({
        requestId: 'raw-ckpt-multi',
        error:
          'OPEN_RESOURCE_PICKER: multiple is only supported for LoRA-family resource types, not Checkpoint.',
      });
    } finally {
      window.removeEventListener('message', onMessage);
    }
  });

  it('consent round-trip: REQUEST_CONSENT grants the scope + pushes a refreshed token', async () => {
    uninstall = createMockHost({ consentGranted: false }).install();
    const tokenHook = renderHook(() => useBlockToken());
    const consentHook = renderHook(() => useRequestConsent());

    // First token is minted WITHOUT the budgeted scope. useBlockToken spreads
    // the token fields directly (scopes/buzzBudget/raw/expiresAt + refresh()).
    await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());
    expect(tokenHook.result.current.scopes).not.toContain('ai:write:budgeted');

    act(() => {
      consentHook.result.current.requestConsent({ scopes: ['ai:write:budgeted'] });
    });

    // The mock host grants + pushes TOKEN_REFRESH carrying the scope.
    await waitFor(() => expect(tokenHook.result.current.scopes).toContain('ai:write:budgeted'));
    expect(tokenHook.result.current.buzzBudget).toBe(200);
  });

  it('consent grants ONLY the scopes asked for — a `posts:write:self` grant is not a money grant', async () => {
    // 🔴 THE PARTIAL-GRANT CASE, AND IT WAS UNREACHABLE IN `pnpm dev`. The grant
    // branch used to set `consentGranted = true` unconditionally, and that flag
    // is what puts `ai:write:budgeted` (and `buzzBudget`) on the minted token —
    // so asking for `posts:write:self` handed out the MONEY scope as well. Every
    // local run therefore exercised the all-scopes-granted path, which is the
    // one shape that cannot show a block author what happens when the viewer
    // grants the permission they asked for and nothing else.
    uninstall = createMockHost({ consentGranted: false }).install();
    const tokenHook = renderHook(() => useBlockToken());
    const consentHook = renderHook(() => useRequestConsent());
    await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());

    act(() => {
      consentHook.result.current.requestConsent({ scopes: ['posts:write:self'] });
    });

    await waitFor(() => expect(tokenHook.result.current.scopes).toContain('posts:write:self'));
    // 🔴 The assertion that was unreachable: the money scope stayed OFF.
    expect(tokenHook.result.current.scopes).not.toContain('ai:write:budgeted');
    expect(tokenHook.result.current.buzzBudget).toBeUndefined();
  });

  it('a REQUEST_CONSENT with NO usable hint still grants the budgeted scope', async () => {
    // The compatibility arm of the test above, and the reason the grant is keyed
    // on "the hint named the budgeted scope" rather than on "the hint is
    // present". `requestConsent()` with no payload is documented as legitimate —
    // the host already knows the missing set it computed at mint — so the mock
    // must keep granting the default money scope there. Deleting that fallback
    // makes a bare `requestConsent()` grant nothing at all, silently.
    uninstall = createMockHost({ consentGranted: false }).install();
    const tokenHook = renderHook(() => useBlockToken());
    const consentHook = renderHook(() => useRequestConsent());
    await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());

    act(() => {
      consentHook.result.current.requestConsent();
    });

    await waitFor(() => expect(tokenHook.result.current.scopes).toContain('ai:write:budgeted'));
    expect(tokenHook.result.current.buzzBudget).toBe(200);
  });

  /**
   * The refusal path. Until `consentGrantable` existed the mock ALWAYS granted,
   * so a block author could not reach a `CONSENT_UNAVAILABLE` handler in
   * `pnpm dev` at all — and "untestable locally" is exactly how the
   * contradictory-messages bug this message fixes reached production.
   *
   * Subscribes through the REAL transport (`getTransport().onMessage`), which is
   * how a block consumes it, so these assert delivery end-to-end and not just
   * that the host called `dispatchToBlock`.
   */
  describe('consentGrantable: false — the un-grantable refusal', () => {
    it('pushes CONSENT_UNAVAILABLE naming the refused scopes, and grants NO token', async () => {
      uninstall = createMockHost({ consentGranted: false, consentGrantable: false }).install();
      const tokenHook = renderHook(() => useBlockToken());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());
      const rawBefore = tokenHook.result.current.raw;

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({
          scopes: ['ai:write:budgeted', 'buzz:read:self'],
        });
      });

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({
        reason: 'ungrantable',
        scopes: ['ai:write:budgeted', 'buzz:read:self'],
      });
      // The refusal is not a grant: no scope appeared and no new token was minted.
      expect(tokenHook.result.current.scopes).not.toContain('ai:write:budgeted');
      expect(tokenHook.result.current.raw).toBe(rawBefore);
      off();
    });

    it('🔴 still refuses — with scopes: [] — when every requested name is unknown', async () => {
      // The trap. The un-grantable set is the TRIGGER as well as the payload, so
      // filtering the trigger by the vocabulary would produce NO message here —
      // the exact silent dead end this whole path removes. The refusal is the
      // signal; the names are advisory.
      uninstall = createMockHost({ consentGranted: false, consentGrantable: false }).install();
      renderHook(() => useBlockContext());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({
          scopes: ['<img src=x onerror=alert(1)>', 'not:a:real:scope', 'A'.repeat(5000)],
        });
      });

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: [] });
      off();
    });

    it('stays SILENT when the block re-requests a scope it ALREADY holds', async () => {
      // The benign case. A refusal here would render a permission-unavailable
      // state over a permission that actually works.
      uninstall = createMockHost({ consentGranted: true, consentGrantable: false }).install();
      const tokenHook = renderHook(() => useBlockToken());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() =>
        expect(tokenHook.result.current.scopes).toContain('ai:write:budgeted'),
      );

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['ai:write:budgeted'] });
      });
      // POSITIVE CONTROL for the zero below: an un-grantable scope on the SAME
      // host + SAME listener DOES arrive, so `received.length === 0` above is a
      // real silence and not a listener wired to nothing.
      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['apps:storage:read'] });
      });
      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: ['apps:storage:read'] });
      off();
    });

    it('stays SILENT when REQUEST_CONSENT carries no scopes hint', async () => {
      // With no hint the host cannot tell "already granted" from "clamped", and
      // guessing is what produced the contradictory two-message screen.
      uninstall = createMockHost({ consentGranted: false, consentGrantable: false }).install();
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent();
      });
      act(() => {
        consentHook.result.current.requestConsent({});
      });
      // Positive control (same reason as above).
      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['buzz:read:self'] });
      });
      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: ['buzz:read:self'] });
      off();
    });

    it('DEFAULT (consentGrantable omitted) still grants and pushes NO refusal', async () => {
      // Purely additive: the existing lazy-consent round-trip is untouched for
      // every caller that does not opt in.
      uninstall = createMockHost({ consentGranted: false }).install();
      const tokenHook = renderHook(() => useBlockToken());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['ai:write:budgeted'] });
      });
      await waitFor(() => expect(tokenHook.result.current.scopes).toContain('ai:write:budgeted'));
      expect(received).toEqual([]);
      off();
    });

    it('setScenario({ consentGrantable: false }) flips it live, without re-installing', async () => {
      // A harness UI has to be able to toggle "this preview can never grant"
      // mid-session — re-installing would tear down the block's mounted state,
      // which is the state you are trying to observe.
      const host = createMockHost({ consentGranted: false });
      uninstall = host.install();
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      host.setScenario({ consentGrantable: false });
      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['apps:storage:write'] });
      });
      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: ['apps:storage:write'] });
      off();
    });
  });

  it('uninstall restores window.parent and is idempotent', async () => {
    const before = window.parent;
    const host = createMockHost();
    const teardown = host.install();
    expect(window.parent).not.toBe(before);
    teardown();
    teardown(); // idempotent
    expect(window.parent).toBe(before);
  });

  const APP_WFS: AppWorkflow[] = [
    {
      workflowId: 'wf_app_2',
      status: 'succeeded',
      images: [{ url: 'https://image.civitai.com/x/a.jpeg', width: 1024, height: 1024, nsfwLevel: 1 }],
      cost: 12,
      createdAt: '2026-07-14T12:00:00.000Z',
    },
    { workflowId: 'wf_app_1', status: 'processing', images: [], cost: null, createdAt: '2026-07-14T11:58:00.000Z' },
  ];

  it('QUERY_APP_WORKFLOWS returns the canned subqueue; CANCEL_APP_WORKFLOW flips + persists the row', async () => {
    uninstall = createMockHost({ appWorkflows: { workflows: APP_WFS, cursor: 'pg2' } }).install();
    const { result } = renderHook(() => useAppWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows).toEqual(APP_WFS);
    expect(result.current.cursor).toBe('pg2');
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.cancel('wf_app_1');
    });
    // Optimistically flipped in the hook.
    expect(result.current.workflows.find((w) => w.workflowId === 'wf_app_1')?.status).toBe('canceled');

    // …and the mock host persisted it: a refetch reflects the canceled status.
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows.find((w) => w.workflowId === 'wf_app_1')?.status).toBe('canceled');
  });

  // INVARIANT guard (green before the AppWorkflow.trainedEpochs change too): the
  // mock replies with canned rows verbatim, so a training row's trainedEpochs
  // must reach the hook intact — through the real inbound row validator.
  it('QUERY_APP_WORKFLOWS passes a training row\'s trainedEpochs + publishedModel through to the hook', async () => {
    const trainingRow: AppWorkflow = {
      workflowId: 'wf_train',
      status: 'succeeded',
      images: [],
      cost: 250,
      createdAt: '2026-07-14T12:05:00.000Z',
      trainedEpochs: [
        { $type: 'training', epochNumber: 1 },
        { $type: 'training', epochNumber: 2 },
      ],
      publishedModel: { modelId: 71, modelVersionId: 83, published: false },
    };
    uninstall = createMockHost({ appWorkflows: { workflows: [trainingRow, ...APP_WFS] } }).install();
    const { result } = renderHook(() => useAppWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.workflows[0]?.trainedEpochs).toEqual([
      { $type: 'training', epochNumber: 1 },
      { $type: 'training', epochNumber: 2 },
    ]);
    expect(result.current.workflows[0]?.publishedModel).toEqual({ modelId: 71, modelVersionId: 83, published: false });
    expect(result.current.workflows.slice(1)).toEqual(APP_WFS);
  });

  it('appWorkflowsError forces BOTH bridges to the error variant (read errors, cancel rejects)', async () => {
    uninstall = createMockHost({ appWorkflowsError: 'block lacks scope' }).install();
    const { result } = renderHook(() => useAppWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('block lacks scope');

    await expect(result.current.cancel('wf_app_1')).rejects.toThrow('block lacks scope');
  });

  /**
   * 🔴 THE MOCK'S DEFAULT GATED PROJECTION MUST SURVIVE THE BLOCK-SIDE VALIDATOR.
   * This is a SEAM, and each side was green in isolation while the pair was
   * broken: `isValidGatedImage` required `nsfwLevel` + `contentRating` on every
   * `visible` entry, so the host's new owner projection (`ratingPending`, NO
   * rating) failed the shape check and `isValidImagesResult` dropped the WHOLE
   * reply — every image in the batch. `getImages()` would then never resolve and
   * the block would hang to its transport timeout. Nothing in either file's own
   * tests could see that, because `mockHost.test.tsx` never drove this bridge and
   * `useGatedImages.test.tsx` only ever fed the validator hand-written fixtures.
   *
   * It also pins the FIDELITY half: the mock must emit all three shapes a real
   * host emits, or a block author reads `nsfwLevel` unconditionally, tests green
   * locally, and renders their own freshly-published image as a maturity claim
   * in production — the exact defect this contract change exists to fix.
   */
  it("the mock's DEFAULT gated projection carries all three shapes and passes the real validator", async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useGatedImages());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let images: BlockGatedImage[] = [];
    await act(async () => {
      // If the reply were dropped by the validator this would never settle —
      // the assertions below would never run, and the test times out rather than
      // passing vacuously.
      images = await result.current.getImages([9001, 9002, 9003]);
    });

    // The reply survived the validator at all (the seam), …
    expect(images).toHaveLength(3);

    // …and carries one of each shape.
    const rated = images.find((i) => i.status === 'visible' && !i.ratingPending);
    const hidden = images.find((i) => i.status === 'hidden');
    const pending = images.find((i) => i.status === 'visible' && i.ratingPending);
    expect(rated, 'the mock must emit a RATED visible entry').toBeDefined();
    expect(hidden, 'the mock must emit a HIDDEN entry').toBeDefined();
    expect(pending, "the mock must emit the author's own not-yet-rated entry").toBeDefined();

    // The rated entry claims a rating; the pending one claims none and still has
    // its url; the hidden one has no url at all.
    expect(rated).toMatchObject({ nsfwLevel: expect.any(Number), contentRating: expect.any(String) });
    expect(pending).toMatchObject({ ratingPending: true, url: expect.any(String) });
    expect(pending).not.toHaveProperty('nsfwLevel');
    expect(pending).not.toHaveProperty('contentRating');
    expect(hidden).not.toHaveProperty('url');
  });
});
