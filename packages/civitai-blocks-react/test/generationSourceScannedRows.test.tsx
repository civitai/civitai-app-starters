import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  BlockMediaUploadInfo,
  BlockUploadedGenerationSource,
} from '@civitai/app-sdk/blocks';

import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { useMediaUpload } from '../src/hooks/useMediaUpload.js';
import { getTransport } from '../src/transport/singleton.js';
import { isValidImageUploadResult, isValidMediaUploadResult } from '../src/transport/validate.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * A picked generation source as a SCANNED ROW (civitai/civitai, `app-block-source-scanned-rows`).
 *
 * While that host flag is on, the host copies the consumer blob it uploaded for
 * `useImageUpload({ purpose: 'generationSource' })` (and for a single `useMediaUpload` image)
 * into a private scanned `Image` row, and replies with THAT row: the same `{ url, width, height }`
 * plus `imageId` and `ready`. With the flag off, or from an older host, the reply is the blob,
 * `{ url, width, height }` only. Both must reach the app; the API does not change.
 */

const ORIGIN = window.location.origin;

const BLOB_SOURCE = {
  url: 'https://orchestration.civitai.com/v2/consumer/blobs/ABC123.jpeg?sig=x',
  width: 640,
  height: 480,
};
const SCANNED_SOURCE: BlockUploadedGenerationSource = {
  url: 'https://image.civitai.com/x/k/original=true/k.jpeg',
  width: 638,
  height: 479,
  imageId: 9001,
  ready: true,
};
const SCANNED_MEDIA: BlockMediaUploadInfo = {
  url: 'https://image.civitai.com/x/m/original=true/m.jpeg',
  kind: 'image',
  mimeType: 'image/jpeg',
  sizeBytes: 4321,
  width: 638,
  height: 479,
  imageId: 9002,
  ready: false,
};

describe('IMAGE_UPLOAD_RESULT validation — a generation source', () => {
  it.each([
    ['the blob shape (flag off, older host)', BLOB_SOURCE],
    ['the scanned row, ready', SCANNED_SOURCE],
    ['the scanned row, scan pending', { ...SCANNED_SOURCE, ready: false }],
  ])('accepts %s', (_label, selected) => {
    expect(isValidImageUploadResult({ requestId: 'r', selected })).toBe(true);
  });
});

describe('MEDIA_UPLOAD_RESULT validation — an image kept as a scanned row', () => {
  it('accepts an image with imageId and ready', () => {
    expect(isValidMediaUploadResult({ requestId: 'r', selected: SCANNED_MEDIA })).toBe(true);
  });

  it('accepts an image without them (a blob)', () => {
    const { imageId: _i, ready: _r, ...blob } = SCANNED_MEDIA;
    expect(isValidMediaUploadResult({ requestId: 'r', selected: blob })).toBe(true);
  });
});

describe('the hooks, against the mock host', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  async function ready() {
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  it('useImageUpload({ purpose: generationSource }) resolves the scanned row with imageId and ready', async () => {
    uninstall = createMockHost({ cannedGenerationSourceUpload: SCANNED_SOURCE }).install();
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    await ready();
    await expect(result.current.open()).resolves.toEqual(SCANNED_SOURCE);
  });

  it('a pending scan comes through as ready: false', async () => {
    uninstall = createMockHost({
      cannedGenerationSourceUpload: { ...SCANNED_SOURCE, ready: false },
    }).install();
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    await ready();
    await expect(result.current.open()).resolves.toMatchObject({ ready: false, imageId: 9001 });
  });

  it('the blob shape still resolves unchanged, with no imageId or ready', async () => {
    uninstall = createMockHost({ cannedGenerationSourceUpload: BLOB_SOURCE }).install();
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    await ready();
    const src = await result.current.open();
    expect(src).toEqual(BLOB_SOURCE);
    expect(Object.keys(src!).sort()).toEqual(['height', 'url', 'width']);
  });

  it('useMediaUpload picker mode resolves an image kept as a scanned row', async () => {
    uninstall = createMockHost({ cannedMediaUploads: { image: SCANNED_MEDIA } }).install();
    const { result } = renderHook(() => useMediaUpload());
    await ready();
    let out: BlockMediaUploadInfo | null = null;
    await act(async () => {
      out = await result.current.open({ kind: 'image' });
    });
    expect(out).toEqual(SCANNED_MEDIA);
  });
});
