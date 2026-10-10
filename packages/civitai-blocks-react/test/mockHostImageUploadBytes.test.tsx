import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreatePostFromApp } from '../src/hooks/useCreatePostFromApp.js';
import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { useUploadImageBytes } from '../src/hooks/useUploadImageBytes.js';
import { UPLOAD_BYTES_MAX_BYTES } from '../src/internal/uploadBytes.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import type { MockHostOptions } from '../src/testing.js';

/**
 * `createMockHost`'s `OPEN_IMAGE_UPLOAD { bytes }` handler, driven through the
 * REAL hooks and transport (civitai/civitai#5639).
 *
 * 🔴 WHAT THIS CANNOT PROVE: that the PRODUCTION host admits the same buffers.
 * The mock's rules are a hand port of the host's `imageUploadBytes.ts` at
 * #5639; a later host change is invisible here. Nor does the mock model the
 * page-only rule, the scope check, the real scan or an older host's picker.
 */

const ORIGIN = window.location.origin;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
// A real 1x1 GIF89a. The save bridge refuses it too; uploads take images only.
const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);
// Valid UTF-8 JSON: SAVE_IMAGE would accept it as text; an upload must not.
const JSON_TEXT = new TextEncoder().encode('{"healed":true}');

function buf(view: Uint8Array): ArrayBuffer {
  return view.slice().buffer as ArrayBuffer;
}

const BYTES_IMAGE = {
  imageId: 12345701,
  nsfwLevel: 1,
  contentRating: 'pg',
  url: 'https://image.civitai.com/mock/original=true/dev-bytes-upload.png',
} as const;

type CreatePostSources = Parameters<ReturnType<typeof useCreatePostFromApp>['createPost']>[0]['sources'];
type Uploaded = Parameters<NonNullable<MockHostOptions['onUploadImageBytes']>>[0];
type Reply = { requestId?: string; selected?: Record<string, unknown>; error?: string };

