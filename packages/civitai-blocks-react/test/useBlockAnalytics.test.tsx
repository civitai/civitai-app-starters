import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBlockAnalytics } from '../src/hooks/useBlockAnalytics.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * Fire-and-forget TRACK_EVENT bridge hook. Same queue-until-init transport
 * contract as useCivitaiNavigate: dispatch BLOCK_INIT, clear the mock (drops the
 * auto BLOCK_READY), then assert the outbound analytics message.
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

describe('useBlockAnalytics', () => {
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
      payload: { eventName: string; properties?: Record<string, unknown> };
    };
  }

  it('sends TRACK_EVENT with the event name + properties', () => {
    const { result } = renderHook(() => useBlockAnalytics());
    act(() => {
      result.current.track('generate_clicked', { modelId: 42 });
    });
    const sent = lastSent();
    expect(sent.type).toBe('TRACK_EVENT');
    expect(sent.payload).toEqual({ eventName: 'generate_clicked', properties: { modelId: 42 } });
  });

  it('omits properties when not supplied (properties: undefined)', () => {
    const { result } = renderHook(() => useBlockAnalytics());
    act(() => {
      result.current.track('view');
    });
    const sent = lastSent();
    expect(sent.payload.eventName).toBe('view');
    expect(sent.payload.properties).toBeUndefined();
  });

  it('is fire-and-forget — one outbound message, no reply awaited', () => {
    const { result } = renderHook(() => useBlockAnalytics());
    let ret: unknown;
    act(() => {
      ret = result.current.track('x');
    });
    expect(ret).toBeUndefined();
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps `track` referentially stable across renders (useCallback)', () => {
    const { result, rerender } = renderHook(() => useBlockAnalytics());
    const first = result.current.track;
    rerender();
    expect(result.current.track).toBe(first);
  });
});
