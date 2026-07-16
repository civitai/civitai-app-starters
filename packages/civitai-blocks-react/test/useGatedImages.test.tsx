import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockGatedImage, BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useGatedImages } from '../src/hooks/useGatedImages.js';
import { getTransport } from '../src/internal/singleton.js';
import { isValidImagesResult, isValidPublishResult } from '../src/internal/validate.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: ['ai:write:budgeted'], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

const VISIBLE: BlockGatedImage = {
  imageId: 9001,
  status: 'visible',
  nsfwLevel: 1,
  contentRating: 'pg',
  url: 'https://image.civitai.com/x/9001.jpeg',
  width: 1024,
  height: 1024,
};
const HIDDEN: BlockGatedImage = { imageId: 9002, status: 'hidden' };

function calls(mock: ReturnType<typeof vi.fn>, type: string) {
  return mock.mock.calls.filter((c) => c[0]?.type === type);
}
function lastGet(mock: ReturnType<typeof vi.fn>): { payload: { requestId: string; imageIds: number[] } } {
  const c = calls(mock, 'GET_IMAGES_BY_IDS');
  return c[c.length - 1]![0] as { payload: { requestId: string; imageIds: number[] } };
}
function dispatch(type: string, payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  });
}

describe('useGatedImages', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

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
    vi.restoreAllMocks();
  });

  it('getImages() forwards the ids and resolves the canned gated projection (incl. a HIDDEN entry with NO url)', async () => {
    const { result } = renderHook(() => useGatedImages());

    let resolved: BlockGatedImage[] | null = null;
    act(() => {
      void result.current.getImages([9001, 9002]).then((v) => {
        resolved = v;
      });
    });

    const sent = lastGet(postMessageMock);
    expect(typeof sent.payload.requestId).toBe('string');
    expect(sent.payload.imageIds).toEqual([9001, 9002]);

    dispatch('IMAGES_RESULT', { requestId: sent.payload.requestId, result: { images: [VISIBLE, HIDDEN] } });

    await waitFor(() => expect(resolved).not.toBeNull());
    expect(resolved).toEqual([VISIBLE, HIDDEN]);
    // The hidden entry never carries a url.
    const hidden = (resolved as unknown as BlockGatedImage[]).find((i) => i.status === 'hidden')!;
    expect(hidden).not.toHaveProperty('url');
  });

  it('rejects with the host FREE-TEXT error string (error, no result)', async () => {
    const { result } = renderHook(() => useGatedImages());

    let caught: Error | null = null;
    act(() => {
      void result.current.getImages([1, 2]).catch((e: Error) => (caught = e));
    });
    const sent = lastGet(postMessageMock);
    dispatch('IMAGES_RESULT', { requestId: sent.payload.requestId, error: 'viewer is banned' });

    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('viewer is banned');
  });
});

describe('isValidImagesResult (defense-in-depth)', () => {
  it('ACCEPTS a well-formed visible + hidden array', () => {
    expect(isValidImagesResult({ requestId: 'r', result: { images: [VISIBLE, HIDDEN] } })).toBe(true);
  });

  it('ACCEPTS the free-text error variant', () => {
    expect(isValidImagesResult({ requestId: 'r', error: 'nope' })).toBe(true);
  });

  it('REJECTS a HIDDEN entry that carries a url (leaked unclamped url)', () => {
    const leaky = { imageId: 9002, status: 'hidden', url: 'https://image.civitai.com/x/9002.jpeg' };
    expect(isValidImagesResult({ requestId: 'r', result: { images: [VISIBLE, leaky] } })).toBe(false);
  });

  it('REJECTS a VISIBLE entry missing its url', () => {
    const noUrl = { imageId: 9001, status: 'visible', nsfwLevel: 1, contentRating: 'pg', width: 1, height: 1 };
    expect(isValidImagesResult({ requestId: 'r', result: { images: [noUrl] } })).toBe(false);
  });

  it('REJECTS a reply with neither result nor error', () => {
    expect(isValidImagesResult({ requestId: 'r' })).toBe(false);
  });
});

describe('isValidPublishResult', () => {
  it('ACCEPTS a value (imageIds) result', () => {
    expect(isValidPublishResult({ requestId: 'r', result: { imageIds: [9001, 9002] } })).toBe(true);
  });

  it('ACCEPTS the free-text error variant', () => {
    expect(isValidPublishResult({ requestId: 'r', error: 'nope' })).toBe(true);
  });

  it('REJECTS a malformed result (imageIds not an array of numbers)', () => {
    expect(isValidPublishResult({ requestId: 'r', result: { imageIds: ['nine-thousand'] } })).toBe(false);
    expect(isValidPublishResult({ requestId: 'r', result: { imageIds: 'not-an-array' } })).toBe(false);
  });

  it('REJECTS a reply with neither result nor error', () => {
    expect(isValidPublishResult({ requestId: 'r' })).toBe(false);
  });
});