describe('createMockHost — OPEN_IMAGE_UPLOAD bytes variant', () => {
  let uninstall: (() => void) | undefined;
  let uploaded: Uploaded[];
  let outbound: Array<{ type: string; payload?: unknown }> = [];

  beforeEach(() => {
    uploaded = [];
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function install(options: MockHostOptions = {}) {
    outbound = [];
    uninstall = createMockHost({
      onUploadImageBytes: (f) => uploaded.push(f),
      onOutbound: (m) => outbound.push(m),
      ...options,
    }).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  /** `useCreatePostFromApp().createPost(sources)` through the real hook. */
  async function createPost(sources: CreatePostSources) {
    const { result } = renderHook(() => useCreatePostFromApp());
    let post: unknown;
    let caught: Error | null = null;
    await act(async () => {
      await result.current
        .createPost({ sources })
        .then((v) => (post = v))
        .catch((e: Error) => (caught = e));
    });
    return { post, caught: caught as Error | null };
  }

  /** The raw bridge, past the hook's own cap pre-check. */
  async function raw(payload: Record<string, unknown>): Promise<Reply> {
    return (await getTransport().sendRequest(
      { type: 'OPEN_IMAGE_UPLOAD', payload } as never,
      'IMAGE_UPLOAD_RESULT',
    )) as Reply;
  }

  async function upload(bytes: ArrayBuffer, filename?: string) {
    const { result } = renderHook(() => useUploadImageBytes());
    let value: unknown;
    let caught: Error | null = null;
    await act(async () => {
      await result.current
        .upload(bytes, filename === undefined ? undefined : { filename })
        .then((v) => (value = v))
        .catch((e: Error) => (caught = e));
    });
    return { value, caught: caught as Error | null };
  }

  it('accepts a PNG, and the returned imageId posts as a `published` source', async () => {
    await install();
    const { value, caught } = await upload(buf(PNG), 'healed.png');
    expect(caught).toBeNull();
    expect(value).toEqual({
      imageId: 12345701,
      nsfwLevel: 1,
      contentRating: 'pg',
      url: 'https://image.civitai.com/mock/original=true/dev-bytes-upload.png',
    });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.mimeType).toBe('image/png');
    expect(uploaded[0]!.filename).toBe('healed.png');

    // Then post it through the EXISTING hook, as a block would, on the SAME mock.
    const { post } = await createPost([
      { kind: 'published', imageIds: [(value as { imageId: number }).imageId] },
    ]);
    expect(post).toEqual({ postId: 4242, url: 'https://civitai.com/posts/4242', imageIds: [9101, 9102] });
    const sent = outbound.filter((m) => m.type === 'CREATE_POST_FROM_APP');
    expect(sent).toHaveLength(1);
    expect((sent[0]!.payload as { sources: unknown }).sources).toEqual([
      { kind: 'published', imageIds: [12345701] },
    ]);
  });

  // ── CREATE_POST_FROM_APP `published` sources: only ids THIS mock issued ──
  // Mirrors the host's `resolveAppPublishedImages` (civitai/civitai#5639): the
  // app's provenance stamp + `postId IS NULL`, one uniform refusal string.

  it('an uploaded id posts ONCE, then is refused as already posted', async () => {
    await install({ uploadImageBytesResult: { ...BYTES_IMAGE, imageId: 5551 } });
    expect((await upload(buf(PNG))).value).toMatchObject({ imageId: 5551 });
    expect((await createPost([{ kind: 'published', imageIds: [5551] }])).caught).toBeNull();
    const again = await createPost([{ kind: 'published', imageIds: [5551] }]);
    expect(again.post).toBeUndefined();
    expect(again.caught?.message).toBe('an image is not available to post');
  });

  it('a picked `useImageUpload()` id is refused: production leaves it unstamped', async () => {
    await install();
    const { result } = renderHook(() => useImageUpload());
    let picked: { imageId: number } | null = null;
    await act(async () => {
      picked = (await result.current.open()) as { imageId: number } | null;
    });
    expect(picked).toMatchObject({ imageId: 12345678 });
    const { post, caught } = await createPost([
      { kind: 'published', imageIds: [(picked as unknown as { imageId: number }).imageId] },
    ]);
    expect(post).toBeUndefined();
    expect(caught?.message).toBe('an image is not available to post');
  });

  it('an unknown id is refused, and a mixed set adopts nothing', async () => {
    await install({ uploadImageBytesResult: { ...BYTES_IMAGE, imageId: 5552 } });
    expect((await createPost([{ kind: 'published', imageIds: [424242] }])).caught?.message).toBe(
      'an image is not available to post',
    );
    await upload(buf(PNG));
    // Refused, not skipped: the valid 5552 is NOT consumed by the refused post…
    expect(
      (await createPost([{ kind: 'published', imageIds: [5552, 424242] }])).caught?.message,
    ).toBe('an image is not available to post');
    // …nor by a post whose LATER source is refused after an earlier one resolved.
    expect(
      (
        await createPost([
          { kind: 'published', imageIds: [5552] },
          { kind: 'published', imageIds: [424242] },
        ])
      ).caught?.message,
    ).toBe('an image is not available to post');
    // …so it still posts on its own.
    expect((await createPost([{ kind: 'published', imageIds: [5552] }])).caught).toBeNull();
  });

  it('a `postableImageIds` seed (an earlier session’s stamped, unposted image) posts ONCE', async () => {
    // 8801/8802 are distinct from every id the mock issues by default, so only
    // the seed can make them postable.
    await install({ postableImageIds: [8801, 8802] });
    expect((await createPost([{ kind: 'published', imageIds: [8801] }])).caught).toBeNull();
    expect((await createPost([{ kind: 'published', imageIds: [8801] }])).caught?.message).toBe(
      'an image is not available to post',
    );
    expect((await createPost([{ kind: 'published', imageIds: [8802] }])).caught).toBeNull();
  });

  it('with a seed, an unseeded id the mock never issued is still refused', async () => {
    await install({ postableImageIds: [8801] });
    expect((await createPost([{ kind: 'published', imageIds: [8803] }])).caught?.message).toBe(
      'an image is not available to post',
    );
    // A refused mixed post does not consume the seeded id.
    expect((await createPost([{ kind: 'published', imageIds: [8801, 8803] }])).caught?.message).toBe(
      'an image is not available to post',
    );
    expect((await createPost([{ kind: 'published', imageIds: [8801] }])).caught).toBeNull();
  });

  it('a source with no positive integer id is refused with the server string', async () => {
    await install();
    expect((await createPost([{ kind: 'published', imageIds: [0, -1, 1.5] }])).caught?.message).toBe(
      'no valid image ids in a published source',
    );
  });

  it('ids from the mock PUBLISH_GENERATION_OUTPUTS reply are postable once', async () => {
    await install({ publishImageIds: [7101, 7102] });
    expect((await createPost([{ kind: 'published', imageIds: [7101] }])).caught?.message).toBe(
      'an image is not available to post',
    );
    const reply = (await getTransport().sendRequest(
      { type: 'PUBLISH_GENERATION_OUTPUTS', payload: { workflowId: 'wf_1', imageIndexes: [0, 1] } } as never,
      'PUBLISH_RESULT',
    )) as { result?: { imageIds: number[] } };
    expect(reply.result?.imageIds).toEqual([7101, 7102]);
    expect((await createPost([{ kind: 'published', imageIds: [7101, 7102] }])).caught).toBeNull();
    expect((await createPost([{ kind: 'published', imageIds: [7102] }])).caught?.message).toBe(
      'an image is not available to post',
    );
  });

  it('a `workflow` source is not checked against the issued ids', async () => {
    await install();
    expect(
      (await createPost([{ kind: 'workflow', workflowId: 'wf_1', imageIndexes: [0] }])).caught,
    ).toBeNull();
  });

  it.each([
    ['JPEG', JPEG, 'image/jpeg', 'healed.jpg'],
    ['WebP', WEBP, 'image/webp', 'healed.webp'],
  ])('accepts %s and forces the sniffed extension', async (_n, view, mime, name) => {
    await install();
    const { caught } = await upload(buf(view), 'healed.txt');
    expect(caught).toBeNull();
    expect(uploaded.map((u) => [u.mimeType, u.filename])).toEqual([[mime, name]]);
  });

  it('caps the stored name at 255 characters, keeping the extension', async () => {
    await install();
    await upload(buf(PNG), `${'a'.repeat(300)}.png`);
    expect(uploaded[0]!.filename).toBe(`${'a'.repeat(251)}.png`);
  });

  it.each([
    ['GIF', GIF],
    ['UTF-8 JSON', JSON_TEXT],
  ])('refuses %s with `file type is not allowed`', async (_n, view) => {
    await install();
    const { value, caught } = await upload(buf(view), 'x.png');
    expect(value).toBeUndefined();
    expect(caught?.message).toBe('file type is not allowed');
    expect(uploaded).toHaveLength(0);
  });

  it('refuses an over-cap buffer with `file exceeds the maximum upload size` (raw bridge)', async () => {
    await install();
    const big = new Uint8Array(UPLOAD_BYTES_MAX_BYTES + 1);
    big.set(PNG);
    expect(await raw({ bytes: big.buffer })).toEqual({
      requestId: expect.any(String),
      error: 'file exceeds the maximum upload size',
    });
    expect(uploaded).toHaveLength(0);
  });

  it('accepts a PNG of exactly the cap', async () => {
    await install();
    const max = new Uint8Array(UPLOAD_BYTES_MAX_BYTES);
    max.set(PNG);
    const reply = await raw({ bytes: max.buffer });
    expect(reply.error).toBeUndefined();
    expect(reply.selected).toMatchObject({ imageId: 12345701 });
  });

  it('refuses `busy` once the window holds 3 uploads, and checks the cap BEFORE the window', async () => {
    await install();
    for (let i = 0; i < 3; i++) expect((await raw({ bytes: buf(PNG) })).error).toBeUndefined();
    expect(await raw({ bytes: buf(PNG) })).toMatchObject({ error: 'busy' });
    // A full window still reports an over-cap file as too large: a retry could never succeed.
    expect(await raw({ bytes: new ArrayBuffer(UPLOAD_BYTES_MAX_BYTES + 1) })).toMatchObject({
      error: 'file exceeds the maximum upload size',
    });
    // And `busy` before the type: a GIF in a full window is `busy`, as on the host.
    expect(await raw({ bytes: buf(GIF) })).toMatchObject({ error: 'busy' });
    expect(uploaded).toHaveLength(3);
  });

  it('refuses `busy` once the window holds 80 MiB, before the count limit is reached', async () => {
    await install();
    const max = new Uint8Array(UPLOAD_BYTES_MAX_BYTES);
    max.set(PNG);
    expect((await raw({ bytes: max.slice().buffer })).error).toBeUndefined();
    expect((await raw({ bytes: max.slice().buffer })).error).toBeUndefined();
    // Two uploads (under the count of 3), 80 MiB held: one more byte is over budget.
    expect(await raw({ bytes: buf(PNG) })).toMatchObject({ error: 'busy' });
  });

  it('frees the window after 60 s', async () => {
    await install();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    for (let i = 0; i < 3; i++) await raw({ bytes: buf(PNG) });
    now.mockReturnValue(1_000_000 + 59_999);
    expect((await raw({ bytes: buf(PNG) })).error).toBe('busy');
    now.mockReturnValue(1_000_000 + 60_000);
    expect((await raw({ bytes: buf(PNG) })).error).toBeUndefined();
  });

  it('does not count a refused upload against the window', async () => {
    await install();
    for (let i = 0; i < 3; i++) await raw({ bytes: buf(GIF) });
    expect((await raw({ bytes: buf(PNG) })).error).toBeUndefined();
  });

  it.each([
    ['a Uint8Array', () => ({ bytes: PNG.slice() })],
    ['an empty buffer', () => ({ bytes: new ArrayBuffer(0) })],
    ['purpose generationSource', () => ({ bytes: buf(PNG), purpose: 'generationSource' })],
  ])('refuses %s with `invalid image-upload request`', async (_n, payload) => {
    await install();
    expect(await raw(payload())).toEqual({
      requestId: expect.any(String),
      error: 'invalid image-upload request',
    });
  });

  it('ignores `asyncScan` on a bytes upload: one blocking moderated reply', async () => {
    await install();
    const reply = await raw({ bytes: buf(PNG), asyncScan: true });
    expect(reply.selected).toMatchObject({ imageId: 12345701, contentRating: 'pg' });
    expect(reply.selected).not.toHaveProperty('status');
  });

  it('`uploadImageBytesError` forces a refusal after admission, and setScenario clears it', async () => {
    const host = createMockHost({
      onUploadImageBytes: (f) => uploaded.push(f),
      uploadImageBytesError: 'block lacks posts:write:self scope',
    });
    uninstall = host.install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect((await upload(buf(PNG))).caught?.message).toBe('block lacks posts:write:self scope');
    // The type check still runs first.
    expect((await upload(buf(GIF))).caught?.message).toBe('file type is not allowed');
    host.setScenario({ uploadImageBytesError: undefined });
    expect((await upload(buf(PNG))).caught).toBeNull();
    expect(uploaded).toHaveLength(1);
  });

  it('`uploadImageBytesResult` sets the reply, live-tunable', async () => {
    const host = createMockHost({
      uploadImageBytesResult: { imageId: 77, nsfwLevel: 2, contentRating: 'pg13', url: 'https://image.civitai.com/a.png' },
    });
    uninstall = host.install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect((await upload(buf(PNG))).value).toMatchObject({ imageId: 77 });
    host.setScenario({
      uploadImageBytesResult: { imageId: 78, nsfwLevel: 1, contentRating: 'g', url: 'https://image.civitai.com/b.png' },
    });
    expect((await upload(buf(PNG))).value).toMatchObject({ imageId: 78 });
  });

  it('leaves the picker path alone: `useImageUpload().open()` still returns the canned pick', async () => {
    await install();
    const { result } = renderHook(() => useImageUpload());
    let picked: unknown;
    await act(async () => {
      picked = await result.current.open();
    });
    expect(picked).toMatchObject({ imageId: 12345678 });
    expect(uploaded).toHaveLength(0);
  });
});
