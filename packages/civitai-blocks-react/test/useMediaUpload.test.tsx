import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useMediaUpload } from '../src/hooks/useMediaUpload.js';
import { MEDIA_UPLOAD_MAX_BYTES } from '../src/internal/mediaUploadBytes.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../src/transport/requestTimeouts.js';
import { getTransport } from '../src/transport/singleton.js';
import { RequestTimeoutError } from '../src/transport/transport.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useMediaUpload()` against a hand-driven parent: what it posts, what it
 * refuses before posting, and how it settles on each `MEDIA_UPLOAD_RESULT` the
 * host can send. Every reply goes through the REAL transport and its payload
 * validator, so a validator that dropped a well-formed reply shows up as a hook
 * that never settles.
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

type Sent = { payload: Record<string, unknown> & { requestId: string } };

const VIDEO = {
  url: 'https://media.example/generation-input/clip.mp4',
  kind: 'video',
  mimeType: 'video/mp4',
  sizeBytes: 4_812_330,
  width: 1280,
  height: 720,
  durationMs: 5_000,
};
const AUDIO = {
  url: 'https://media.example/generation-input/voice.webm',
  kind: 'audio',
  mimeType: 'audio/webm',
  sizeBytes: 96_000,
};

describe('useMediaUpload', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  const sent = () =>
    postMessageMock.mock.calls.filter((c) => c[0]?.type === 'OPEN_MEDIA_UPLOAD').map((c) => c[0] as Sent);

  function dispatch(payload: unknown): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'MEDIA_UPLOAD_RESULT', payload }, origin: PARENT_ORIGIN }),
      );
    });
  }

  /** Start a call WITHOUT awaiting it (a guard that fails to fire would hang). */
  function start<T>(call: (hook: ReturnType<typeof useMediaUpload>) => Promise<T>) {
    const { result } = renderHook(() => useMediaUpload());
    const state: { value?: T | null; settled?: boolean; caught?: Error } = {};
    act(() => {
      void call(result.current)
        .then((v) => {
          state.value = v;
          state.settled = true;
        })
        .catch((e: Error) => (state.caught = e));
    });
    return state;
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
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

  // ── Picker mode ─────────────────────────────────────────────────────────────
  it.each(['image', 'video', 'audio'] as const)(
    'open({ kind: %j }) posts exactly requestId, kind and purpose (no bytes)',
    (kind) => {
      start((h) => h.open({ kind }));
      const out = sent();
      expect(out).toHaveLength(1);
      expect(Object.keys(out[0]!.payload).sort()).toEqual(['kind', 'purpose', 'requestId']);
      expect(out[0]!.payload).toMatchObject({ kind, purpose: 'generationSource' });
    },
  );

  it('open resolves with the uploaded file', async () => {
    const state = start((h) => h.open({ kind: 'video' }));
    dispatch({ requestId: sent()[0]!.payload.requestId, selected: VIDEO });
    await waitFor(() => expect(state.value).toEqual(VIDEO));
  });

  it('open resolves null on a bare reply (dismissed or declined)', async () => {
    const state = start((h) => h.open({ kind: 'audio' }));
    dispatch({ requestId: sent()[0]!.payload.requestId });
    await waitFor(() => expect(state.settled).toBe(true));
    expect(state.value).toBeNull();
    expect(state.caught).toBeUndefined();
  });

  it.each(['unsupported on this host', 'videos must be MP4 or WebM', 'this file has no video track'])(
    'open REJECTS with a host error %j (never null)',
    async (error) => {
      const state = start((h) => h.open({ kind: 'video' }));
      dispatch({ requestId: sent()[0]!.payload.requestId, error });
      await waitFor(() => expect(state.caught?.message).toBe(error));
      expect(state.settled).toBeUndefined();
    },
  );

  it('open rejects on a falsy-but-present error with the fallback', async () => {
    const state = start((h) => h.open({ kind: 'image' }));
    dispatch({ requestId: sent()[0]!.payload.requestId, error: '' });
    await waitFor(() => expect(state.caught?.message).toBe('media upload failed'));
  });

  it('open refuses an unknown kind BEFORE sending, with the host string', async () => {
    const state = start((h) => h.open({ kind: 'gif' as never }));
    await flush();
    expect(sent()).toHaveLength(0);
    expect(state.caught?.message).toBe("kind must be 'image', 'video' or 'audio'");
  });

  it('drops a malformed reply (a video with no dimensions) and settles on the next valid one', async () => {
    const state = start((h) => h.open({ kind: 'video' }));
    const requestId = sent()[0]!.payload.requestId;
    dispatch({ requestId, selected: { ...VIDEO, width: undefined } });
    await flush();
    expect(state.settled).toBeUndefined();
    expect(state.caught).toBeUndefined();
    dispatch({ requestId, selected: VIDEO });
    await waitFor(() => expect(state.value).toEqual(VIDEO));
  });

  // ── Bytes mode ──────────────────────────────────────────────────────────────
  it('upload posts the SAME ArrayBuffer with kind, purpose and mimeType', () => {
    const bytes = new ArrayBuffer(8);
    start((h) => h.upload({ kind: 'audio', bytes, mimeType: 'audio/webm;codecs=opus' }));
    const out = sent();
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]!.payload).sort()).toEqual(['bytes', 'kind', 'mimeType', 'purpose', 'requestId']);
    expect(out[0]!.payload.bytes).toBe(bytes);
    expect(out[0]!.payload).toMatchObject({
      kind: 'audio',
      purpose: 'generationSource',
      mimeType: 'audio/webm;codecs=opus',
    });
    // No transfer list: the block keeps its buffer.
    expect(postMessageMock.mock.calls.at(-1)).toHaveLength(2);
  });

  it('upload omits mimeType when none is given', () => {
    start((h) => h.upload({ kind: 'image', bytes: new ArrayBuffer(4) }));
    expect(Object.keys(sent()[0]!.payload).sort()).toEqual(['bytes', 'kind', 'purpose', 'requestId']);
  });

  it('upload resolves with the uploaded file', async () => {
    const state = start((h) => h.upload({ kind: 'audio', bytes: new ArrayBuffer(4) }));
    dispatch({ requestId: sent()[0]!.payload.requestId, selected: AUDIO });
    await waitFor(() => expect(state.value).toEqual(AUDIO));
  });

  it('upload REJECTS on a bare reply: the host declined, nothing was uploaded', async () => {
    const state = start((h) => h.upload({ kind: 'image', bytes: new ArrayBuffer(4) }));
    dispatch({ requestId: sent()[0]!.payload.requestId });
    await waitFor(() =>
      expect(state.caught?.message).toBe('the host did not upload the media (the app is in review mode or not ready)'),
    );
    expect(state.settled).toBeUndefined();
  });

  it.each([
    'busy',
    'file exceeds the 64 MB upload limit',
    "mimeType does not match the file's content",
    'audio must be MP3, WAV or WebM',
    'could not read this audio file',
    'unsupported on this host',
  ])('upload rejects with the host error %j', async (error) => {
    const state = start((h) => h.upload({ kind: 'audio', bytes: new ArrayBuffer(4) }));
    dispatch({ requestId: sent()[0]!.payload.requestId, error });
    await waitFor(() => expect(state.caught?.message).toBe(error));
  });

  it.each([
    ['an unknown kind', { kind: 'gif', bytes: new ArrayBuffer(4) }, "kind must be 'image', 'video' or 'audio'"],
    ['a Uint8Array (a view is refused, not unwrapped)', { kind: 'image', bytes: new Uint8Array(4) }, 'invalid media-upload request'],
    ['a Blob', { kind: 'image', bytes: new Blob(['x']) }, 'invalid media-upload request'],
    ['an empty buffer', { kind: 'video', bytes: new ArrayBuffer(0) }, 'invalid media-upload request'],
    ['a non-string mimeType', { kind: 'video', bytes: new ArrayBuffer(4), mimeType: 5 }, 'invalid media-upload request'],
    ['a buffer over the 64 MB cap', { kind: 'video', bytes: new ArrayBuffer(64 * 1024 * 1024 + 1) }, 'file exceeds the 64 MB upload limit'],
  ])('upload refuses %s BEFORE sending, with the host string', async (_n, options, message) => {
    const state = start((h) => h.upload(options as never));
    await flush();
    expect(sent()).toHaveLength(0);
    expect(state.caught?.message).toBe(message);
  });

  it('upload sends a buffer of exactly the cap', () => {
    start((h) => h.upload({ kind: 'video', bytes: new ArrayBuffer(MEDIA_UPLOAD_MAX_BYTES) }));
    expect(sent()).toHaveLength(1);
  });

  it('pins the cap to 64 MiB, the consumer-blob upload cap', () => {
    expect(MEDIA_UPLOAD_MAX_BYTES).toBe(67_108_864);
  });

  it.each([
    ['open', (h: ReturnType<typeof useMediaUpload>) => h.open({ kind: 'video' })],
    ['upload', (h: ReturnType<typeof useMediaUpload>) => h.upload({ kind: 'video', bytes: new ArrayBuffer(4) })],
  ])('%s waits the human-interaction bound, not the 30 s protocol default', async (_n, call) => {
    vi.useFakeTimers();
    const state = start(call);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HUMAN_INTERACTION_TIMEOUT_MS - 1);
    });
    expect(state.caught).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(state.caught).toBeInstanceOf(RequestTimeoutError);
  });
});
