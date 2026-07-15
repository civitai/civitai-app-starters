import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  BlockGenerationSourceImageInfo,
  BlockUploadedImageInfo,
} from '@civitai/app-sdk/blocks';

import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Coverage for the OPEN_IMAGE_UPLOAD → IMAGE_UPLOAD_RESULT mock backend in
 * `createMockHost`, exercised against the REAL `useImageUpload` hook + transport
 * (mirrors mockHostShared.test.tsx). Confirms the default canned image, a custom
 * one, and the dismissed (`null`) case, plus live `setScenario` re-tuning.
 */

const ORIGIN = window.location.origin;

describe('createMockHost — image-upload scenario', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
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

  async function ready() {
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  it('open() resolves with the default canned moderated image', async () => {
    host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => useImageUpload());
    await ready();

    const img = await result.current.open();
    expect(img).not.toBeNull();
    expect(typeof img!.imageId).toBe('number');
    expect(img!.contentRating).toBe('pg');
    expect(img!.url).toContain('civitai.com');
  });

  it('open() returns a custom canned image', async () => {
    const custom: BlockUploadedImageInfo = {
      imageId: 555,
      nsfwLevel: 4,
      contentRating: 'r',
      url: 'https://image.civitai.com/y/original=true/custom.jpeg',
    };
    host = createMockHost({ cannedImageUpload: custom });
    uninstall = host.install();
    const { result } = renderHook(() => useImageUpload());
    await ready();

    await expect(result.current.open()).resolves.toEqual(custom);
  });

  it('cannedImageUpload:null simulates a dismissed modal → resolves null', async () => {
    host = createMockHost({ cannedImageUpload: null });
    uninstall = host.install();
    const { result } = renderHook(() => useImageUpload());
    await ready();

    await expect(result.current.open()).resolves.toBeNull();
  });

  it('setScenario can flip the canned image mid-session (incl. back to dismissed)', async () => {
    host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => useImageUpload());
    await ready();

    expect(await result.current.open()).not.toBeNull();
    host.setScenario({ cannedImageUpload: null });
    expect(await result.current.open()).toBeNull();
  });

  it("generationSource: open() resolves with the default canned { url, width, height } source", async () => {
    host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    await ready();

    const src = await result.current.open();
    expect(src).not.toBeNull();
    expect(src!.url).toContain('civitai.com');
    expect(typeof src!.width).toBe('number');
    expect(typeof src!.height).toBe('number');
    // The source shape must NOT carry the moderated fields.
    expect('imageId' in (src as object)).toBe(false);
  });

  it('generationSource: returns a custom canned source', async () => {
    const custom: BlockGenerationSourceImageInfo = {
      url: 'https://image.civitai.com/z/original=true/custom-source.jpeg',
      width: 512,
      height: 512,
    };
    host = createMockHost({ cannedGenerationSourceUpload: custom });
    uninstall = host.install();
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    await ready();

    await expect(result.current.open()).resolves.toEqual(custom);
  });

  it('generationSource: cannedGenerationSourceUpload:null → resolves null (dismissed)', async () => {
    host = createMockHost({ cannedGenerationSourceUpload: null });
    uninstall = host.install();
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    await ready();

    await expect(result.current.open()).resolves.toBeNull();
  });

  it('display and generationSource canned results are independent knobs', async () => {
    // Dismiss display, but keep a live generationSource — proves the handler
    // branches on the requested purpose, not a single shared knob.
    host = createMockHost({ cannedImageUpload: null });
    uninstall = host.install();
    const display = renderHook(() => useImageUpload());
    const source = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    await ready();

    expect(await display.result.current.open()).toBeNull();
    expect(await source.result.current.open()).not.toBeNull();
  });
});
