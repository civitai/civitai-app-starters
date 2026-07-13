import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useHostOrigin } from '../src/hooks/useHostOrigin.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';
const OTHER_ORIGIN = 'https://evil.example.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt-1', scopes: ['models:read:self'], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'iframe',
  };
}

describe('useHostOrigin', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetTransport();
    delete (window as { __CIVITAI_BLOCK_CONTEXT__?: unknown }).__CIVITAI_BLOCK_CONTEXT__;
  });

  it('returns undefined before BLOCK_INIT', () => {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useHostOrigin());
    expect(result.current).toBeUndefined();
  });

  it('returns exactly the allowlisted origin after a valid BLOCK_INIT', () => {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useHostOrigin());
    expect(result.current).toBeUndefined();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: PARENT_ORIGIN }),
      );
    });

    expect(result.current).toBe(PARENT_ORIGIN);
  });

  it('SECURITY: a BLOCK_INIT from a NON-allowlisted origin never becomes the host origin', () => {
    // The security property: the origin the money-scoped token is sent to must
    // only ever be one that cleared the allowlist. A spoofed init is dropped,
    // so the hook stays undefined and never yields the attacker's origin.
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useHostOrigin());

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: OTHER_ORIGIN }),
      );
    });
    // Dropped at the origin gate — host origin never set to the bad origin.
    expect(result.current).toBeUndefined();

    // A subsequent legitimate init resolves to the good origin only.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: PARENT_ORIGIN }),
      );
    });
    expect(result.current).toBe(PARENT_ORIGIN);
  });

  it('inline mode: returns the same-document host origin from the bootstrap', () => {
    // Inline transport hydrates synchronously from window.__CIVITAI_BLOCK_CONTEXT__;
    // window.location.origin is the trusted host origin in same-document mode.
    (window as { __CIVITAI_BLOCK_CONTEXT__?: BlockInitPayload }).__CIVITAI_BLOCK_CONTEXT__ = {
      ...buildInit(),
      renderMode: 'inline',
    };
    // No explicit allowlist — the detector picks InlineTransport off the bootstrap.
    getTransport();
    const { result } = renderHook(() => useHostOrigin());
    expect(result.current).toBe(window.location.origin);
  });
});
