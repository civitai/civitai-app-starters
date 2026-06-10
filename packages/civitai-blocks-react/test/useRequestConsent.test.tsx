import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useRequestConsent } from '../src/hooks/useRequestConsent.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

// A logged-in viewer whose token is missing the consent-gated `ai:write:budgeted`
// scope (only `models:read:self` was signed) — the lazy-consent case.
function buildUngrantedInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt-1',
      scopes: ['models:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useRequestConsent', () => {
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
  // from a validated BLOCK_INIT (otherwise it queues). Dispatch an init first so
  // the outbound REQUEST_CONSENT actually reaches postMessage.
  function prime() {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildUngrantedInit() },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('posts a correctly-shaped REQUEST_CONSENT (no payload) to the parent', () => {
    prime();
    const { result } = renderHook(() => useRequestConsent());
    act(() => {
      result.current.requestConsent();
    });
    const call = postMessage.mock.calls.find((c) => c[0]?.type === 'REQUEST_CONSENT');
    expect(call).toBeDefined();
    expect(call![0]).toEqual({ type: 'REQUEST_CONSENT', payload: undefined });
    // Sent to the pinned parent origin, never '*'.
    expect(call![1]).toBe(PARENT_ORIGIN);
  });

  it('carries an advisory scopes hint through when supplied', () => {
    prime();
    const { result } = renderHook(() => useRequestConsent());
    act(() => {
      result.current.requestConsent({ scopes: ['ai:write:budgeted', 'buzz:read:self'] });
    });
    const call = postMessage.mock.calls.find((c) => c[0]?.type === 'REQUEST_CONSENT');
    expect(call).toBeDefined();
    expect(call![0]).toEqual({
      type: 'REQUEST_CONSENT',
      payload: { scopes: ['ai:write:budgeted', 'buzz:read:self'] },
    });
  });
});
