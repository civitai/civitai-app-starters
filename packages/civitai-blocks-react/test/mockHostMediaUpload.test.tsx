import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockMediaUploadInfo, ModelSlotContext } from '@civitai/app-sdk/blocks';

import { useMediaUpload } from '../src/hooks/useMediaUpload.js';
import { useUploadImageBytes } from '../src/hooks/useUploadImageBytes.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import type { MockHost, MockHostOptions } from '../src/testing.js';

/**
 * `createMockHost`'s `OPEN_MEDIA_UPLOAD` handler, driven through the REAL hook,
 * transport and validator, plus the raw bridge for requests the hook refuses
 * to send.
 *
 * 🔴 WHAT THIS CANNOT PROVE: that the PRODUCTION host admits the same buffers.
 * The mock's rules are a hand port of the bridge contract; a later host change
 * is invisible here. Nor does the mock decode media, so the host's decode-time
 * refusals are not modelled.
 */

const ORIGIN = window.location.origin;

// The contract's cap, spelled as a literal so a changed constant cannot move the test with it.
const CAP = 67_108_864;

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const WEBP = new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')]);
const GIF = new Uint8Array([...ascii('GIF89a'), 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypisom'), 0, 0, 2, 0]);
// An EBML header whose DocType is `webm` (what MediaRecorder writes).
const WEBM = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
  0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, ...ascii('webm'), 0x42, 0x87, 0x81, 0x04,
]);
// The same header with DocType `matroska`: generic Matroska, refused.
const MKV = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
  0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x88, ...ascii('matroska'), 0x42, 0x87, 0x81, 0x04,
]);
const MP3_ID3 = new Uint8Array([...ascii('ID3'), 0x03, 0x00, 0x00, 0, 0, 0, 0x0a]);
// MPEG-1 Layer III frame sync, no tag.
const MP3_FRAME = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
// A frame sync whose version bits are the reserved value 01: not MP3.
const MP3_RESERVED_VERSION = new Uint8Array([0xff, 0xea, 0x90, 0x64, 0, 0, 0, 0]);
const WAV = new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')]);

function buf(view: Uint8Array): ArrayBuffer {
  return view.slice().buffer as ArrayBuffer;
}

type Reply = { requestId?: string; selected?: BlockMediaUploadInfo; error?: string };

const MODEL_SLOT: ModelSlotContext = {
  slotId: 'model.sidebar_top',
  modelId: 11,
  modelVersionId: 22,
  modelName: 'Fixture model',
  modelType: 'Checkpoint',
  modelNsfwLevel: 1,
};

