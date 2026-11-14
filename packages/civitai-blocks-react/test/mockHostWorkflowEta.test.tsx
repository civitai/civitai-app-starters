import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The mock host reports queue position, ETA and progress while a workflow is
 * not terminal, so an app can be built against them: queued first (falling
 * `queuedAhead`), then running (rising `progress`), then terminal with no
 * `eta`. Encoded as the host encodes them (civitai/civitai#8980): an empty
 * field is OMITTED, never sent as `null`. Driven through the REAL `watch` and
 * transport.
 */
const ORIGIN = window.location.origin;

const TEXT_BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat' },
};

const PASS_THROUGH_BODY = {
  kind: 'step' as const,
  $type: 'imageBackgroundRemoval',
  input: {},
  maxBuzz: 5,
};

const TRAINING_BODY = {
  kind: 'step' as const,
  $type: 'training',
  input: { engine: 'ai-toolkit' },
  maxBuzz: 250,
};

const COMFY_BODY = {
  kind: 'customComfy' as const,
  recipe: 'seamless-pano-360',
  params: { prompt: 'a misty forest, 360 panorama' },
};

const WORKFLOW_BODY = {
  kind: 'workflow' as const,
  steps: [
    { name: 'draw', $type: 'imageGen', input: { prompt: 'cat' } },
    { name: 'upscale', $type: 'imageGen', input: { image: { $ref: 'draw', path: 'output.images[0].url' } } },
  ],
};

/** A queued `eta` carries the step's queue; a running one has `support: null`. */
const phaseOf = (s: BlockWorkflowSnapshot) => {
  if (s.eta == null) return TERMINAL.has(s.status) ? 'terminal' : 'absent';
  return s.eta.support !== null ? 'queued' : 'running';
};
const TERMINAL = new Set(['succeeded', 'failed', 'expired', 'canceled']);

/** `[phase, queuedAhead, progress]` of each update, so the ORDER is asserted in one place. */
const phases = (updates: BlockWorkflowSnapshot[]) =>
  updates.map((s) => [phaseOf(s), s.eta?.queuedAhead ?? null, s.eta?.progress ?? null] as const);

describe('createMockHost — queue / ETA / progress', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  async function watchToEnd(body: unknown, pollsUntilDone: number) {
    uninstall = createMockHost({ consentGranted: true, pollsUntilDone }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let submitted!: BlockWorkflowSnapshot;
    await act(async () => {
      submitted = await result.current.submit(body as never);
    });
    const updates: BlockWorkflowSnapshot[] = [];
    let final!: BlockWorkflowSnapshot;
    await act(async () => {
      final = await result.current.watch(submitted.workflowId, {
        intervalMs: 1,
        waitSeconds: 0,
        onUpdate: (s) => updates.push(s),
      });
    });
    return { updates, final };
  }

  it('goes queued (falling queuedAhead) → running (rising progress) → terminal with no eta', async () => {
    const { updates, final } = await watchToEnd(TEXT_BODY, 5);

    expect(phases(updates)).toEqual([
      ['queued', 4, null],
      ['queued', 2, null],
      ['running', null, 1 / 3],
      ['running', null, 2 / 3],
      ['terminal', null, null],
    ]);
    expect(final.status).toBe('succeeded');
    // The host OMITS `eta` on a terminal snapshot rather than sending null.
    expect('eta' in final).toBe(false);

    const [q1, q2] = updates;
    for (const q of [q1!, q2!]) {
      expect(q.status).toBe('processing');
      expect(q.eta!.support).toBe('available');
      expect(typeof q.eta!.startsAt).toBe('string');
      expect(typeof q.eta!.completesAt).toBe('string');
      expect(Date.parse(q.eta!.completesAt!)).toBeGreaterThan(Date.parse(q.eta!.startsAt!));
    }
    for (const r of updates.slice(2, 4)) {
      expect(r.eta!.startsAt).toBeNull();
      expect(r.eta!.completesAt).toBeNull();
      expect(r.eta!.support).toBeNull();
    }
  });

  // The host's own step name for each single-step kind (civitai/civitai#8980:
  // `BLOCK_STEP_NAME`, `BLOCK_CUSTOM_COMFY_STEP_NAME`). A textToImage step is
  // submitted unnamed and named by the orchestrator, so the mock keeps `$0`.
  it.each([
    ['textToImage', TEXT_BODY, '$0'],
    ['a pass-through step', PASS_THROUGH_BODY, 'block-step'],
    ['a pass-through training step', TRAINING_BODY, 'block-step'],
    ['customComfy', COMFY_BODY, 'block-custom-comfy'],
  ])('names the step of %s as the host does', async (_, body, stepName) => {
    const { updates } = await watchToEnd(body, 3);
    expect(updates.slice(0, 2).map((s) => s.eta?.stepName)).toEqual([stepName, stepName]);
  });

  // The host reports progress only for image and video generation step types.
  it.each([
    ['a pass-through step', PASS_THROUGH_BODY],
    ['a pass-through training step', TRAINING_BODY],
    ['customComfy', COMFY_BODY],
  ])('reports no progress while %s runs', async (_, body) => {
    const { updates } = await watchToEnd(body, 3);
    expect(phases(updates)).toEqual([
      ['queued', 2, null],
      ['running', null, null],
      ['terminal', null, null],
    ]);
  });

  it('puts the queue and progress on the current step of a kind:"workflow" run, omitting empty fields', async () => {
    const { updates, final } = await watchToEnd(WORKFLOW_BODY, 5);

    expect(updates.map(phaseOf)).toEqual(['queued', 'queued', 'running', 'running', 'terminal']);
    for (const s of updates.slice(0, 4)) {
      const current = s.steps!.find((step) => step.name === s.eta!.stepName);
      expect(current).toBeDefined();
      const keys = Object.keys(current!).sort();
      if (phaseOf(s) === 'queued') {
        expect(current!.queue).toEqual({
          precedingJobs: s.eta!.queuedAhead,
          estimatedStartAt: s.eta!.startsAt,
          estimatedCompleteAt: s.eta!.completesAt,
          support: 'available',
        });
        // Queued: the queue only — no progress / startedAt / completedAt keys.
        expect(keys).toEqual(['$type', 'name', 'queue', 'status']);
      } else {
        expect(current!.progress).toBe(s.eta!.progress);
        expect(typeof current!.startedAt).toBe('string');
        // Running: progress and startedAt — no queue / completedAt keys.
        expect(keys).toEqual(['$type', 'name', 'progress', 'startedAt', 'status']);
      }
    }
    expect('eta' in final).toBe(false);
  });

  it('reports one running poll under the default pollsUntilDone', async () => {
    const { updates } = await watchToEnd(TEXT_BODY, 2);
    expect(phases(updates)).toEqual([
      ['running', null, 0.5],
      ['terminal', null, null],
    ]);
  });
});
