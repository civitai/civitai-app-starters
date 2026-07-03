import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBlockSettings } from '../src/hooks/useBlockSettings.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useBlockSettings` is shorthand for `useBlockContext().settings`. It reflects
 * the transport snapshot: the EMPTY sentinel before BLOCK_INIT, the host-
 * forwarded publisher/user settings after.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: {
      publisherSettings: { defaultModel: 'sdxl', maxSteps: 30 },
      userSettings: { favoriteColor: 'blue' },
    },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useBlockSettings', () => {
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

  it('returns the EMPTY settings sentinel before BLOCK_INIT', () => {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockSettings());
    expect(result.current).toEqual({ publisherSettings: {}, userSettings: {} });
  });

  it('exposes the host-forwarded publisher + user settings after BLOCK_INIT', () => {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockSettings());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit() },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    expect(result.current.publisherSettings).toEqual({ defaultModel: 'sdxl', maxSteps: 30 });
    expect(result.current.userSettings).toEqual({ favoriteColor: 'blue' });
  });
});