describe('createMockHost — OPEN_MEDIA_UPLOAD', () => {
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
      { type: 'OPEN_MEDIA_UPLOAD', payload } as never,
      'MEDIA_UPLOAD_RESULT',
    )) as Reply;
  }
  const bytesReq = (kind: string, view: Uint8Array | ArrayBuffer, extra: Record<string, unknown> = {}) =>
    raw({
      kind,
      purpose: 'generationSource',
      bytes: view instanceof ArrayBuffer ? view : buf(view),
      ...extra,
    });

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

  // ── Per-kind acceptance, through the real hook ─────────────────────────────
  it.each([
    ['PNG', PNG],
    ['JPEG', JPEG],
    ['WebP', WEBP],
  ])('accepts a %s image and reports it re-encoded as JPEG', async (_n, view) => {
    const hook = await install();
    const out = await settle(hook.current.upload({ kind: 'image', bytes: buf(view) }));
    expect(out).toEqual({
      value: {
        url: 'https://media.mock.invalid/generation-input/dev-image.jpeg',
        kind: 'image',
        mimeType: 'image/jpeg',
        sizeBytes: 182_311,
        width: 1024,
        height: 768,
      },
    });
  });

  it.each([
    ['MP4', MP4, 'video/mp4'],
    ['WebM', WEBM, 'video/webm'],
  ])('accepts a %s video with the sniffed type and the buffer size', async (_n, view, mimeType) => {
    const hook = await install();
    const out = await settle(hook.current.upload({ kind: 'video', bytes: buf(view) }));
    expect(out.value).toEqual({
      url: 'https://media.mock.invalid/generation-input/dev-video.mp4',
      kind: 'video',
      mimeType,
      sizeBytes: view.length,
      width: 1280,
      height: 720,
      durationMs: 5_000,
    });
  });

  it.each([
    ['MP3 (ID3 tag)', MP3_ID3, 'audio/mpeg'],
    ['MP3 (frame sync)', MP3_FRAME, 'audio/mpeg'],
    ['WAV', WAV, 'audio/wav'],
    ['WebM', WEBM, 'audio/webm'],
  ])('accepts %s audio with the sniffed type, and no dimensions', async (_n, view, mimeType) => {
    const hook = await install();
    const out = await settle(hook.current.upload({ kind: 'audio', bytes: buf(view) }));
    expect(out.value).toEqual({
      url: 'https://media.mock.invalid/generation-input/dev-audio.mp3',
      kind: 'audio',
      mimeType,
      sizeBytes: view.length,
      durationMs: 30_000,
    });
  });

  // ── Per-kind type refusals, exact literals ─────────────────────────────────
  it.each([
    ['a PNG as audio', 'audio', PNG, 'audio must be MP3, WAV or WebM'],
    ['a WebP (RIFF, not WAVE) as audio', 'audio', WEBP, 'audio must be MP3, WAV or WebM'],
    ['a reserved-version frame sync as audio', 'audio', MP3_RESERVED_VERSION, 'audio must be MP3, WAV or WebM'],
    ['generic Matroska as audio', 'audio', MKV, 'audio must be MP3, WAV or WebM'],
    ['an MP4 as audio', 'audio', MP4, 'audio must be MP3, WAV or WebM'],
    ['a GIF as an image', 'image', GIF, 'images must be PNG, JPEG or WebP'],
    ['an MP4 as an image', 'image', MP4, 'images must be PNG, JPEG or WebP'],
    ['a WAV as an image', 'image', WAV, 'images must be PNG, JPEG or WebP'],
    ['generic Matroska as video', 'video', MKV, 'videos must be MP4 or WebM'],
    ['a WAV as video', 'video', WAV, 'videos must be MP4 or WebM'],
    ['an MP3 as video', 'video', MP3_ID3, 'videos must be MP4 or WebM'],
    ['a JPEG as video', 'video', JPEG, 'videos must be MP4 or WebM'],
  ])('refuses %s', async (_n, kind, view, error) => {
    const hook = await install();
    const out = await settle(hook.current.upload({ kind: kind as never, bytes: buf(view) }));
    expect(out).toEqual({ error });
  });

  it('refuses an `ftyp` box in a buffer shorter than 12 bytes', async () => {
    await install();
    expect(await bytesReq('video', MP4.slice(0, 11))).toEqual({
      requestId: expect.any(String),
      error: 'videos must be MP4 or WebM',
    });
  });

  it('looks for the `webm` DocType only in the first 64 bytes', async () => {
    await install();
    const late = new Uint8Array(80);
    late.set([0x1a, 0x45, 0xdf, 0xa3]);
    late.set(ascii('webm'), 60); // bytes 60..63: inside u8[0..64)
    expect((await bytesReq('video', late)).selected?.mimeType).toBe('video/webm');
    const later = new Uint8Array(80);
    later.set([0x1a, 0x45, 0xdf, 0xa3]);
    later.set(ascii('webm'), 61); // bytes 61..64: crosses the boundary
    expect((await bytesReq('video', later)).error).toBe('videos must be MP4 or WebM');
  });

  // ── Declared mimeType ──────────────────────────────────────────────────────
  it.each([
    ['image/png for a PNG', 'image', PNG, 'image/png'],
    ['IMAGE/WEBP for a WebP (case is ignored)', 'image', WEBP, 'IMAGE/WEBP'],
    ['video/webm;codecs=vp9 for a WebM (params are cut)', 'video', WEBM, 'video/webm;codecs=vp9'],
    ['audio/webm; codecs=opus for a WebM recording', 'audio', WEBM, 'audio/webm; codecs=opus'],
    ['audio/x-wav for a WAV (alias)', 'audio', WAV, 'audio/x-wav'],
  ])('accepts a matching mimeType: %s', async (_n, kind, view, mimeType) => {
    await install();
    const reply = await bytesReq(kind, view, { mimeType });
    expect(reply.error).toBeUndefined();
    expect(reply.selected?.kind).toBe(kind);
  });

  it.each([
    ['image/jpeg for a PNG', 'image', PNG, 'image/jpeg'],
    ['video/webm for an MP4', 'video', MP4, 'video/webm'],
    ['video/webm for a WebM sent as audio', 'audio', WEBM, 'video/webm'],
    ['audio/mp3 for an MP3 (only audio/mpeg names it)', 'audio', MP3_ID3, 'audio/mp3'],
  ])('refuses a mismatching mimeType: %s', async (_n, kind, view, mimeType) => {
    await install();
    expect(await bytesReq(kind, view, { mimeType })).toEqual({
      requestId: expect.any(String),
      error: "mimeType does not match the file's content",
    });
  });

  it('checks the type before the mimeType: a GIF declared image/gif is a type refusal', async () => {
    await install();
    expect((await bytesReq('image', GIF, { mimeType: 'image/gif' })).error).toBe(
      'images must be PNG, JPEG or WebP',
    );
  });

  // ── kind / purpose / bytes ─────────────────────────────────────────────────
  it.each([
    ['an unknown kind', { kind: 'gif', purpose: 'generationSource', bytes: buf(PNG) }, "kind must be 'image', 'video' or 'audio'"],
    ['a missing kind (picker mode)', { purpose: 'generationSource' }, "kind must be 'image', 'video' or 'audio'"],
    ['a bad kind AND a bad purpose (kind first)', { kind: 'Image', purpose: 'display' }, "kind must be 'image', 'video' or 'audio'"],
    ['a missing purpose (picker mode)', { kind: 'image' }, "purpose must be 'generationSource'"],
    ['purpose display', { kind: 'video', purpose: 'display', bytes: buf(MP4) }, "purpose must be 'generationSource'"],
    ['a Uint8Array', { kind: 'image', purpose: 'generationSource', bytes: PNG.slice() }, 'invalid media-upload request'],
    ['an empty buffer', { kind: 'image', purpose: 'generationSource', bytes: new ArrayBuffer(0) }, 'invalid media-upload request'],
    ['a string', { kind: 'image', purpose: 'generationSource', bytes: 'iVBORw0KGgo=' }, 'invalid media-upload request'],
    ['a non-string mimeType', { kind: 'image', purpose: 'generationSource', bytes: buf(PNG), mimeType: 7 }, 'invalid media-upload request'],
  ])('refuses %s', async (_n, payload, error) => {
    await install();
    expect(await raw(payload)).toEqual({ requestId: expect.any(String), error });
  });

  // ── The cap ────────────────────────────────────────────────────────────────
  it('refuses an over-cap buffer with the 64 MB message, and accepts one of exactly the cap', async () => {
    await install();
    const over = new Uint8Array(CAP + 1);
    over.set(MP4);
    expect(await bytesReq('video', over.buffer)).toEqual({
      requestId: expect.any(String),
      error: 'file exceeds the 64 MB upload limit',
    });
    const max = new Uint8Array(CAP);
    max.set(MP4);
    const ok = await bytesReq('video', max.buffer);
    expect(ok.error).toBeUndefined();
    expect(ok.selected?.sizeBytes).toBe(CAP);
  });

  // ── The bytes-mode window ──────────────────────────────────────────────────
  it('refuses `busy` on the 9th upload in 60 s, and an over-cap file is still too large, never busy', async () => {
    await install();
    for (let i = 0; i < 8; i++) expect((await bytesReq('audio', WAV)).error).toBeUndefined();
    expect((await bytesReq('audio', WAV)).error).toBe('busy');
    // A full window still reports an over-cap file as too large: a retry could never succeed.
    expect((await bytesReq('audio', new ArrayBuffer(CAP + 1))).error).toBe(
      'file exceeds the 64 MB upload limit',
    );
    // And `busy` before the type: a GIF in a full window is `busy`, as on the host.
    expect((await bytesReq('image', GIF)).error).toBe('busy');
  });

  it('does not count a refused upload against the window', async () => {
    await install();
    for (let i = 0; i < 8; i++) expect((await bytesReq('image', GIF)).error).toBe('images must be PNG, JPEG or WebP');
    for (let i = 0; i < 8; i++) expect((await bytesReq('image', PNG)).error).toBeUndefined();
    expect((await bytesReq('image', PNG)).error).toBe('busy');
  });

  it('refuses `busy` once the window holds 128 MB, before the count of 8', async () => {
    await install();
    const max = new Uint8Array(CAP);
    max.set(MP4);
    expect((await bytesReq('video', max.slice().buffer)).error).toBeUndefined();
    expect((await bytesReq('video', max.slice().buffer)).error).toBeUndefined();
    expect((await bytesReq('video', MP4)).error).toBe('busy');
  });

  it('frees the window after 60 s', async () => {
    await install();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    for (let i = 0; i < 8; i++) await bytesReq('audio', MP3_ID3);
    vi.setSystemTime(1_000_000 + 59_999);
    expect((await bytesReq('audio', MP3_ID3)).error).toBe('busy');
    vi.setSystemTime(1_000_000 + 60_000);
    expect((await bytesReq('audio', MP3_ID3)).error).toBeUndefined();
  });

  it('does not window picker mode: a full window still opens the picker', async () => {
    const hook = await install();
    for (let i = 0; i < 8; i++) await bytesReq('audio', WAV);
    expect((await bytesReq('audio', WAV)).error).toBe('busy');
    expect((await settle(hook.current.open({ kind: 'audio' }))).value?.kind).toBe('audio');
  });

  it('keeps its own window: OPEN_IMAGE_UPLOAD bytes still upload after 8 media uploads', async () => {
    await install();
    for (let i = 0; i < 8; i++) await bytesReq('image', PNG);
    const { result } = renderHook(() => useUploadImageBytes());
    const out = await settle(result.current.upload(buf(PNG)));
    expect(out.error).toBeUndefined();
    expect(out.value).toMatchObject({ imageId: expect.any(Number) });
  });

  // ── Picker mode ────────────────────────────────────────────────────────────
  it('answers each kind with its default when nothing is configured', async () => {
    const hook = await install();
    const urls = [];
    for (const kind of ['image', 'video', 'audio'] as const) {
      const out = await settle(hook.current.open({ kind }));
      expect(out.value?.kind).toBe(kind);
      urls.push(out.value?.url);
    }
    expect(urls).toEqual([
      'https://media.mock.invalid/generation-input/dev-image.jpeg',
      'https://media.mock.invalid/generation-input/dev-video.mp4',
      'https://media.mock.invalid/generation-input/dev-audio.mp3',
    ]);
  });

  it('answers a configured kind with its canned upload, and dismisses a kind set to null', async () => {
    const clip: BlockMediaUploadInfo = {
      url: 'https://media.example/generation-input/clip.webm',
      kind: 'video',
      mimeType: 'video/webm',
      sizeBytes: 1234,
      width: 640,
      height: 360,
    };
    const hook = await install({ cannedMediaUploads: { video: clip, audio: null } });
    expect((await settle(hook.current.open({ kind: 'video' }))).value).toEqual(clip);
    expect(await settle(hook.current.open({ kind: 'audio' }))).toEqual({ value: null });
    // A kind left out still answers its default.
    expect((await settle(hook.current.open({ kind: 'image' }))).value?.mimeType).toBe('image/jpeg');
    // Bytes mode has no picker to dismiss: a null kind answers the default.
    expect((await settle(hook.current.upload({ kind: 'audio', bytes: buf(WAV) }))).value?.mimeType).toBe(
      'audio/wav',
    );
  });

  it('setScenario changes the canned uploads, and `undefined` restores the defaults', async () => {
    const hook = await install();
    act(() => host!.setScenario({ cannedMediaUploads: { image: null } }));
    expect(await settle(hook.current.open({ kind: 'image' }))).toEqual({ value: null });
    act(() => host!.setScenario({ cannedMediaUploads: undefined }));
    expect((await settle(hook.current.open({ kind: 'image' }))).value?.kind).toBe('image');
  });

  it('`mediaUploadError` forces a refusal in both modes; a forced bytes failure still counts', async () => {
    const hook = await install({ mediaUploadError: 'this file has no video track' });
    expect(await settle(hook.current.open({ kind: 'video' }))).toEqual({ error: 'this file has no video track' });
    for (let i = 0; i < 8; i++) {
      expect((await bytesReq('video', MP4)).error).toBe('this file has no video track');
    }
    // The 8 failed uploads were admitted, so the window is full.
    expect((await bytesReq('video', MP4)).error).toBe('busy');
    act(() => host!.setScenario({ mediaUploadError: undefined }));
    expect((await settle(hook.current.open({ kind: 'video' }))).value?.kind).toBe('video');
  });

  it('answers `unsupported on this host` on a model-slot context', async () => {
    const hook = await install({ context: MODEL_SLOT });
    expect(await settle(hook.current.open({ kind: 'image' }))).toEqual({ error: 'unsupported on this host' });
    expect(await settle(hook.current.upload({ kind: 'image', bytes: buf(PNG) }))).toEqual({
      error: 'unsupported on this host',
    });
  });
});
