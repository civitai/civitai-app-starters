import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The mock host reports queue position, ETA and progress while a workflow is
 * not terminal, so an app can be built against them: queued first (falling
 * `queuedAhead`), then running (rising `progress`), then terminal with
 * `eta: null`. Driven through the REAL `watch` and transport.
 */
const ORIGIN = window.location.origin;

const TEXT_BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat' },
};

const WORKFLOW_BODY = {
  kind: 'workflow' as const,
  steps: [
    { name: 'draw', $type: 'imageGen', input: { prompt: 'cat' } },
    { name: 'upscale', $type: 'imageGen', input: { image: { $ref: 'draw', path: 'output.images[0].url' } } },
  ],
};

/** `[phase, queuedAhead, progress]` of each update, so the ORDER is asserted in one place. */
const phases = (updates: BlockWorkflowSnapshot[]) =>
  updates.map((s) => {
    if (s.eta === null) return ['terminal', null, null] as const;
    if (s.eta === undefined) return ['absent', null, null] as const;
    return [s.eta.progress === null ? 'queued' : 'running', s.eta.queuedAhead, s.eta.progress] as const;
  });

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

  it('goes queued (falling queuedAhead) → running (rising progress) → terminal with eta null', async () => {
    const { updates, final } = await watchToEnd(TEXT_BODY, 5);

    expect(phases(updates)).toEqual([
      ['queued', 4, null],
      ['queued', 2, null],
      ['running', null, 1 / 3],
      ['running', null, 2 / 3],
      ['terminal', null, null],
    ]);
    expect(final.status).toBe('succeeded');
    expect(final.eta).toBeNull();

    const [q1, q2] = updates;
    for (const q of [q1!, q2!]) {
      expect(q.status).toBe('processing');
      expect(q.eta!.stepName).toBe('$0');
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

  it('puts the queue and progress on the current step of a kind:"workflow" run', async () => {
    const { updates, final } = await watchToEnd(WORKFLOW_BODY, 5);

    expect(phases(updates).map(([phase]) => phase)).toEqual([
      'queued',
      'queued',
      'running',
      'running',
      'terminal',
    ]);
    for (const s of updates.slice(0, 4)) {
      const current = s.steps!.find((step) => step.name === s.eta!.stepName);
      expect(current).toBeDefined();
      if (s.eta!.progress === null) {
        expect(current!.queue).toEqual({
          precedingJobs: s.eta!.queuedAhead,
          estimatedStartAt: s.eta!.startsAt,
          estimatedCompleteAt: s.eta!.completesAt,
          support: 'available',
        });
        expect(current!.startedAt).toBeNull();
      } else {
        expect(current!.queue).toBeNull();
        expect(current!.progress).toBe(s.eta!.progress);
        expect(typeof current!.startedAt).toBe('string');
      }
    }
    expect(final.eta).toBeNull();
  });

  it('reports one running poll under the default pollsUntilDone', async () => {
    const { updates } = await watchToEnd(TEXT_BODY, 2);
    expect(phases(updates)).toEqual([
      ['running', null, 0.5],
      ['terminal', null, null],
    ]);
  });
});
