import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useCheckpointPicker } from '../src/hooks/useCheckpointPicker.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../src/internal/requestTimeouts.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * Checkpoint picker hook — two host-mediated flows:
 *   - `open`   → OPEN_CHECKPOINT_PICKER → CHECKPOINT_PICKER_RESULT
 *   - `persist`→ SET_USER_CHECKPOINT   → USER_CHECKPOINT_SET
 * Mirrors the useResourcePicker scaffold (postMessage-driven iframe transport).
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useCheckpointPicker', () => {
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
  });

  function lastSent() {
    return postMessageMock.mock.calls[postMessageMock.mock.calls.length - 1][0] as {
      type: string;
      payload: {
        requestId: string;
        baseModelGroup?: string;
        currentVersionId?: number;
        versionId?: number | null;
      };
    };
  }

  function reply(type: string, requestId: string, extra: Record<string, unknown>) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type, payload: { requestId, ...extra } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  describe('open()', () => {
    it('sends OPEN_CHECKPOINT_PICKER with the family hint + currentVersionId', () => {
      const { result } = renderHook(() => useCheckpointPicker());
      act(() => {
        result.current.open({ baseModelGroup: 'SDXL', currentVersionId: 128713 }).catch(() => {});
      });
      const sent = lastSent();
      expect(sent.type).toBe('OPEN_CHECKPOINT_PICKER');
      expect(sent.payload.baseModelGroup).toBe('SDXL');
      expect(sent.payload.currentVersionId).toBe(128713);
      expect(typeof sent.payload.requestId).toBe('string');
    });

    it('omits currentVersionId from the message when not provided', () => {
      const { result } = renderHook(() => useCheckpointPicker());
      act(() => {
        result.current.open({ baseModelGroup: 'Flux1' }).catch(() => {});
      });
      const sent = lastSent();
      expect(sent.payload.baseModelGroup).toBe('Flux1');
      expect(sent.payload).not.toHaveProperty('currentVersionId');
    });

    it('resolves with { selected } on the matching CHECKPOINT_PICKER_RESULT', async () => {
      const { result } = renderHook(() => useCheckpointPicker());
      let pick!: Promise<{ selected?: unknown }>;
      act(() => {
        pick = result.current.open({ baseModelGroup: 'SDXL' });
      });
      const sent = lastSent();
      const selected = {
        versionId: 9001,
        modelId: 700,
        baseModel: 'SDXL 1.0',
        modelName: 'DreamModel',
        versionName: 'v2',
      };
      reply('CHECKPOINT_PICKER_RESULT', sent.payload.requestId, { selected });
      await expect(pick).resolves.toEqual({ selected });
    });

    it('resolves with selected=undefined when the user dismissed (no `selected`)', async () => {
      const { result } = renderHook(() => useCheckpointPicker());
      let pick!: Promise<{ selected?: unknown }>;
      act(() => {
        pick = result.current.open({ baseModelGroup: 'SDXL' });
      });
      const sent = lastSent();
      reply('CHECKPOINT_PICKER_RESULT', sent.payload.requestId, {});
      await expect(pick).resolves.toEqual({ selected: undefined });
    });

    it('does NOT reject at the default ~30s timeout (a picker is human-interactive)', async () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useCheckpointPicker());
        let pick!: Promise<{ selected?: unknown }>;
        act(() => {
          pick = result.current.open({ baseModelGroup: 'SDXL' });
        });
        const sent = lastSent();
        let settled = false;
        void pick.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(settled).toBe(false);

        const picked = { versionId: 1, modelId: 2, baseModel: 'SDXL 1.0' };
        reply('CHECKPOINT_PICKER_RESULT', sent.payload.requestId, { selected: picked });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        await expect(pick).resolves.toEqual({ selected: picked });
      } finally {
        vi.useRealTimers();
      }
    });

    it('exports a human-interaction timeout well above the default request timeout', () => {
      expect(HUMAN_INTERACTION_TIMEOUT_MS).toBe(10 * 60_000);
    });
  });

  describe('persist()', () => {
    it('sends SET_USER_CHECKPOINT with a numeric versionId and resolves on ok:true', async () => {
      const { result } = renderHook(() => useCheckpointPicker());
      let done!: Promise<void>;
      act(() => {
        done = result.current.persist(4242);
      });
      const sent = lastSent();
      expect(sent.type).toBe('SET_USER_CHECKPOINT');
      expect(sent.payload.versionId).toBe(4242);
      reply('USER_CHECKPOINT_SET', sent.payload.requestId, { ok: true });
      await expect(done).resolves.toBeUndefined();
    });

    it('forwards an explicit null versionId (clear the override)', async () => {
      const { result } = renderHook(() => useCheckpointPicker());
      let done!: Promise<void>;
      act(() => {
        done = result.current.persist(null);
      });
      const sent = lastSent();
      expect(sent.payload.versionId).toBeNull();
      reply('USER_CHECKPOINT_SET', sent.payload.requestId, { ok: true });
      await expect(done).resolves.toBeUndefined();
    });

    it('throws the host error message when the persist is rejected (ok:false)', async () => {
      const { result } = renderHook(() => useCheckpointPicker());
      let done!: Promise<void>;
      act(() => {
        done = result.current.persist(7);
      });
      const sent = lastSent();
      reply('USER_CHECKPOINT_SET', sent.payload.requestId, {
        ok: false,
        error: 'wrong-ecosystem',
      });
      await expect(done).rejects.toThrow('wrong-ecosystem');
    });

    it('throws a default message when ok:false carries no error', async () => {
      const { result } = renderHook(() => useCheckpointPicker());
      let done!: Promise<void>;
      act(() => {
        done = result.current.persist(7);
      });
      const sent = lastSent();
      reply('USER_CHECKPOINT_SET', sent.payload.requestId, { ok: false });
      await expect(done).rejects.toThrow('failed to persist checkpoint');
    });
  });
});
