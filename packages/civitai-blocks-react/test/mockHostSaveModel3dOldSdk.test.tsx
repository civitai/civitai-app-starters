import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSaveImage, type SaveImageInput } from '../src/hooks/useSaveImage.js';
import { SAVE_MODEL3D_NEEDS_NEWER_APP_SDK_ERROR } from '../src/internal/saveBytesPrepare.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import type { MockHostOptions } from '../src/testing.js';
import { buildGlb } from '../../civitai-app-sdk/test/model3dFixtures.js';
import { zipFixture } from './zipFixtures.js';

/**
 * An app-sdk that predates `./save-model3d` (everything the >=0.57.0 peer floor admits up to
 * 0.92.x), simulated by making that subpath fail to load, as Node does with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. `./testing` must still LOAD and save every other type (a zip
 * included: `./save-zip` still loads); only a model save is refused, with its own message.
 * Reaching this file's imports at all is the first assertion: a static import of the subpath
 * anywhere on the `./testing` graph would fail the whole file.
 */
vi.mock('@civitai/app-sdk/save-model3d', () => {
  throw Object.assign(new Error('Package subpath ./save-model3d is not defined by "exports"'), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  });
});

const ORIGIN = window.location.origin;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

type Saved = Parameters<NonNullable<MockHostOptions['onSaveBytes']>>[0];

describe('createMockHost on an app-sdk without ./save-model3d', () => {
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
  });

  async function save(input: SaveImageInput): Promise<Error | null> {
    uninstall = createMockHost({ onSaveBytes: (f) => saved.push(f) }).install();
    const { result } = renderHook(() => useSaveImage());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let caught: Error | null = null;
    await act(async () => {
      await result.current.saveImage(input).catch((e: Error) => (caught = e));
    });
    return caught;
  }

  it('CONTROL: an image and a zip still save (the model check is never loaded for them)', async () => {
    expect(await save({ bytes: PNG.slice().buffer, filename: 'a.png' })).toBeNull();
    const zip = zipFixture([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]);
    expect(await save({ bytes: zip, filename: 'd.zip' })).toBeNull();
    expect(saved.map((s) => s.mimeType)).toEqual(['image/png', 'application/zip']);
  });

  it('a model save is refused with its own message, not a crash or a hang', async () => {
    const err = await save({ bytes: buildGlb({ binBytes: 8 }).slice().buffer, filename: 'm.glb' });
    expect(err?.message).toBe(SAVE_MODEL3D_NEEDS_NEWER_APP_SDK_ERROR);
    // The literal, not only the constant: the message must name the subpath a reader has to get.
    expect(err?.message).toContain('@civitai/app-sdk/save-model3d');
    expect(saved).toHaveLength(0);
  });
});
