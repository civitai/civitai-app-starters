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
/** The viewer's OWN image that nothing has rated yet: url, marker, NO rating. */
const RATING_PENDING: BlockGatedImage = {
  imageId: 9003,
  status: 'visible',
  ratingPending: true,
  url: 'https://image.civitai.com/x/9003.jpeg',
  width: 1024,
  height: 1024,
};
/** The same entry as an UNTYPED literal, so the malformed variants below can be
 *  built by spreading. They are shapes `BlockGatedImage` deliberately cannot
 *  express — the validator's job is to reject them at runtime anyway, because
 *  the host is on the other side of a postMessage boundary and its types are not
 *  evidence about the bytes it sent. */
const PENDING_LITERAL: Record<string, unknown> = {
  imageId: 9003,
  status: 'visible',
  ratingPending: true,
  url: 'https://image.civitai.com/x/9003.jpeg',
  width: 1024,
  height: 1024,
};

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

  /**
   * REGRESSION — an EMPTY host error must not surface as an EMPTY Error message.
   * `isValidImagesResult` gates `error` on SHAPE only (`typeof p.error !== 'string'`
   * → reject), so `{ error: '' }` is a VALID reply that reaches the hook. `??`
   * replaces only null/undefined, so it PRESERVES `''` and getImages() rejects with
   * a messageless Error. The matcher is ANCHORED — `toThrow('<string>')`
   * substring-matches, so an unanchored assertion can pass on broken code.
   */
  it('rejects with readable copy when the host error is an EMPTY string', async () => {
    const { result } = renderHook(() => useGatedImages());

    let p!: Promise<BlockGatedImage[]>;
    act(() => {
      p = result.current.getImages([1, 2]);
      p.catch(() => {});
    });
    dispatch('IMAGES_RESULT', { requestId: lastGet(postMessageMock).payload.requestId, error: '' });

    await expect(p).rejects.toThrow(/^failed to fetch gated images$/);
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

  // ── `ratingPending`: the viewer's OWN not-yet-rated image ──────────────────
  // 🔴 THIS BLOCK IS THE REASON THE SDK CHANGE IS A CO-REQUISITE AND NOT A
  // NICETY. Before it, `isValidGatedImage` REQUIRED `nsfwLevel` + `contentRating`
  // on every `visible` entry, so the host's new owner projection failed the shape
  // check and `isValidImagesResult` DROPPED THE WHOLE REPLY — every image in the
  // batch, not just the pending one. The block would have hung on a `getImages()`
  // that never resolved. That is strictly worse than the "rated mature" bug the
  // server change fixes.

  it('ACCEPTS a `ratingPending` entry — url, no rating claim', () => {
    expect(isValidImagesResult({ requestId: 'r', result: { images: [RATING_PENDING] } })).toBe(true);
    // …and alongside the other two shapes, which is what a real grid returns.
    expect(
      isValidImagesResult({ requestId: 'r', result: { images: [VISIBLE, HIDDEN, RATING_PENDING] } })
    ).toBe(true);
  });

  it('REJECTS a `ratingPending` entry that ALSO claims a rating', () => {
    // The precise contradiction the state exists to stop: a host asserting a
    // rating it has just said does not exist. Built as plain literals — these are
    // shapes `BlockGatedImage` cannot express, which is the point.
    for (const extra of [{ nsfwLevel: 1 }, { contentRating: 'pg' }, { nsfwLevel: 1, contentRating: 'pg' }]) {
      const contradictory = { ...PENDING_LITERAL, ...extra };
      expect(isValidImagesResult({ requestId: 'r', result: { images: [contradictory] } })).toBe(false);
    }
  });

  it('REJECTS a `ratingPending` marker that is not exactly `true`', () => {
    for (const marker of [false, 1, 'true', null, {}]) {
      const odd = { ...PENDING_LITERAL, ratingPending: marker };
      expect(isValidImagesResult({ requestId: 'r', result: { images: [odd] } })).toBe(false);
    }
  });

  it('REJECTS a VISIBLE entry with NEITHER a rating NOR `ratingPending`', () => {
    // A host that dropped the marker. A block reading `nsfwLevel === undefined`
    // here cannot tell "unrated" from "the field went missing", so refuse it
    // rather than let the ambiguity through.
    const bare = { imageId: 9001, status: 'visible', url: 'https://image.civitai.com/x/9001.jpeg', width: 1, height: 1 };
    expect(isValidImagesResult({ requestId: 'r', result: { images: [bare] } })).toBe(false);
  });

  it('REJECTS a half-populated rating (one field, not both)', () => {
    const onlyLevel = { imageId: 9001, status: 'visible', nsfwLevel: 1, url: 'https://image.civitai.com/x/9001.jpeg', width: 1, height: 1 };
    const onlyRating = { imageId: 9001, status: 'visible', contentRating: 'pg', url: 'https://image.civitai.com/x/9001.jpeg', width: 1, height: 1 };
    expect(isValidImagesResult({ requestId: 'r', result: { images: [onlyLevel] } })).toBe(false);
    expect(isValidImagesResult({ requestId: 'r', result: { images: [onlyRating] } })).toBe(false);
  });

  it('accepts `nsfwLevel: 0` — presence, not truthiness', () => {
    // POSITIVE CONTROL for the `in`-based presence test: a falsy-check
    // implementation would read a real `0` level as "absent" and then demand a
    // `ratingPending` marker that is not there.
    const zeroLevel = {
      imageId: 9001,
      status: 'visible',
      nsfwLevel: 0,
      contentRating: 'pg',
      url: 'https://image.civitai.com/x/9001.jpeg',
      width: 1,
      height: 1,
    };
    expect(isValidImagesResult({ requestId: 'r', result: { images: [zeroLevel] } })).toBe(true);
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
