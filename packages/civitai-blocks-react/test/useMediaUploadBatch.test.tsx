import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useMediaUpload } from '../src/hooks/useMediaUpload.js';
import { MEDIA_UPLOAD_BATCH_MAX_BYTES, MEDIA_UPLOAD_BATCH_MAX_ITEMS } from '../src/internal/mediaUploadBytes.js';
import {
  HUMAN_INTERACTION_TIMEOUT_MS,
  MEDIA_UPLOAD_BATCH_PER_ITEM_TIMEOUT_MS,
} from '../src/transport/requestTimeouts.js';
import { getTransport } from '../src/transport/singleton.js';
import { RequestTimeoutError } from '../src/transport/transport.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useMediaUpload().uploadBatch()` against a hand-driven parent: what it posts,
 * the WHOLE-BATCH problems it refuses before posting (and the per-item ones it
 * deliberately does not), and how it settles on each `MEDIA_UPLOAD_BATCH_RESULT`
 * the host can send. Every reply goes through the REAL transport and its
 * payload validator, so a validator that dropped a well-formed reply shows up as
 * a call that never settles.
 */

const PARENT_ORIGIN = 'https://civitai.com';

// The contract's limits, spelled as literals so a changed constant cannot move the test with it.
const MAX_ITEMS = 1200;
const MAX_BYTES = 10_737_418_240; // 10 GiB
const VIDEO_CAP = 67_108_864; // 64 MiB: 160 of these are exactly 10 GiB

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

type Sent = { payload: { requestId: string; purpose: string; items: Array<Record<string, unknown>> } };

const IMAGE = {
  url: 'https://media.example/generation-input/a.jpeg',
  kind: 'image',
  mimeType: 'image/jpeg',
  sizeBytes: 182_311,
  width: 1024,
  height: 768,
};
const AUDIO = {
  url: 'https://media.example/generation-input/voice.wav',
  kind: 'audio',
  mimeType: 'audio/wav',
  sizeBytes: 96_000,
};
const EXPIRES = '2026-11-18T12:00:00.000Z';

