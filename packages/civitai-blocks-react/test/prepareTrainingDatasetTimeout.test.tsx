import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import {
  PrepareTrainingDatasetError,
  usePrepareTrainingDataset,
} from '../src/hooks/usePrepareTrainingDataset.js';
import { RunTrainingError, useRunTraining } from '../src/hooks/useRunTraining.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  HUMAN_INTERACTION_TIMEOUT_MS,
  WORKFLOW_REQUEST_TIMEOUT_MS,
} from '../src/transport/requestTimeouts.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `PREPARE_TRAINING_DATASET` is bucketed `'protocol'` (no person in the loop) but
 * is sent under the server-work bound, because the server imports up to 50
 * images into the orchestrator under its own 60s budget. At the 30s protocol
 * default a healthy prepare would reject mid-import.
 *
 * Real transport, fake timers, no mock host — the bound under test is the
 * hook's own `sendTypedRequest` option.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt',
      scopes: ['ai:write:budgeted'],
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('usePrepareTrainingDataset — request bound', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function start() {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePrepareTrainingDataset());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.prepareDataset([{ imageId: 1, caption: 'c' }]);
    });
    const state: { settled: 'resolved' | 'rejected' | null; error?: unknown } = { settled: null };
    void pending.then(
      () => {
        state.settled = 'resolved';
      },
      (error: unknown) => {
        state.settled = 'rejected';
        state.error = error;
      },
    );
    const sent = postMessageMock.mock.calls
      .map((c) => c[0] as { type: string; payload: { requestId: string } })
      .filter((m) => m.type === 'PREPARE_TRAINING_DATASET')
      .pop();
    expect(sent).toBeDefined();
    return { state, requestId: sent!.payload.requestId };
  }

  it('pins the server-work bound', () => {
    expect(WORKFLOW_REQUEST_TIMEOUT_MS).toBe(120_000);
    expect(WORKFLOW_REQUEST_TIMEOUT_MS).toBeGreaterThan(DEFAULT_REQUEST_TIMEOUT_MS * 2);
  });

  it('survives past the 30s default (a 60s import) and settles on the late reply', async () => {
    const { state, requestId } = start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(state.settled).toBeNull();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'TRAINING_DATASET_RESULT',
            payload: {
              requestId,
              result: { datasetId: `tds_${'0'.repeat(32)}`, count: 1, rejected: [] },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state.settled).toBe('resolved');
  });

  it('rejects past the bound with .timedOut, and does not prompt for consent', async () => {
    const { state } = start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKFLOW_REQUEST_TIMEOUT_MS + 1);
    });
    expect(state.settled).toBe('rejected');
    const e = state.error as PrepareTrainingDatasetError;
    expect(e).toBeInstanceOf(PrepareTrainingDatasetError);
    expect(e.timedOut).toBe(true);
    expect(e.code).toBeUndefined();
    expect(postMessageMock.mock.calls.filter((c) => c[0].type === 'REQUEST_CONSENT')).toHaveLength(
      0,
    );
  });
});

/**
 * `useRunTraining`'s money-ambiguous outcomes that a mock host cannot produce:
 * no reply at all, and a shape-valid reply carrying an EMPTY error. Both must
 * come out `.unconfirmed` — nothing in either says a run was not started.
 */
describe('useRunTraining — outcomes with no answer', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function startRun() {
    const { result } = renderHook(() => useRunTraining());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.runTraining({
        kind: 'training',
        datasetId: `tds_${'0'.repeat(32)}`,
        engine: 'ai-toolkit',
        model: 'sdxl',
        params: {
          engine: 'ai-toolkit',
          ecosystem: 'sdxl',
          resolution: 1024,
          lr: 0.0001,
          textEncoderLr: null,
          trainTextEncoder: false,
          lrScheduler: 'cosine',
          optimizerType: 'adamw8bit',
          networkDim: 32,
          networkAlpha: 16,
          noiseOffset: null,
          minSnrGamma: null,
          flipAugmentation: false,
          shuffleTokens: false,
          keepTokens: 0,
        },
        triggerWord: 'tok',
        samplePrompts: [],
        quoteId: `tq_${'0'.repeat(32)}`,
      });
    });
    const state: { settled: 'resolved' | 'rejected' | null; error?: unknown } = { settled: null };
    void pending.then(
      () => {
        state.settled = 'resolved';
      },
      (error: unknown) => {
        state.settled = 'rejected';
        state.error = error;
      },
    );
    const sent = postMessageMock.mock.calls
      .map((c) => c[0] as { type: string; payload: { requestId: string } })
      .filter((m) => m.type === 'RUN_TRAINING')
      .pop();
    expect(sent).toBeDefined();
    return { state, requestId: sent!.payload.requestId };
  }

  it('no reply within the 10-minute bound → .timedOut AND .unconfirmed, never .declined', async () => {
    vi.useFakeTimers();
    const { state } = startRun();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HUMAN_INTERACTION_TIMEOUT_MS + 1);
    });
    expect(state.settled).toBe('rejected');
    const e = state.error as RunTrainingError;
    expect(e).toBeInstanceOf(RunTrainingError);
    expect(e.timedOut).toBe(true);
    expect(e.unconfirmed).toBe(true);
    expect(e.declined).toBe(false);
    expect(e.code).toBeUndefined();
  });

  it("an `error: ''` reply → .unconfirmed (the cautious reading), not a silent success", async () => {
    const { state, requestId } = startRun();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'TRAINING_RESULT', payload: { requestId, error: '' } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    await waitForSettled(state);
    const e = state.error as RunTrainingError;
    expect(e).toBeInstanceOf(RunTrainingError);
    expect(e.code).toBe('submission-unconfirmed');
    expect(e.unconfirmed).toBe(true);
    expect(e.message).not.toBe('');
  });
});

async function waitForSettled(state: { settled: unknown }) {
  for (let i = 0; i < 20 && state.settled === null; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
