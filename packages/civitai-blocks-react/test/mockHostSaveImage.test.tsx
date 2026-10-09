import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SAVE_BYTES_MAX_BYTES } from '@civitai/app-sdk/blocks';

import { useSaveImage, type SaveImageInput } from '../src/hooks/useSaveImage.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import type { MockHostOptions } from '../src/testing.js';

/**
 * `createMockHost`'s SAVE_IMAGE handler, driven through the REAL hook and
 * transport, for the `bytes` variant's content classification
 * (civitai/civitai-app-starters#583).
 *
 * 🔴 WHAT THIS CANNOT PROVE: that the PRODUCTION host classifies the same way.
 * The mock's classifier is a copy of the contract, not of the host's code. It
 * also does not model the page-only refusal or the host's concurrency cap.
 */

const ORIGIN = window.location.origin;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
// "RIFF" <size> "WEBP" "VP8 "
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
// A real 1×1 GIF89a — the header is ASCII, the body is binary (and holds NULs).
const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);
// Random binary with NO NUL byte — so only the UTF-8 check can refuse it.
const BINARY_NO_NUL = new Uint8Array([0xc3, 0x28, 0xa0, 0xa1, 0xe2, 0x28, 0xa1, 0xf0, 0x90, 0x28, 0xbc, 0xfe, 0xff]);
// Valid UTF-8 text except for one NUL — so only the NUL check can refuse it.
const TEXT_WITH_NUL = new TextEncoder().encode('hello\u0000world');

function buf(view: Uint8Array): ArrayBuffer {
  return view.slice().buffer as ArrayBuffer;
}
const text = (s: string) => buf(new TextEncoder().encode(s));

type Saved = Parameters<NonNullable<MockHostOptions['onSaveBytes']>>[0];

