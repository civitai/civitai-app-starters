import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useResourcePicker } from '../src/hooks/useResourcePicker.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * PAGE resource picker hook (Design 1 — host-chrome). Mirrors the
 * useBuzzWorkflow test scaffold: drive the iframe transport via window
 * postMessage, assert the OUTBOUND OPEN_RESOURCE_PICKER message + that the hook
 * resolves on the matching RESOURCE_PICKER_RESULT (by requestId), handles the
 * cancelled (no `selected`) case, and ignores a mismatched requestId.
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

describe('useResourcePicker', () => {
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
      payload: { requestId: string; resourceType: string; baseModelGroup?: string };
    };
  }

  function replyResult(requestId: string, selected?: unknown) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'RESOURCE_PICKER_RESULT', payload: { requestId, selected } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('open() sends OPEN_RESOURCE_PICKER with the requested type + family hint', () => {
    const { result } = renderHook(() => useResourcePicker());
    act(() => {
      // Swallow the never-resolved pending promise — resetTransport() rejects it
      // on dispose; we only assert the OUTBOUND message here.
      result.current.open({ resourceType: 'Checkpoint', baseModelGroup: 'Flux1' }).catch(() => {});
    });
    const sent = lastSent();
    expect(sent.type).toBe('OPEN_RESOURCE_PICKER');
    expect(sent.payload.resourceType).toBe('Checkpoint');
    expect(sent.payload.baseModelGroup).toBe('Flux1');
    expect(typeof sent.payload.requestId).toBe('string');
  });

  it('omits baseModelGroup from the message when not provided', () => {
    const { result } = renderHook(() => useResourcePicker());
    act(() => {
      result.current.open({ resourceType: 'LORA' }).catch(() => {});
    });
    const sent = lastSent();
    expect(sent.payload.resourceType).toBe('LORA');
    expect(sent.payload).not.toHaveProperty('baseModelGroup');
  });

  it('resolves with the chosen resource on the matching RESOURCE_PICKER_RESULT', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open({ resourceType: 'Checkpoint' });
    });
    const sent = lastSent();
    const selected = { versionId: 9001, modelId: 700, baseModel: 'Flux.1 D', modelType: 'Checkpoint' };
    replyResult(sent.payload.requestId, selected);
    await expect(pick).resolves.toEqual(selected);
  });

  it('resolves to null when the user dismissed (no `selected`)', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open({ resourceType: 'LORA' });
    });
    const sent = lastSent();
    replyResult(sent.payload.requestId); // cancelled — no `selected`
    await expect(pick).resolves.toBeNull();
  });

  it('ignores a RESOURCE_PICKER_RESULT with a mismatched requestId', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open({ resourceType: 'Checkpoint' });
    });
    const sent = lastSent();

    // A stray result for a DIFFERENT request must not resolve this promise.
    replyResult('some-other-id', { versionId: 1, modelId: 1, baseModel: 'X', modelType: 'LORA' });

    let settled = false;
    void pick.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // The correct requestId resolves it.
    const mine = { versionId: 42, modelId: 7, baseModel: 'SDXL 1.0', modelType: 'Checkpoint' };
    replyResult(sent.payload.requestId, mine);
    await expect(pick).resolves.toEqual(mine);
  });

  it('open() does NOT reject at the default ~30s timeout (a picker is human-interactive)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA' });
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
      // Advance WELL past the 30s default request timeout: the old code rejected
      // here ("timed out after 30000ms"); the picker timeout must keep it pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(settled).toBe(false);
      // A real pick still resolves it.
      const picked = { versionId: 9, modelId: 1, baseModel: 'SDXL 1.0', modelType: 'LORA' };
      replyResult(sent.payload.requestId, picked);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await expect(pick).resolves.toEqual(picked);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cross concurrent requests — each open() resolves its own result', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pickA!: Promise<unknown>;
    let pickB!: Promise<unknown>;
    act(() => {
      pickA = result.current.open({ resourceType: 'Checkpoint' });
    });
    const sentA = lastSent();
    act(() => {
      pickB = result.current.open({ resourceType: 'LORA' });
    });
    const sentB = lastSent();
    expect(sentA.payload.requestId).not.toBe(sentB.payload.requestId);

    const resB = { versionId: 222, modelId: 22, baseModel: 'SDXL 1.0', modelType: 'LORA' };
    const resA = { versionId: 111, modelId: 11, baseModel: 'Flux.1 D', modelType: 'Checkpoint' };
    replyResult(sentB.payload.requestId, resB);
    replyResult(sentA.payload.requestId, resA);

    await expect(pickA).resolves.toEqual(resA);
    await expect(pickB).resolves.toEqual(resB);
  });
});
