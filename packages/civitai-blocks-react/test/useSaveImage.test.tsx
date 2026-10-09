import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SAVE_BYTES_MAX_BYTES, type BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useSaveImage } from '../src/hooks/useSaveImage.js';
import { getTransport } from '../src/transport/singleton.js';
import { isValidSaveImageResult } from '../src/transport/validate.js';
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
type SentSave = {
  payload: {
    requestId: string;
    url?: string;
    imageId?: number;
    bytes?: ArrayBuffer;
    mimeType?: string;
    filename?: string;
  };
};
function lastSave(mock: ReturnType<typeof vi.fn>): SentSave {
  const c = calls(mock, 'SAVE_IMAGE');
  return c[c.length - 1]![0] as SentSave;
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

  // `error: ''` is FALSY but PRESENT. The reply validator early-accepts on
  // presence and therefore SKIPS the success-field checks, so a hook testing
  // `error` for truthiness would sail past and RESOLVE a failed save.
  it('rejects on a falsy-but-PRESENT error (ok:true, error:"")', async () => {
    const { result } = renderHook(() => useSaveImage());
    let caught: Error | null = null;
    act(() => {
      void result.current.saveImage({ imageId: 42 }).catch((e: Error) => (caught = e));
    });
    const sent = lastSave(postMessageMock);
    dispatch('SAVE_IMAGE_RESULT', { requestId: sent.payload.requestId, ok: true, error: '' });
    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('failed to save image');
  });
});

describe('useSaveImage — the bytes variant', () => {
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

  /** Run a save expected to be refused BEFORE anything is posted. */
  // Does NOT await the save: a guard that fails to fire would leave it pending
  // on a reply that never comes, and the test would die on the generic test
  // timeout rather than on the assertion naming what went wrong.
  async function refusedLocally(input: unknown): Promise<Error> {
    const { result } = renderHook(() => useSaveImage());
    let caught: Error | null = null;
    act(() => {
      void result.current
        .saveImage(input as Parameters<typeof result.current.saveImage>[0])
        .catch((e: Error) => (caught = e));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls(postMessageMock, 'SAVE_IMAGE')).toHaveLength(0);
    expect(caught).not.toBeNull();
    return caught as unknown as Error;
  }

  it('posts the SAME ArrayBuffer (not a copy, not a view) with the hints, and no url/imageId', async () => {
    const bytes = new TextEncoder().encode('{"a":1}').buffer as ArrayBuffer;
    const { result } = renderHook(() => useSaveImage());
    let done = false;
    act(() => {
      void result.current
        .saveImage({ bytes, filename: 'sidecar.json', mimeType: 'application/json' })
        .then(() => (done = true));
    });
    const sent = lastSave(postMessageMock);
    // The transport hands postMessage the caller's buffer by reference; the
    // browser's structured clone makes the copy. No transfer list — see below.
    expect(sent.payload.bytes).toBe(bytes);
    expect(sent.payload.filename).toBe('sidecar.json');
    expect(sent.payload.mimeType).toBe('application/json');
    expect(sent.payload).not.toHaveProperty('url');
    expect(sent.payload).not.toHaveProperty('imageId');
    dispatch('SAVE_IMAGE_RESULT', { requestId: sent.payload.requestId, ok: true });
    await waitFor(() => expect(done).toBe(true));
  });

  it('never TRANSFERS the buffer — postMessage gets no transfer list, so the caller keeps its bytes', () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { result } = renderHook(() => useSaveImage());
    act(() => {
      void result.current.saveImage({ bytes }).catch(() => {});
    });
    const call = calls(postMessageMock, 'SAVE_IMAGE').at(-1)!;
    // (message, targetOrigin) — a third `transfer` argument would detach it.
    expect(call).toHaveLength(2);
    expect(bytes.byteLength).toBe(3);
  });

  it('refuses a non-ArrayBuffer `bytes` (a Uint8Array) before sending, with the host string', async () => {
    const err = await refusedLocally({ bytes: new Uint8Array([0x89, 0x50]) });
    expect(err.message).toBe('invalid save-image request');
  });

  it('refuses a Blob passed as `bytes` before sending', async () => {
    const err = await refusedLocally({ bytes: new Blob(['x']) });
    expect(err.message).toBe('invalid save-image request');
  });

  it('refuses bytes + url (not exactly one variant) before sending', async () => {
    const err = await refusedLocally({ bytes: new ArrayBuffer(1), url: 'https://image.civitai.com/x.png' });
    expect(err.message).toBe('invalid save-image request');
  });

  it('refuses bytes + imageId before sending', async () => {
    const err = await refusedLocally({ bytes: new ArrayBuffer(1), imageId: 5 });
    expect(err.message).toBe('invalid save-image request');
  });

  it('refuses url + imageId, and an input with no variant, before sending', async () => {
    expect((await refusedLocally({ url: 'https://image.civitai.com/x.png', imageId: 5 })).message).toBe(
      'invalid save-image request',
    );
    expect((await refusedLocally({ filename: 'x.png' })).message).toBe('invalid save-image request');
  });

  it('refuses a buffer ONE byte over SAVE_BYTES_MAX_BYTES before sending', async () => {
    const err = await refusedLocally({ bytes: new ArrayBuffer(SAVE_BYTES_MAX_BYTES + 1) });
    expect(err.message).toBe('file exceeds the maximum save size');
  });

  it('SENDS a buffer of exactly SAVE_BYTES_MAX_BYTES (the cap is inclusive)', () => {
    const { result } = renderHook(() => useSaveImage());
    act(() => {
      void result.current.saveImage({ bytes: new ArrayBuffer(SAVE_BYTES_MAX_BYTES) }).catch(() => {});
    });
    expect(lastSave(postMessageMock).payload.bytes!.byteLength).toBe(SAVE_BYTES_MAX_BYTES);
  });

  it('pins the cap to the contract value, 50 MiB', () => {
    expect(SAVE_BYTES_MAX_BYTES).toBe(52_428_800);
  });

  it('surfaces a pre-variant host refusal verbatim', async () => {
    const { result } = renderHook(() => useSaveImage());
    let caught: Error | null = null;
    act(() => {
      void result.current.saveImage({ bytes: new ArrayBuffer(4) }).catch((e: Error) => (caught = e));
    });
    const sent = lastSave(postMessageMock);
    dispatch('SAVE_IMAGE_RESULT', { requestId: sent.payload.requestId, ok: false, error: 'invalid save-image request' });
    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('invalid save-image request');
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
