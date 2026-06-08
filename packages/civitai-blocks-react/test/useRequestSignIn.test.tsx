import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useRequestSignIn } from '../src/hooks/useRequestSignIn.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildAnonInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt-1', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null, // anonymous viewer — the conversion case
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useRequestSignIn', () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetTransport();
  });

  // The transport only posts to the parent once it has captured parentOrigin
  // from a validated BLOCK_INIT (otherwise it queues). Dispatch an anon
  // BLOCK_INIT first so the outbound REQUEST_SIGN_IN actually reaches postMessage.
  function primeAnon() {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildAnonInit() },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('posts a correctly-shaped REQUEST_SIGN_IN (no payload) to the parent', () => {
    primeAnon();
    const { result } = renderHook(() => useRequestSignIn());
    act(() => {
      result.current.requestSignIn();
    });
    const call = postMessage.mock.calls.find((c) => c[0]?.type === 'REQUEST_SIGN_IN');
    expect(call).toBeDefined();
    expect(call![0]).toEqual({ type: 'REQUEST_SIGN_IN', payload: undefined });
    // Sent to the pinned parent origin, never '*'.
    expect(call![1]).toBe(PARENT_ORIGIN);
  });

  it('carries a returnUrl through when supplied', () => {
    primeAnon();
    const { result } = renderHook(() => useRequestSignIn());
    act(() => {
      result.current.requestSignIn({ returnUrl: '/models/42' });
    });
    const call = postMessage.mock.calls.find((c) => c[0]?.type === 'REQUEST_SIGN_IN');
    expect(call).toBeDefined();
    expect(call![0]).toEqual({
      type: 'REQUEST_SIGN_IN',
      payload: { returnUrl: '/models/42' },
    });
  });
});
