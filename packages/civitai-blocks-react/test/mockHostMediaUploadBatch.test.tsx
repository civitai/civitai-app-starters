import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BlockMediaUploadBatchItemResult,
  BlockMediaUploadInfo,
  ModelSlotContext,
} from '@civitai/app-sdk/blocks';

import { useMediaUpload } from '../src/hooks/useMediaUpload.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import type { MockHost, MockHostOptions } from '../src/testing.js';

/**
 * `createMockHost`'s `OPEN_MEDIA_UPLOAD_BATCH` handler, driven through the REAL
 * hook, transport and validator, plus the raw bridge for requests the hook
 * refuses to send.
 *
 * 🔴 WHAT THIS CANNOT PROVE: that the PRODUCTION host admits the same batches.
 * The mock's rules are a hand port of the bridge contract. Nor does the mock
 * model the server-side daily quota, a batch still running (`busy`), or the
 * upload-time scan refusals: those are forced with `mediaUploadBatchError`.
 */

const ORIGIN = window.location.origin;

// The contract's limits, spelled as literals so a changed constant cannot move the test with it.
const CAP = 67_108_864; // one video or audio file
const IMAGE_CAP = 25_165_824; // one image

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const GIF = new Uint8Array([...ascii('GIF89a'), 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypisom'), 0, 0, 2, 0]);
const WAV = new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')]);

function buf(view: Uint8Array): ArrayBuffer {
  return view.slice().buffer as ArrayBuffer;
}
/** A buffer of exactly `size` bytes that starts with `head`. */
function sized(head: Uint8Array, size: number): ArrayBuffer {
  const u8 = new Uint8Array(size);
  u8.set(head);
  return u8.buffer;
}

type Reply = {
  requestId?: string;
  error?: string;
  results?: BlockMediaUploadBatchItemResult[];
  expiresAt?: string;
};

const MODEL_SLOT: ModelSlotContext = {
  slotId: 'model.sidebar_top',
  modelId: 11,
  modelVersionId: 22,
  modelName: 'Fixture model',
  modelType: 'Checkpoint',
  modelNsfwLevel: 1,
};

const DEFAULT_IMAGE = {
  url: 'https://media.mock.invalid/generation-input/dev-image.jpeg',
  kind: 'image',
  mimeType: 'image/jpeg',
  sizeBytes: 182_311,
  width: 1024,
  height: 768,
};

describe('createMockHost — OPEN_MEDIA_UPLOAD_BATCH', () => {
  let host: MockHost | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function install(options: MockHostOptions = {}) {
    host = createMockHost(options);
    uninstall = host.install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    return renderHook(() => useMediaUpload()).result;
  }

  /** The raw bridge, past the hook's own pre-send checks. */
  async function raw(payload: Record<string, unknown>): Promise<Reply> {
    return (await getTransport().sendRequest(
      { type: 'OPEN_MEDIA_UPLOAD_BATCH', payload } as never,
      'MEDIA_UPLOAD_BATCH_RESULT',
    )) as Reply;
  }
  const batch = (items: unknown[], extra: Record<string, unknown> = {}) =>
    raw({ purpose: 'generationSource', items, ...extra });
  /** The per-item errors of a batch that ran (undefined = uploaded). */
  const errors = (reply: Reply) => reply.results?.map((r) => r.error);

  async function settle<T>(p: Promise<T>) {
    let out: { value?: T; error?: string } = {};
    await act(async () => {
      out = await p.then(
        (value) => ({ value }),
        (e: Error) => ({ error: e.message }),
      );
    });
    return out;
  }

  // ── A batch that runs, through the real hook ───────────────────────────────
  it('answers one result per item, in order, with the kind’s canned upload and expiresAt 30 days out', async () => {
    const hook = await install();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const out = await settle(
      hook.current.uploadBatch([
        { kind: 'image', bytes: buf(PNG) },
        { kind: 'video', bytes: buf(MP4), mimeType: 'video/mp4' },
        { kind: 'audio', bytes: buf(WAV) },
      ]),
    );
    expect(out.value).toEqual({
      results: [
        { index: 0, selected: DEFAULT_IMAGE },
        {
          index: 1,
          selected: {
            url: 'https://media.mock.invalid/generation-input/dev-video.mp4',
            kind: 'video',
            mimeType: 'video/mp4',
            sizeBytes: MP4.length,
            width: 1280,
            height: 720,
            durationMs: 5_000,
          },
        },
        {
          index: 2,
          selected: {
            url: 'https://media.mock.invalid/generation-input/dev-audio.mp3',
            kind: 'audio',
            mimeType: 'audio/wav',
            sizeBytes: WAV.length,
            durationMs: 30_000,
          },
        },
      ],
      // 1_800_000_000_000 (2027-01-15T08:00Z) + 30 days.
      expiresAt: '2027-02-14T08:00:00.000Z',
    });
  });

  it('answers each valid item with its kind’s cannedMediaUploads entry (null = the default)', async () => {
    const clip: BlockMediaUploadInfo = {
      url: 'https://media.example/generation-input/clip.webm',
      kind: 'video',
      mimeType: 'video/webm',
      sizeBytes: 1234,
      width: 640,
      height: 360,
    };
    await install({ cannedMediaUploads: { video: clip, audio: null } });
    const reply = await batch([
      { kind: 'video', bytes: buf(MP4) },
      { kind: 'audio', bytes: buf(WAV) },
    ]);
    // Video: the canned clip, carrying the sniffed type and the buffer's size.
    expect(reply.results?.[0]?.selected).toEqual({ ...clip, mimeType: 'video/mp4', sizeBytes: MP4.length });
    // Audio canned null: bytes have no picker to dismiss, so the default answers.
    expect(reply.results?.[1]?.selected?.url).toBe('https://media.mock.invalid/generation-input/dev-audio.mp3');
  });

  // ── Per-item checks: the single upload's, in its order ─────────────────────
  it('answers each refused item in its own result, with the single upload’s strings, and uploads the rest', async () => {
    await install();
    const reply = await batch([
      { kind: 'image', bytes: buf(PNG) },
      { kind: 'gif', bytes: buf(PNG) },
      { kind: 'image', bytes: new ArrayBuffer(0) },
      { kind: 'image', bytes: PNG.slice() },
      { kind: 'image', bytes: 'iVBORw0KGgo=' },
      { kind: 'image' },
      { kind: 'image', bytes: buf(PNG), mimeType: 7 },
      { kind: 'image', bytes: buf(GIF) },
      { kind: 'video', bytes: buf(WAV) },
      { kind: 'audio', bytes: buf(PNG) },
      { kind: 'image', bytes: buf(PNG), mimeType: 'image/jpeg' },
      { kind: 'audio', bytes: buf(WAV), mimeType: 'audio/x-wav' },
    ]);
    expect(reply.results?.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(errors(reply)).toEqual([
      undefined,
      "kind must be 'image', 'video' or 'audio'",
      'invalid media-upload request',
      'invalid media-upload request',
      'invalid media-upload request',
      'invalid media-upload request',
      'invalid media-upload request',
      'images must be PNG, JPEG or WebP',
      'videos must be MP4 or WebM',
      'audio must be MP3, WAV or WebM',
      "mimeType does not match the file's content",
      undefined,
    ]);
    // Exactly one of selected / error per entry.
    for (const r of reply.results!) expect(r.selected === undefined).toBe(r.error !== undefined);
  });

  it('caps each item by its kind: 24 MiB for an image, 64 MiB for video and audio (exactly the cap uploads)', async () => {
    await install();
    const reply = await batch([
      { kind: 'image', bytes: sized(PNG, IMAGE_CAP) },
      { kind: 'image', bytes: sized(PNG, IMAGE_CAP + 1) },
      // Under the media cap, over the image one.
      { kind: 'image', bytes: sized(PNG, 33_554_432) },
      { kind: 'video', bytes: sized(MP4, CAP) },
      { kind: 'video', bytes: sized(MP4, CAP + 1) },
      { kind: 'audio', bytes: sized(WAV, CAP + 1) },
    ]);
    expect(errors(reply)).toEqual([
      undefined,
      'file exceeds the 24 MB image upload limit',
      'file exceeds the 24 MB image upload limit',
      undefined,
      'file exceeds the 64 MB upload limit',
      'file exceeds the 64 MB upload limit',
    ]);
    expect(reply.results?.[3]?.selected?.sizeBytes).toBe(CAP);
  });

  it('checks an item in the single upload’s order: kind, buffer, cap, type, mimeType', async () => {
    await install();
    const reply = await batch([
      // A bad kind AND an empty buffer: the kind first.
      { kind: 'Image', bytes: new ArrayBuffer(0) },
      // An empty buffer AND a bad mimeType: invalid (one string for both).
      { kind: 'image', bytes: new ArrayBuffer(0), mimeType: 1 },
      // Over the cap AND a GIF: too large before the content is looked at.
      { kind: 'image', bytes: sized(GIF, IMAGE_CAP + 1) },
      // A GIF declared image/gif: the type before the mimeType.
      { kind: 'image', bytes: buf(GIF), mimeType: 'image/gif' },
    ]);
    expect(errors(reply)).toEqual([
      "kind must be 'image', 'video' or 'audio'",
      'invalid media-upload request',
      'file exceeds the 24 MB image upload limit',
      'images must be PNG, JPEG or WebP',
    ]);
  });

  // ── Whole-batch refusals ───────────────────────────────────────────────────
  it.each([
    ['items not an array', { purpose: 'generationSource', items: 'x' }, 'invalid media-upload batch request'],
    ['items missing', { purpose: 'generationSource' }, 'invalid media-upload batch request'],
    ['an entry that is null', { purpose: 'generationSource', items: [{ kind: 'image', bytes: buf(PNG) }, null] }, 'invalid media-upload batch request'],
    ['an entry that is a number', { purpose: 'generationSource', items: [3] }, 'invalid media-upload batch request'],
    ['a bad shape AND a bad purpose (purpose first)', { purpose: 'display', items: 'x' }, "purpose must be 'generationSource'"],
    ['a null entry AND a missing purpose (purpose first)', { items: [null] }, "purpose must be 'generationSource'"],
    ['purpose display', { purpose: 'display', items: [{ kind: 'image', bytes: buf(PNG) }] }, "purpose must be 'generationSource'"],
    ['a missing purpose', { items: [{ kind: 'image', bytes: buf(PNG) }] }, "purpose must be 'generationSource'"],
    ['a bad purpose AND no items (purpose first)', { purpose: 'display', items: [] }, "purpose must be 'generationSource'"],
    ['no items', { purpose: 'generationSource', items: [] }, 'a batch holds 1 to 1200 files'],
  ])('refuses %s as a whole', async (_n, payload, error) => {
    await install();
    expect(await raw(payload)).toEqual({ requestId: expect.any(String), error });
  });

  it('holds 1 to 1200 items: 1200 runs, 1201 is refused as a whole', async () => {
    await install();
    const png = buf(PNG);
    const at = await batch(Array.from({ length: 1200 }, () => ({ kind: 'image', bytes: png })));
    expect(at.error).toBeUndefined();
    expect(at.results).toHaveLength(1200);
    expect(at.results?.[1199]).toEqual({ index: 1199, selected: DEFAULT_IMAGE });
    const over = await batch(Array.from({ length: 1201 }, () => ({ kind: 'image', bytes: png })));
    expect(over).toEqual({ requestId: expect.any(String), error: 'a batch holds 1 to 1200 files' });
  });

  it('caps the batch at 10 GiB of raw bytes: exactly 10,737,418,240 runs, one byte more is refused as a whole', async () => {
    await install();
    // One 64 MiB buffer, referenced 160 times = 10,737,418,240 bytes.
    const max = sized(MP4, CAP);
    const at = await batch(Array.from({ length: 160 }, () => ({ kind: 'video', bytes: max })));
    expect(at.error).toBeUndefined();
    expect(at.results).toHaveLength(160);
    const extra = await batch([
      ...Array.from({ length: 160 }, () => ({ kind: 'video', bytes: max })),
      { kind: 'image', bytes: new ArrayBuffer(1) },
    ]);
    expect(extra).toEqual({ requestId: expect.any(String), error: 'the batch exceeds the 10 GB limit' });
  });

  it('admits a batch between 5 and 10 GiB (100 x 64 MiB = 6.25 GiB)', async () => {
    await install();
    const max = sized(MP4, CAP);
    const reply = await batch(Array.from({ length: 100 }, () => ({ kind: 'video', bytes: max })));
    expect(reply.error).toBeUndefined();
    expect(reply.results).toHaveLength(100);
    expect(reply.results?.every((r) => r.selected?.sizeBytes === CAP)).toBe(true);
  });

  it('counts every ArrayBuffer toward the 10 GiB, a per-item-refused one included', async () => {
    await install();
    const max = sized(MP4, CAP);
    // 160 valid videos plus one 2-byte item of an unknown kind: still over.
    const reply = await batch([
      ...Array.from({ length: 160 }, () => ({ kind: 'video', bytes: max })),
      { kind: 'gif', bytes: new ArrayBuffer(2) },
    ]);
    expect(reply.error).toBe('the batch exceeds the 10 GB limit');
  });

  // ── No per-minute window ───────────────────────────────────────────────────
  it('has no per-minute window: 20 items all upload, and the single bytes window is untouched', async () => {
    const hook = await install();
    const out = await settle(
      hook.current.uploadBatch(Array.from({ length: 20 }, () => ({ kind: 'image' as const, bytes: buf(PNG) }))),
    );
    expect(out.value?.results).toHaveLength(20);
    expect(out.value?.results.every((r) => r.selected !== undefined)).toBe(true);
    // The single `upload` window still holds its full 8: the 9th is busy.
    for (let i = 0; i < 8; i++) {
      expect((await settle(hook.current.upload({ kind: 'image', bytes: buf(PNG) }))).error).toBeUndefined();
    }
    expect((await settle(hook.current.upload({ kind: 'image', bytes: buf(PNG) }))).error).toBe('busy');
    // And a full single window does not stop a batch.
    expect(errors(await batch(Array.from({ length: 20 }, () => ({ kind: 'audio', bytes: buf(WAV) }))))).toEqual(
      Array.from({ length: 20 }, () => undefined),
    );
  });

  // ── The viewer's confirm ───────────────────────────────────────────────────
  it('`mediaUploadBatchDeclined` answers a bare reply, and uploadBatch resolves null', async () => {
    const hook = await install({ mediaUploadBatchDeclined: true });
    expect(await batch([{ kind: 'image', bytes: buf(PNG) }])).toEqual({ requestId: expect.any(String) });
    expect(await settle(hook.current.uploadBatch([{ kind: 'image', bytes: buf(PNG) }]))).toEqual({ value: null });
    act(() => host!.setScenario({ mediaUploadBatchDeclined: undefined }));
    expect((await batch([{ kind: 'image', bytes: buf(PNG) }])).results).toHaveLength(1);
  });

  it('asks no confirm when no item is valid: a declining viewer still gets the per-item errors', async () => {
    await install({ mediaUploadBatchDeclined: true });
    const reply = await batch([
      { kind: 'image', bytes: buf(GIF) },
      { kind: 'audio', bytes: new ArrayBuffer(0) },
    ]);
    expect(errors(reply)).toEqual(['images must be PNG, JPEG or WebP', 'invalid media-upload request']);
    expect(reply).not.toHaveProperty('expiresAt');
  });

  it('omits expiresAt when no item is valid (nothing was asked or uploaded), and the hook resolves without it', async () => {
    const hook = await install();
    const reply = await batch([{ kind: 'image', bytes: buf(GIF) }]);
    expect(reply).toEqual({
      requestId: expect.any(String),
      results: [{ index: 0, error: 'images must be PNG, JPEG or WebP' }],
    });
    const out = await settle(hook.current.uploadBatch([{ kind: 'video', bytes: buf(WAV) }]));
    expect(out.value).toEqual({ results: [{ index: 0, error: 'videos must be MP4 or WebM' }] });
    // One valid item is enough for expiresAt to be set.
    const mixed = await batch([{ kind: 'image', bytes: buf(GIF) }, { kind: 'image', bytes: buf(PNG) }]);
    expect(typeof mixed.expiresAt).toBe('string');
  });

  it('a whole-batch refusal comes before the confirm', async () => {
    await install({ mediaUploadBatchDeclined: true });
    expect((await batch([])).error).toBe('a batch holds 1 to 1200 files');
  });

  // ── Forced whole-batch error ───────────────────────────────────────────────
  it.each(['busy', 'no block token', 'you have reached your daily upload limit'])(
    '`mediaUploadBatchError: %j` refuses the whole batch, and uploadBatch rejects with it',
    async (error) => {
      const hook = await install({ mediaUploadBatchError: error });
      expect(await batch([{ kind: 'image', bytes: buf(PNG) }])).toEqual({ requestId: expect.any(String), error });
      // Before any item is looked at: an all-invalid batch is refused too.
      expect((await batch([{ kind: 'image', bytes: buf(GIF) }])).error).toBe(error);
      expect(await settle(hook.current.uploadBatch([{ kind: 'image', bytes: buf(PNG) }]))).toEqual({ error });
    },
  );

  it('the forced error comes after the request checks, and setScenario clears it', async () => {
    await install({ mediaUploadBatchError: 'busy' });
    expect((await batch([], {})).error).toBe('a batch holds 1 to 1200 files');
    expect((await batch([{ kind: 'image', bytes: buf(PNG) }], { purpose: 'display' })).error).toBe(
      "purpose must be 'generationSource'",
    );
    act(() => host!.setScenario({ mediaUploadBatchError: undefined }));
    expect((await batch([{ kind: 'image', bytes: buf(PNG) }])).results).toHaveLength(1);
  });

  it('a forced error beats a decline (the host refuses before asking)', async () => {
    await install({ mediaUploadBatchError: 'busy', mediaUploadBatchDeclined: true });
    expect((await batch([{ kind: 'image', bytes: buf(PNG) }])).error).toBe('busy');
  });

  // ── Surface ────────────────────────────────────────────────────────────────
  it('answers `unsupported on this host` on a model-slot context', async () => {
    const hook = await install({ context: MODEL_SLOT });
    expect(await settle(hook.current.uploadBatch([{ kind: 'image', bytes: buf(PNG) }]))).toEqual({
      error: 'unsupported on this host',
    });
    expect(await batch([{ kind: 'image', bytes: buf(PNG) }])).toEqual({
      requestId: expect.any(String),
      error: 'unsupported on this host',
    });
  });
});
