import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, BlockToParentMessageType } from '@civitai/app-sdk/blocks';

import { useBuzzPurchase } from '../src/hooks/useBuzzPurchase.js';
import { useCheckpointPicker } from '../src/hooks/useCheckpointPicker.js';
import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { usePublishGenerationOutputs } from '../src/hooks/usePublishGenerationOutputs.js';
import { useResourcePicker } from '../src/hooks/useResourcePicker.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  HUMAN_GATED_REQUEST_TYPES,
  HUMAN_INTERACTION_TIMEOUT_MS,
} from '../src/internal/requestTimeouts.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * CLASS GUARD — closes the defect class behind civitai/civitai#4158, where
 * `PUBLISH_GENERATION_OUTPUTS` inherited the ~30s protocol default while its
 * reply waited on a human clicking a consent confirm. The generation was
 * already billed, the bridge died, and there is no refund for a dead bridge.
 *
 * Three assertions, and all three are load-bearing:
 *
 *  1. The ledger `HUMAN_GATED_REQUEST_TYPES` matches an EXACT literal list, so
 *     it fails when the set grows OR shrinks — a silent deletion is as much a
 *     regression as a silent addition.
 *  2. The driver table's keys equal the ledger exactly, so a type added to the
 *     ledger with no way to exercise it cannot sit there uncovered.
 *  3. Each driver's request is then run through the REAL transport and must
 *     survive well past `DEFAULT_REQUEST_TIMEOUT_MS`, and must still settle on
 *     the host's late reply. This is behavioural: it fails on ANY reintroduced
 *     ~30s ceiling regardless of how the hook spells (or omits) its opts.
 *
 * The pairing matters — (3) alone would pass for a hook nobody remembered to
 * add, and (1)+(2) alone would pass for a hook listed but never wired.
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
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

/**
 * One driver per human-gated request type: render the REAL hook and start the
 * REAL call, returning the pending promise. Deliberately not a mock — the whole
 * point is that the hook's own `sendTypedRequest` opts are what get exercised.
 */
const DRIVERS: Record<string, () => () => Promise<unknown>> = {
  OPEN_BUZZ_PURCHASE: () => {
    const { result } = renderHook(() => useBuzzPurchase());
    return () => result.current.openPurchaseModal(500);
  },
  OPEN_CHECKPOINT_PICKER: () => {
    const { result } = renderHook(() => useCheckpointPicker());
    return () => result.current.open({ baseModelGroup: 'SDXL' });
  },
  OPEN_IMAGE_UPLOAD: () => {
    const { result } = renderHook(() => useImageUpload());
    return () => result.current.open();
  },
  OPEN_RESOURCE_PICKER: () => {
    const { result } = renderHook(() => useResourcePicker());
    return () => result.current.open({ resourceType: 'LORA' });
  },
  PUBLISH_GENERATION_OUTPUTS: () => {
    const { result } = renderHook(() => usePublishGenerationOutputs());
    return () => result.current.publish({ workflowId: 'wf_app_1' });
  },
};

/** The reply message each request type is answered with, plus a minimal body. */
const REPLIES: Record<string, { type: string; extra: Record<string, unknown> }> = {
  OPEN_BUZZ_PURCHASE: { type: 'BUZZ_PURCHASE_RESULT', extra: { purchased: false } },
  OPEN_CHECKPOINT_PICKER: { type: 'CHECKPOINT_PICKER_RESULT', extra: {} },
  OPEN_IMAGE_UPLOAD: { type: 'IMAGE_UPLOAD_RESULT', extra: {} },
  OPEN_RESOURCE_PICKER: { type: 'RESOURCE_PICKER_RESULT', extra: {} },
  PUBLISH_GENERATION_OUTPUTS: {
    type: 'PUBLISH_RESULT',
    extra: { result: { imageIds: [1] } },
  },
};

describe('human-gated requests never inherit the default protocol timeout', () => {
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

  it('pins the human-gated ledger EXACTLY (fails when it grows or shrinks)', () => {
    expect([...HUMAN_GATED_REQUEST_TYPES].sort()).toEqual([
      'OPEN_BUZZ_PURCHASE',
      'OPEN_CHECKPOINT_PICKER',
      'OPEN_IMAGE_UPLOAD',
      'OPEN_RESOURCE_PICKER',
      'PUBLISH_GENERATION_OUTPUTS',
    ] satisfies BlockToParentMessageType[]);
  });

  it('covers every ledger entry with a driver, and drives nothing outside it', () => {
    expect(Object.keys(DRIVERS).sort()).toEqual([...HUMAN_GATED_REQUEST_TYPES].sort());
    expect(Object.keys(REPLIES).sort()).toEqual([...HUMAN_GATED_REQUEST_TYPES].sort());
  });

  /**
   * PINNED TO THE EXACT VALUE, not just "bigger than the default". The
   * behavioural cases below only advance 4x the default (120s), so a mutant that
   * weakened the bound to, say, 45s or 100s would survive every one of them —
   * larger, still far too short for a person, and invisible to a floor check.
   * The identical pin also lives in `useCheckpointPicker.test.tsx`; it is
   * duplicated here deliberately so the ledger's own suite carries it.
   */
  it('pins the human-interaction bound to its exact value', () => {
    expect(HUMAN_INTERACTION_TIMEOUT_MS).toBe(10 * 60_000);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(HUMAN_INTERACTION_TIMEOUT_MS).toBeGreaterThan(DEFAULT_REQUEST_TIMEOUT_MS * 4);
  });

  for (const type of HUMAN_GATED_REQUEST_TYPES) {
    it(`${type} survives past the ${DEFAULT_REQUEST_TIMEOUT_MS}ms default and still settles on a late reply`, async () => {
      vi.useFakeTimers();

      // Mount OUTSIDE act() — `result.current` is null until the render flushes.
      const start = DRIVERS[type]!();
      let pending!: Promise<unknown>;
      act(() => {
        pending = start();
      });

      let settled: 'resolved' | 'rejected' | null = null;
      void pending.then(
        () => {
          settled = 'resolved';
        },
        () => {
          settled = 'rejected';
        },
      );

      const sent = postMessageMock.mock.calls
        .map((c) => c[0] as { type: string; payload: { requestId: string } })
        .filter((m) => m.type === type)
        .pop();
      expect(sent, `${type}: hook sent no such request`).toBeDefined();

      // 4× the default — a person reading a modal. Nothing may settle here.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS * 4);
      });
      expect(settled, `${type} rejected at the default protocol timeout`).toBeNull();

      // The late human action still lands.
      const reply = REPLIES[type]!;
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: reply.type,
              payload: { requestId: sent!.payload.requestId, ...reply.extra },
            },
            origin: PARENT_ORIGIN,
          }),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(settled, `${type} ignored the host's late reply`).toBe('resolved');
    });
  }
});
