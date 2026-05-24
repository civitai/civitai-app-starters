import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBlockContext } from '../src/hooks/useBlockContext.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt-1', scopes: ['models:read:self'], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: { theme: 'dark' }, userSettings: {} },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'iframe',
  };
}

describe('useBlockContext', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetTransport();
  });

  it('returns ready=false with sentinel values before BLOCK_INIT', () => {
    // Prime the singleton with explicit options so it picks the iframe path.
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockContext());
    expect(result.current.ready).toBe(false);
    expect(result.current.viewer).toBeNull();
    expect(result.current.context.slotId).toBe('');
    expect(result.current.appId).toBe('');
  });

  it('flips to ready=true and exposes context after BLOCK_INIT', () => {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockContext());
    expect(result.current.ready).toBe(false);

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: PARENT_ORIGIN }),
      );
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.context.modelId).toBe(42);
    expect(result.current.viewer?.username).toBe('alice');
    expect(result.current.viewer?.status).toBe('active');
    expect(result.current.theme).toBe('dark');
    expect(result.current.settings.publisherSettings).toEqual({ theme: 'dark' });
    expect(result.current.appId).toBe('app_test');
    expect(result.current.blockId).toBe('b');
    expect(result.current.blockInstanceId).toBe('inst-1');
  });

  it('exposes viewer=null when the host sends an anonymous BLOCK_INIT', () => {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockContext());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: { ...buildInit(), viewer: null } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.viewer).toBeNull();
  });
});