describe('useMediaUpload().uploadBatch', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  const sent = () =>
    postMessageMock.mock.calls.filter((c) => c[0]?.type === 'OPEN_MEDIA_UPLOAD_BATCH').map((c) => c[0] as Sent);

  function dispatch(payload: unknown): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'MEDIA_UPLOAD_BATCH_RESULT', payload },
          origin: PARENT_ORIGIN,
        }),
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

  const small = () => new ArrayBuffer(4);
  const many = (n: number, bytes: ArrayBuffer = small()) =>
    Array.from({ length: n }, () => ({ kind: 'image' as const, bytes }));

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

  // ── What it posts ───────────────────────────────────────────────────────────
  it('posts exactly requestId, purpose and items, each with the SAME ArrayBuffer and mimeType only when given', () => {
    const a = new ArrayBuffer(8);
    const b = new ArrayBuffer(16);
    start((h) => h.uploadBatch([{ kind: 'image', bytes: a }, { kind: 'audio', bytes: b, mimeType: 'audio/wav' }]));
    const out = sent();
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]!.payload).sort()).toEqual(['items', 'purpose', 'requestId']);
    expect(out[0]!.payload.purpose).toBe('generationSource');
    expect(out[0]!.payload.items.map((i) => Object.keys(i).sort())).toEqual([
      ['bytes', 'kind'],
      ['bytes', 'kind', 'mimeType'],
    ]);
    expect(out[0]!.payload.items[0]!.bytes).toBe(a);
    expect(out[0]!.payload.items[1]!.bytes).toBe(b);
    expect(out[0]!.payload.items[1]!.mimeType).toBe('audio/wav');
    // No transfer list: the block keeps its buffers.
    expect(postMessageMock.mock.calls.at(-1)).toHaveLength(2);
  });

  it('does NOT refuse a per-item problem before sending: the host answers it in that item’s result', () => {
    start((h) =>
      h.uploadBatch([
        { kind: 'gif' as never, bytes: small() },
        { kind: 'image', bytes: new ArrayBuffer(0) },
        { kind: 'video', bytes: new Uint8Array(4) as never },
        { kind: 'image', bytes: new ArrayBuffer(25_165_824 + 1) },
        { kind: 'audio', bytes: small(), mimeType: 5 as never },
      ]),
    );
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.payload.items).toHaveLength(5);
  });

  // ── Whole-batch refusals before sending ─────────────────────────────────────
  it.each([
    ['items not an array', () => 'nope', 'invalid media-upload batch request'],
    ['an entry that is null', () => [{ kind: 'image', bytes: new ArrayBuffer(4) }, null], 'invalid media-upload batch request'],
    ['an entry that is a string', () => ['image'], 'invalid media-upload batch request'],
    ['an entry that is an array', () => [[]], 'invalid media-upload batch request'],
    ['no items', () => [], 'a batch holds 1 to 1200 files'],
    ['1201 items', () => many(1201), 'a batch holds 1 to 1200 files'],
    // 161 x 64 MiB = 10 GiB + 64 MiB (one buffer, referenced 161 times).
    ['more than 10 GB in total', () => many(161, new ArrayBuffer(VIDEO_CAP)), 'the batch exceeds the 10 GB limit'],
    // 160 x 64 MiB + 1 byte = 10,737,418,241 bytes: one byte over.
    [
      'one byte over 10 GB',
      () => [...many(160, new ArrayBuffer(VIDEO_CAP)), { kind: 'image', bytes: new ArrayBuffer(1) }],
      'the batch exceeds the 10 GB limit',
    ],
    // The shape is checked first: a 1201-item batch holding a null is invalid, not too many.
    ['1201 items, one of them null', () => [...many(1200), null], 'invalid media-upload batch request'],
    // The count before the bytes.
    ['1201 items over 10 GB', () => many(1201, new ArrayBuffer(VIDEO_CAP)), 'a batch holds 1 to 1200 files'],
  ])('refuses %s BEFORE sending, with the host string', async (_n, items, message) => {
    const state = start((h) => h.uploadBatch(items() as never));
    await flush();
    expect(sent()).toHaveLength(0);
    expect(state.caught?.message).toBe(message);
  });

  it.each([
    ['1 item', () => many(1)],
    ['exactly 1200 items', () => many(1200)],
    // 160 x 64 MiB = exactly 10,737,418,240 bytes.
    ['exactly 10 GB in total', () => many(160, new ArrayBuffer(VIDEO_CAP))],
    // 100 x 64 MiB = 6.25 GiB: over the old 5 GiB, under 10 GiB.
    ['6.25 GiB in total (between 5 and 10 GiB)', () => many(100, new ArrayBuffer(VIDEO_CAP))],
  ])('sends %s', (_n, items) => {
    start((h) => h.uploadBatch(items()));
    expect(sent()).toHaveLength(1);
  });

  it('pins the batch limits: 1200 items and 10 GiB', () => {
    expect(MEDIA_UPLOAD_BATCH_MAX_ITEMS).toBe(MAX_ITEMS);
    expect(MEDIA_UPLOAD_BATCH_MAX_BYTES).toBe(MAX_BYTES);
  });

  // ── How it settles ──────────────────────────────────────────────────────────
  it('resolves { results, expiresAt } when the batch ran, per-item errors included', async () => {
    const state = start((h) => h.uploadBatch([{ kind: 'image', bytes: small() }, { kind: 'audio', bytes: small() }, { kind: 'image', bytes: small() }]));
    const results = [
      { index: 0, selected: IMAGE },
      { index: 1, selected: AUDIO },
      { index: 2, error: 'this image was refused by the upload service' },
    ];
    dispatch({ requestId: sent()[0]!.payload.requestId, results, expiresAt: EXPIRES });
    await waitFor(() => expect(state.value).toEqual({ results, expiresAt: EXPIRES }));
  });

  it('resolves null on a bare reply: the viewer declined the confirm (or the host declined at once)', async () => {
    const state = start((h) => h.uploadBatch(many(3)));
    dispatch({ requestId: sent()[0]!.payload.requestId });
    await waitFor(() => expect(state.settled).toBe(true));
    expect(state.value).toBeNull();
    expect(state.caught).toBeUndefined();
  });

  it.each([
    'busy',
    'no block token',
    'unsupported on this host',
    'a batch holds 1 to 1200 files',
    'the batch exceeds the 10 GB limit',
    "You've reached today's batch upload limit (1,200 files or 10 GB). It resets at midnight UTC.",
  ])('REJECTS with a whole-batch host error %j (never null)', async (error) => {
    const state = start((h) => h.uploadBatch(many(2)));
    dispatch({ requestId: sent()[0]!.payload.requestId, error });
    await waitFor(() => expect(state.caught?.message).toBe(error));
    expect(state.settled).toBeUndefined();
  });

  it('rejects on a falsy-but-present error with the fallback', async () => {
    const state = start((h) => h.uploadBatch(many(1)));
    dispatch({ requestId: sent()[0]!.payload.requestId, error: '' });
    await waitFor(() => expect(state.caught?.message).toBe('media upload failed'));
  });

  it.each([
    ['one result too few', [{ index: 0, selected: IMAGE }]],
    ['one result too many', [{ index: 0, selected: IMAGE }, { index: 1, selected: IMAGE }, { index: 2, selected: IMAGE }]],
    ['the indices out of order', [{ index: 1, selected: IMAGE }, { index: 0, selected: IMAGE }]],
    ['an index repeated', [{ index: 0, selected: IMAGE }, { index: 0, error: 'busy' }]],
  ])('rejects results that do not line up with the items: %s', async (_n, results) => {
    const state = start((h) => h.uploadBatch(many(2)));
    dispatch({ requestId: sent()[0]!.payload.requestId, results, expiresAt: EXPIRES });
    await waitFor(() =>
      expect(state.caught?.message).toBe('the host answered the batch with results that do not match its items'),
    );
    expect(state.settled).toBeUndefined();
  });

  it('drops a malformed reply (an entry with both selected and error) and settles on the next valid one', async () => {
    const state = start((h) => h.uploadBatch(many(1)));
    const requestId = sent()[0]!.payload.requestId;
    dispatch({ requestId, results: [{ index: 0, selected: IMAGE, error: 'busy' }], expiresAt: EXPIRES });
    await flush();
    expect(state.settled).toBeUndefined();
    expect(state.caught).toBeUndefined();
    dispatch({ requestId, results: [{ index: 0, selected: IMAGE }], expiresAt: EXPIRES });
    await waitFor(() => expect(state.value).toEqual({ results: [{ index: 0, selected: IMAGE }], expiresAt: EXPIRES }));
  });

  // ── Timeout ─────────────────────────────────────────────────────────────────
  it('pins the per-item timeout to 60 s', () => {
    expect(MEDIA_UPLOAD_BATCH_PER_ITEM_TIMEOUT_MS).toBe(60_000);
  });

  it.each([1, 3])(
    'waits the human bound plus 60 s per item by default (%i items)',
    async (n) => {
      vi.useFakeTimers();
      const state = start((h) => h.uploadBatch(many(n)));
      // 10 minutes for the viewer, plus a minute per file.
      const bound = 600_000 + 60_000 * n;
      expect(bound).toBe(HUMAN_INTERACTION_TIMEOUT_MS + MEDIA_UPLOAD_BATCH_PER_ITEM_TIMEOUT_MS * n);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(bound - 1);
      });
      expect(state.caught).toBeUndefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
      expect(state.caught).toBeInstanceOf(RequestTimeoutError);
    },
  );

  it('`timeoutMs` replaces the whole bound', async () => {
    vi.useFakeTimers();
    const state = start((h) => h.uploadBatch(many(3), { timeoutMs: 5_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(state.caught).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(state.caught).toBeInstanceOf(RequestTimeoutError);
  });

  it('`timeoutMs` can also lengthen it past the default', async () => {
    vi.useFakeTimers();
    const state = start((h) => h.uploadBatch(many(1), { timeoutMs: 2 * 60 * 60_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000 + 60_000 + 1);
    });
    expect(state.caught).toBeUndefined();
    dispatch({ requestId: sent()[0]!.payload.requestId });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state.settled).toBe(true);
    expect(state.value).toBeNull();
  });
});
