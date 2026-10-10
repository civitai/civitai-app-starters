import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useUploadImageBytes } from '../src/hooks/useUploadImageBytes.js';
import { UPLOAD_BYTES_MAX_BYTES } from '../src/internal/uploadBytes.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../src/transport/requestTimeouts.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useUploadImageBytes()` against a hand-driven parent: what it posts, and how
 * it settles on each `IMAGE_UPLOAD_RESULT` the host (civitai/civitai#5639) can
 * send. Every reply here goes through the REAL transport and its payload
 * validator, so a validator that dropped the new `error` field shows up as a
 * hook that never settles.
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
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

type SentUpload = {
  payload: { requestId: string; bytes?: unknown; filename?: string; purpose?: string; asyncScan?: boolean };
};

const SELECTED = {
  imageId: 4321,
  nsfwLevel: 1,
  contentRating: 'pg',
  url: 'https://image.civitai.com/x/healed.png',
};

describe('useUploadImageBytes', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  const uploads = () =>
    postMessageMock.mock.calls.filter((c) => c[0]?.type === 'OPEN_IMAGE_UPLOAD').map((c) => c[0] as SentUpload);

  function dispatch(payload: unknown): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'IMAGE_UPLOAD_RESULT', payload }, origin: PARENT_ORIGIN }),
      );
    });
  }

  /** Start an upload WITHOUT awaiting it (a guard that fails to fire would hang). */
  function start(bytes: unknown, filename?: string) {
    const { result } = renderHook(() => useUploadImageBytes());
    const state: { value?: unknown; caught?: Error } = {};
    act(() => {
      void result.current
        .upload(bytes as ArrayBuffer, filename === undefined ? undefined : { filename })
        .then((v) => (state.value = v))
        .catch((e: Error) => (state.caught = e));
    });
    return state;
  }

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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('posts OPEN_IMAGE_UPLOAD with the SAME ArrayBuffer and the filename, and nothing else', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer as ArrayBuffer;
    start(bytes, 'healed.png');
    const sent = uploads();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.bytes).toBe(bytes);
    expect(Object.keys(sent[0]!.payload).sort()).toEqual(['bytes', 'filename', 'requestId']);
    expect(sent[0]!.payload.filename).toBe('healed.png');
    // No transfer list: the block keeps its buffer.
    expect(postMessageMock.mock.calls.at(-1)).toHaveLength(2);
  });

  it('omits `filename` when none is given', () => {
    start(new ArrayBuffer(4));
    expect(Object.keys(uploads()[0]!.payload).sort()).toEqual(['bytes', 'requestId']);
  });

  it('resolves with the moderated image', async () => {
    const state = start(new ArrayBuffer(4));
    dispatch({ requestId: uploads()[0]!.payload.requestId, selected: SELECTED });
    await waitFor(() => expect(state.value).toEqual(SELECTED));
  });

  it.each([
    'busy',
    'file type is not allowed',
    'invalid image-upload request',
    'no block token',
    'block lacks posts:write:self scope',
  ])('rejects with the host error string %j (the validator must accept `error`)', async (error) => {
    const state = start(new ArrayBuffer(4));
    dispatch({ requestId: uploads()[0]!.payload.requestId, error });
    await waitFor(() => expect(state.caught?.message).toBe(error));
    expect(state.value).toBeUndefined();
  });

  it('rejects on a falsy-but-PRESENT error with the fallback', async () => {
    const state = start(new ArrayBuffer(4));
    dispatch({ requestId: uploads()[0]!.payload.requestId, error: '' });
    await waitFor(() => expect(state.caught?.message).toBe('image upload failed'));
  });

  it.each([
    ['no `selected` (an older host whose picker was dismissed)', undefined],
    ['a pending handle', { status: 'pending', imageId: 9, url: 'https://image.civitai.com/p.png' }],
    ['a generation-source shape', { url: 'https://image.civitai.com/s.png', width: 8, height: 8 }],
  ])('rejects on %s with the no-image error', async (_n, selected) => {
    const state = start(new ArrayBuffer(4));
    dispatch({ requestId: uploads()[0]!.payload.requestId, ...(selected ? { selected } : {}) });
    await waitFor(() => expect(state.caught?.message).toBe('the host returned no uploaded image'));
  });

  it('refuses a buffer over the 40 MiB cap BEFORE sending, with the host string', async () => {
    const state = start(new ArrayBuffer(UPLOAD_BYTES_MAX_BYTES + 1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(uploads()).toHaveLength(0);
    expect(state.caught?.message).toBe('file exceeds the maximum upload size');
  });

  it('sends a buffer of exactly the cap', () => {
    start(new ArrayBuffer(UPLOAD_BYTES_MAX_BYTES));
    expect(uploads()).toHaveLength(1);
  });

  it('pins the cap to 40 MiB, the host’s BLOCK_IMAGE_MAX_BYTES', () => {
    expect(UPLOAD_BYTES_MAX_BYTES).toBe(41_943_040);
  });

  it('forwards a non-ArrayBuffer for the host to refuse (no other client-side check)', () => {
    const view = new Uint8Array(4);
    start(view);
    expect(uploads()[0]!.payload.bytes).toBe(view);
  });

  it('waits the human-interaction bound, not the 30 s protocol default', async () => {
    vi.useFakeTimers();
    const state = start(new ArrayBuffer(4));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HUMAN_INTERACTION_TIMEOUT_MS - 1);
    });
    expect(state.caught).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(state.caught).toBeInstanceOf(Error);
  });
});
