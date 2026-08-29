import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useSaveImage } from '../src/hooks/useSaveImage.js';
import { getTransport } from '../src/internal/singleton.js';
import { isValidSaveImageResult } from '../src/internal/validate.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

function calls(mock: ReturnType<typeof vi.fn>, type: string) {
  return mock.mock.calls.filter((c) => c[0]?.type === type);
}
function lastSave(mock: ReturnType<typeof vi.fn>): {
  payload: { requestId: string; url?: string; imageId?: number; filename?: string };
} {
  const c = calls(mock, 'SAVE_IMAGE');
  return c[c.length - 1]![0] as {
    payload: { requestId: string; url?: string; imageId?: number; filename?: string };
  };
}
function dispatch(type: string, payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  });
}

describe('useSaveImage', () => {
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
      new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: PARENT_ORIGIN }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
    vi.restoreAllMocks();
  });

  it('saveImage({ url }) posts SAVE_IMAGE with url + filename (no imageId) and resolves on ok', async () => {
    const { result } = renderHook(() => useSaveImage());
    let done = false;
    act(() => {
      void result.current
        .saveImage({ url: 'https://image.civitai.com/x/original.jpeg', filename: 'render.png' })
        .then(() => {
          done = true;
        });
    });
    const sent = lastSave(postMessageMock);
    expect(typeof sent.payload.requestId).toBe('string');
    expect(sent.payload.url).toBe('https://image.civitai.com/x/original.jpeg');
    expect(sent.payload.filename).toBe('render.png');
    expect(sent.payload.imageId).toBeUndefined();
    // never leaks a token
    expect(sent.payload).not.toHaveProperty('blockToken');
    expect(sent.payload).not.toHaveProperty('token');

    dispatch('SAVE_IMAGE_RESULT', { requestId: sent.payload.requestId, ok: true });
    await waitFor(() => expect(done).toBe(true));
  });

  it('saveImage({ imageId }) posts SAVE_IMAGE with imageId (no url)', async () => {
    const { result } = renderHook(() => useSaveImage());
    act(() => {
      void result.current.saveImage({ imageId: 55 }).catch(() => {});
    });
    const sent = lastSave(postMessageMock);
    expect(sent.payload.imageId).toBe(55);
    expect(sent.payload.url).toBeUndefined();
  });

  it('rejects with the host error string when the URL origin is disallowed', async () => {
    const { result } = renderHook(() => useSaveImage());
    let caught: Error | null = null;
    act(() => {
      void result.current.saveImage({ url: 'https://evil.example/x.png' }).catch((e: Error) => (caught = e));
    });
    const sent = lastSave(postMessageMock);
    dispatch('SAVE_IMAGE_RESULT', { requestId: sent.payload.requestId, ok: false, error: 'image url is not allowed' });
    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('image url is not allowed');
  });

  it('rejects when a withheld image cannot be saved (ok:false)', async () => {
    const { result } = renderHook(() => useSaveImage());
    let caught: Error | null = null;
    act(() => {
      void result.current.saveImage({ imageId: 42 }).catch((e: Error) => (caught = e));
    });
    const sent = lastSave(postMessageMock);
    dispatch('SAVE_IMAGE_RESULT', { requestId: sent.payload.requestId, ok: false, error: 'image is not available' });
    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('image is not available');
  });

  it('rejects with a generic message on ok:false with no error string', async () => {
    const { result } = renderHook(() => useSaveImage());
    let caught: Error | null = null;
    act(() => {
      void result.current.saveImage({ imageId: 42 }).catch((e: Error) => (caught = e));
    });
    const sent = lastSave(postMessageMock);
    dispatch('SAVE_IMAGE_RESULT', { requestId: sent.payload.requestId, ok: false });
    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('failed to save image');
  });
});

describe('isValidSaveImageResult (defense-in-depth)', () => {
  it('ACCEPTS a well-formed ok result', () => {
    expect(isValidSaveImageResult({ requestId: 'r', ok: true })).toBe(true);
  });
  it('ACCEPTS the ok:false + error variant', () => {
    expect(isValidSaveImageResult({ requestId: 'r', ok: false, error: 'nope' })).toBe(true);
  });
  // Uniform `{ ok, error }` reply contract: an error reply is ALWAYS valid, so
  // a host that omits `ok` on the error path no longer hangs the block. `ok`
  // stays required when there is no `error`.
  it('ACCEPTS an error-only reply (no ok)', () => {
    expect(isValidSaveImageResult({ requestId: 'r', error: 'nope' })).toBe(true);
  });
  it('REJECTS a reply with neither ok nor error', () => {
    expect(isValidSaveImageResult({ requestId: 'r' })).toBe(false);
  });
  it('REJECTS a non-string error', () => {
    expect(isValidSaveImageResult({ requestId: 'r', ok: false, error: 5 })).toBe(false);
  });
});
