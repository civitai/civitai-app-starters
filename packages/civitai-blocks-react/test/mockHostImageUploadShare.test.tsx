import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockUploadedImageInfo } from '@civitai/app-sdk/blocks';

import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import type { MockHost, MockHostOptions } from '../src/testing.js';

/**
 * `createMockHost`'s answer to `OPEN_IMAGE_UPLOAD { share: true }`, driven
 * through the REAL `useImageUpload` hook and transport, plus the raw wire reply.
 * The shapes pinned here are the real host's (civitai/civitai
 * `PageBlockHost.tsx`, the OPEN_IMAGE_UPLOAD handler's `echo`):
 *
 *   refusal, no token     → { requestId, error: 'no block token', shared: false }
 *   async-scan pending    → { requestId, selected: { status: 'pending', … }, shared }
 *   async-scan dismiss    → { requestId, shared: false }
 *   blocking resolve      → { requestId, selected, shared }
 *   blocking dismiss      → { requestId, shared: false }
 *
 * and a reply to an unshared request never carries `shared`.
 *
 * 🔴 WHAT THIS CANNOT PROVE: that the production host still answers this way.
 * The shapes are a hand port; a later host change is invisible here.
 */

const ORIGIN = window.location.origin;

// Every field distinct from the mock's DEFAULT_IMAGE_UPLOAD, so a mock that
// ignored `cannedImageUpload` on the share path is visible.
const IMAGE: BlockUploadedImageInfo = {
  imageId: 7070707,
  nsfwLevel: 2,
  contentRating: 'pg13',
  url: 'https://image.civitai.com/mock/original=true/shared-upload.jpeg',
};

type Reply = Record<string, unknown>;

describe('createMockHost — OPEN_IMAGE_UPLOAD { share: true }', () => {
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
  });

  async function install(options: MockHostOptions = {}) {
    host = createMockHost({ cannedImageUpload: IMAGE, ...options });
    uninstall = host.install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  /** The raw bridge: the exact IMAGE_UPLOAD_RESULT payload, requestId stripped. */
  async function raw(payload: Record<string, unknown>): Promise<Reply> {
    const reply = (await getTransport().sendRequest(
      { type: 'OPEN_IMAGE_UPLOAD', payload } as never,
      'IMAGE_UPLOAD_RESULT',
    )) as Reply;
    const { requestId, ...rest } = reply;
    expect(typeof requestId).toBe('string');
    return rest;
  }

  // ---- blocking display ----

  it('blocking resolve: { selected, shared: true } by default, and open() resolves shared: true', async () => {
    await install();
    expect(await raw({ share: true })).toEqual({ selected: IMAGE, shared: true });
    const { result } = renderHook(() => useImageUpload({ share: true }));
    await expect(result.current.open()).resolves.toEqual({ ...IMAGE, shared: true });
  });

  it('blocking resolve with cannedImageUploadShared: false → { selected, shared: false }', async () => {
    await install({ cannedImageUploadShared: false });
    expect(await raw({ share: true })).toEqual({ selected: IMAGE, shared: false });
    const { result } = renderHook(() => useImageUpload({ share: true }));
    await expect(result.current.open()).resolves.toEqual({ ...IMAGE, shared: false });
  });

  it('blocking dismiss → { shared: false }, and open() resolves null', async () => {
    await install({ cannedImageUpload: null });
    expect(await raw({ share: true })).toEqual({ shared: false });
    const { result } = renderHook(() => useImageUpload({ share: true }));
    await expect(result.current.open()).resolves.toBeNull();
  });

  it("refusal → { error: 'no block token', shared: false }, and open() REJECTS", async () => {
    await install({ imageUploadShareRefused: true });
    expect(await raw({ share: true })).toEqual({ error: 'no block token', shared: false });
    const { result } = renderHook(() => useImageUpload({ share: true }));
    await expect(result.current.open()).rejects.toThrow('no block token');
  });

  // ---- asyncScan display ----

  it('async-scan pending → { selected: pending, shared }, and the handle carries it', async () => {
    await install();
    const pending = { status: 'pending', imageId: IMAGE.imageId, url: IMAGE.url };
    expect(await raw({ asyncScan: true, share: true })).toEqual({ selected: pending, shared: true });
    const { result } = renderHook(() => useImageUpload({ asyncScan: true, share: true }));
    await expect(result.current.open()).resolves.toEqual({ ...pending, shared: true });
  });

  it('async-scan pending with cannedImageUploadShared: false → shared: false', async () => {
    await install({ cannedImageUploadShared: false });
    const pending = { status: 'pending', imageId: IMAGE.imageId, url: IMAGE.url };
    expect(await raw({ asyncScan: true, share: true })).toEqual({ selected: pending, shared: false });
  });

  it('async-scan dismiss → { shared: false }, and open() resolves null', async () => {
    await install({ cannedImageUpload: null });
    expect(await raw({ asyncScan: true, share: true })).toEqual({ shared: false });
    const { result } = renderHook(() => useImageUpload({ asyncScan: true, share: true }));
    await expect(result.current.open()).resolves.toBeNull();
  });

  it('async-scan refusal REJECTS with no block token', async () => {
    await install({ imageUploadShareRefused: true });
    expect(await raw({ asyncScan: true, share: true })).toEqual({ error: 'no block token', shared: false });
    const { result } = renderHook(() => useImageUpload({ asyncScan: true, share: true }));
    await expect(result.current.open()).rejects.toThrow('no block token');
  });

  // ---- what share does NOT touch ----

  it('an unshared request never carries `shared`, and the refusal knob leaves it alone', async () => {
    await install({ imageUploadShareRefused: true });
    expect(await raw({})).toEqual({ selected: IMAGE });
    expect(await raw({ share: 'yes' })).toEqual({ selected: IMAGE });
    const { result } = renderHook(() => useImageUpload());
    await expect(result.current.open()).resolves.toEqual(IMAGE);
  });

  it('generationSource ignores share: no echo, no refusal', async () => {
    await install({ imageUploadShareRefused: true });
    const reply = await raw({ purpose: 'generationSource', share: true });
    expect('shared' in reply).toBe(false);
    expect('error' in reply).toBe(false);
    expect(reply.selected).toBeDefined();
  });

  it('setScenario flips the shared echo and the refusal live', async () => {
    await install();
    expect(await raw({ share: true })).toEqual({ selected: IMAGE, shared: true });
    host!.setScenario({ cannedImageUploadShared: false });
    expect(await raw({ share: true })).toEqual({ selected: IMAGE, shared: false });
    host!.setScenario({ imageUploadShareRefused: true });
    expect(await raw({ share: true })).toEqual({ error: 'no block token', shared: false });
    host!.setScenario({ imageUploadShareRefused: false, cannedImageUploadShared: true });
    expect(await raw({ share: true })).toEqual({ selected: IMAGE, shared: true });
  });
});