describe('createMockHost — SAVE_IMAGE bytes variant', () => {
  let uninstall: (() => void) | undefined;
  let saved: Saved[];

  beforeEach(() => {
    saved = [];
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  async function save(input: SaveImageInput, options: MockHostOptions = {}): Promise<Error | null> {
    uninstall = createMockHost({ onSaveBytes: (f) => saved.push(f), ...options }).install();
    const { result } = renderHook(() => useSaveImage());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let caught: Error | null = null;
    await act(async () => {
      await result.current.saveImage(input).catch((e: Error) => (caught = e));
    });
    return caught;
  }

  it.each([
    ['PNG', PNG, 'image/png', 'healed.png'],
    ['JPEG', JPEG, 'image/jpeg', 'healed.jpg'],
    ['WebP', WEBP, 'image/webp', 'healed.webp'],
  ])('saves %s bytes, classified by magic and with the extension forced', async (_n, view, mime, name) => {
    // The filename LIES (.txt) and the mimeType lies — content wins.
    const err = await save({ bytes: buf(view), filename: 'healed.txt', mimeType: 'text/plain' });
    expect(err).toBeNull();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.mimeType).toBe(mime);
    expect(saved[0]!.filename).toBe(name);
  });

  it('saves JSON bytes as JSON when mimeType hints json', async () => {
    const err = await save({ bytes: text('{"healed":true}'), filename: 'sidecar', mimeType: 'application/json' });
    expect(err).toBeNull();
    expect(saved[0]!.mimeType).toBe('application/json');
    expect(saved[0]!.filename).toBe('sidecar.json');
  });

  it('saves JSON bytes as JSON when the FILENAME hints json (no mimeType)', async () => {
    await save({ bytes: text('[1,2,3]'), filename: 'data.json' });
    expect(saved[0]!.mimeType).toBe('application/json');
  });

  it('saves valid JSON WITHOUT a json hint as text/plain — the hint is required', async () => {
    await save({ bytes: text('{"healed":true}'), filename: 'sidecar.dat' });
    expect(saved[0]!.mimeType).toBe('text/plain');
    expect(saved[0]!.filename).toBe('sidecar.txt');
  });

  it('saves a json-hinted payload that does NOT parse as text/plain, not a refusal', async () => {
    const err = await save({ bytes: text('{not json'), mimeType: 'application/json' });
    expect(err).toBeNull();
    expect(saved[0]!.mimeType).toBe('text/plain');
    expect(saved[0]!.filename).toBe('download.txt');
  });

  it('saves plain UTF-8 text (multi-byte included) as text/plain', async () => {
    const err = await save({ bytes: text('café — \u{1F600}'), filename: 'notes.md' });
    expect(err).toBeNull();
    expect(saved[0]!.mimeType).toBe('text/plain');
    expect(saved[0]!.filename).toBe('notes.txt');
  });

  it('delivers a COPY of the bytes, with identical content', async () => {
    const src = buf(PNG);
    await save({ bytes: src });
    expect(saved[0]!.bytes).not.toBe(src);
    expect(new Uint8Array(saved[0]!.bytes)).toEqual(new Uint8Array(src));
  });

  it('refuses a GIF — a real image type the contract does not allow', async () => {
    const err = await save({ bytes: buf(GIF), filename: 'anim.gif', mimeType: 'image/gif' });
    expect(err?.message).toBe('file type is not allowed');
    expect(saved).toHaveLength(0);
  });

  it('refuses random binary that has no NUL byte (the UTF-8 check)', async () => {
    const err = await save({ bytes: buf(BINARY_NO_NUL), mimeType: 'text/plain' });
    expect(err?.message).toBe('file type is not allowed');
    expect(saved).toHaveLength(0);
  });

  it('refuses otherwise-valid UTF-8 text containing a NUL (the NUL check)', async () => {
    const err = await save({ bytes: buf(TEXT_WITH_NUL), filename: 'x.txt' });
    expect(err?.message).toBe('file type is not allowed');
    expect(saved).toHaveLength(0);
  });

  it('refuses a payload the hook would have refused, if one reaches it (over-cap)', async () => {
    // Bypass the hook's pre-send check by posting through the transport
    // directly, as a block on an older SDK or plain JS could.
    uninstall = createMockHost({}).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const reply = (await getTransport().sendRequest(
      { type: 'SAVE_IMAGE', payload: { bytes: new ArrayBuffer(SAVE_BYTES_MAX_BYTES + 1) } },
      'SAVE_IMAGE_RESULT',
    )) as { ok?: boolean; error?: string };
    expect(reply).toMatchObject({ ok: false, error: 'file exceeds the maximum save size' });
  });

  it('refuses a non-ArrayBuffer `bytes` that reaches it', async () => {
    uninstall = createMockHost({}).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const reply = (await getTransport().sendRequest(
      { type: 'SAVE_IMAGE', payload: { bytes: new Uint8Array([1]) as unknown as ArrayBuffer } },
      'SAVE_IMAGE_RESULT',
    )) as { ok?: boolean; error?: string };
    expect(reply).toMatchObject({ ok: false, error: 'invalid save-image request' });
  });

  it('refuses bytes + url that reach it (exactly one variant)', async () => {
    uninstall = createMockHost({}).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const reply = (await getTransport().sendRequest(
      { type: 'SAVE_IMAGE', payload: { bytes: buf(PNG), url: 'https://image.civitai.com/x.png' } },
      'SAVE_IMAGE_RESULT',
    )) as { ok?: boolean; error?: string };
    expect(reply).toMatchObject({ ok: false, error: 'invalid save-image request' });
  });

  it('`saveImageError` forces a refusal — e.g. a host that predates the bytes variant', async () => {
    const err = await save({ bytes: buf(PNG) }, { saveImageError: 'invalid save-image request' });
    expect(err?.message).toBe('invalid save-image request');
    expect(saved).toHaveLength(0);
  });

  it('`saveImageError` is live-tunable and clears with undefined', async () => {
    const host = createMockHost({ saveImageError: 'busy', onSaveBytes: (f) => saved.push(f) });
    uninstall = host.install();
    const { result } = renderHook(() => useSaveImage());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let caught: Error | null = null;
    await act(async () => {
      await result.current.saveImage({ imageId: 1 }).catch((e: Error) => (caught = e));
    });
    expect((caught as Error | null)?.message).toBe('busy');
    host.setScenario({ saveImageError: undefined });
    caught = null;
    await act(async () => {
      await result.current.saveImage({ bytes: buf(PNG) }).catch((e: Error) => (caught = e));
    });
    expect(caught).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it('still saves the url and imageId variants', async () => {
    expect(await save({ url: 'https://image.civitai.com/x/original.jpeg' })).toBeNull();
    cleanup();
    uninstall?.();
    resetTransport();
    getTransport({ allowedParentOrigins: [ORIGIN] });
    expect(await save({ imageId: 55 })).toBeNull();
    expect(saved).toHaveLength(0); // onSaveBytes is bytes-only
  });
});
