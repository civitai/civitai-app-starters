import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useCivitaiNavigate } from '../src/hooks/useCivitaiNavigate.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * Fire-and-forget NAVIGATE bridge hook. The iframe transport QUEUES outbound
 * messages until BLOCK_INIT captures the parent origin, so — like the
 * useResourcePicker scaffold — we dispatch a BLOCK_INIT first, then clear the
 * mock (which also swallows the auto-sent BLOCK_READY) before asserting.
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

describe('useCivitaiNavigate', () => {
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
      payload: { path: string; target: string };
    };
  }

  it('defaults target to "current" when omitted', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('/models/12345');
    });
    const sent = lastSent();
    expect(sent.type).toBe('NAVIGATE');
    expect(sent.payload).toEqual({ path: '/models/12345', target: 'current' });
  });

  it('forwards an explicit "new_tab" target', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('/user/alice', 'new_tab');
    });
    expect(lastSent().payload).toEqual({ path: '/user/alice', target: 'new_tab' });
  });

  it('is fire-and-forget — the returned value is undefined (no host reply awaited)', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    let ret: unknown;
    act(() => {
      ret = result.current.navigate('/');
    });
    expect(ret).toBeUndefined();
    // Exactly one outbound message, and nothing waits on a reply.
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps `navigate` referentially stable across renders (useCallback)', () => {
    const { result, rerender } = renderHook(() => useCivitaiNavigate());
    const first = result.current.navigate;
    rerender();
    expect(result.current.navigate).toBe(first);
  });
});
