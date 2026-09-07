import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import {
  CollectionFollowError,
  COLLECTION_FOLLOW_ERROR_CODES,
  isCollectionFollowErrorCode,
  useCollectionFollow,
} from '../src/hooks/useCollectionFollow.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

function lastRequest(mock: ReturnType<typeof vi.fn>): {
  payload: { requestId: string; collectionId: number; follow: boolean };
} {
  const calls = mock.mock.calls.filter((c) => c[0]?.type === 'SET_COLLECTION_FOLLOW');
  return calls[calls.length - 1]![0] as {
    payload: { requestId: string; collectionId: number; follow: boolean };
  };
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'COLLECTION_FOLLOW_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

describe('useCollectionFollow', () => {
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
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
    vi.restoreAllMocks();
  });

  it('sends collectionId + follow and resolves with the host ECHO, not the request', async () => {
    const { result } = renderHook(() => useCollectionFollow());
    let settled: unknown;
    act(() => {
      void result.current.setFollow({ collectionId: 42, follow: true }).then((r) => {
        settled = r;
      });
    });

    const req = lastRequest(postMessageMock);
    expect(req.payload.collectionId).toBe(42);
    expect(req.payload.follow).toBe(true);
    // 🔴 NO token, and no name, on the wire. The host self-binds the viewer and
    // resolves the collection's identity itself — a `name` field here would be
    // the misrepresentation surface the host's own comment forbids.
    expect(Object.keys(req.payload).sort()).toEqual(['collectionId', 'follow', 'requestId']);

    // The echo DISAGREES with the request on purpose: this is the control that
    // separates "returns the host's answer" from "returns what we asked for".
    // A hook returning its own argument passes an agreeing fixture either way.
    dispatchResult({ requestId: req.payload.requestId, result: { collectionId: 42, followed: false } });
    await waitFor(() => expect(settled).toEqual({ collectionId: 42, followed: false }));
  });

  it('toggles `pending` across the request', async () => {
    const { result } = renderHook(() => useCollectionFollow());
    expect(result.current.pending).toBe(false);
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.setFollow({ collectionId: 1, follow: true });
      void p.catch(() => {});
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    const req = lastRequest(postMessageMock);
    dispatchResult({ requestId: req.payload.requestId, result: { collectionId: 1, followed: true } });
    await act(async () => {
      await p;
    });
    expect(result.current.pending).toBe(false);
  });

  // Drive EVERY closed refusal code, not a representative one: `declined` and
  // `sign-in-required` carry extra booleans consumers branch on, and a code
  // dropped from the union would otherwise be classified as free-text prose.
  for (const code of COLLECTION_FOLLOW_ERROR_CODES) {
    it(`rejects with a coded CollectionFollowError for '${code}'`, async () => {
      const { result } = renderHook(() => useCollectionFollow());
      let caught: unknown;
      let p!: Promise<unknown>;
      act(() => {
        p = result.current.setFollow({ collectionId: 9, follow: true });
        void p.catch((e: unknown) => {
          caught = e;
        });
      });
      const req = lastRequest(postMessageMock);
      dispatchResult({ requestId: req.payload.requestId, error: code });
      await waitFor(() => expect(caught).toBeInstanceOf(CollectionFollowError));
      const err = caught as CollectionFollowError;
      expect(err.code).toBe(code);
      expect(err.declined).toBe(code === 'declined');
      expect(err.signInRequired).toBe(code === 'sign-in-required');
      await waitFor(() => expect(result.current.error).toBe(err));
    });
  }

  it('leaves `.code` UNDEFINED for a free-text server message and keeps the message', async () => {
    const { result } = renderHook(() => useCollectionFollow());
    let caught: unknown;
    act(() => {
      void result.current
        .setFollow({ collectionId: 9, follow: true })
        .catch((e: unknown) => {
          caught = e;
        });
    });
    const req = lastRequest(postMessageMock);
    // What the real host forwards from the collection service on a private
    // collection — an `err.message`, not a code.
    dispatchResult({
      requestId: req.payload.requestId,
      error: 'You do not have permission to follow this collection',
    });
    await waitFor(() => expect(caught).toBeInstanceOf(CollectionFollowError));
    const err = caught as CollectionFollowError;
    expect(err.code).toBeUndefined();
    expect(err.declined).toBe(false);
    expect(err.signInRequired).toBe(false);
    expect(err.message).toBe('You do not have permission to follow this collection');
  });

  it("does NOT throw a blank-message error when the host sends error: ''", async () => {
    // 🔴 The `||`-not-`??` case. `isValidCollectionFollowResult` gates `error` on
    // SHAPE only (it must — the channel carries free-text), so an empty string is
    // a VALID reply that reaches the hook. `??` would produce an Error with an
    // empty message for an account write, which renders as a blank failure.
    const { result } = renderHook(() => useCollectionFollow());
    let caught: unknown;
    act(() => {
      void result.current.setFollow({ collectionId: 9, follow: true }).catch((e: unknown) => {
        caught = e;
      });
    });
    const req = lastRequest(postMessageMock);
    dispatchResult({ requestId: req.payload.requestId, error: '' });
    await waitFor(() => expect(caught).toBeInstanceOf(CollectionFollowError));
    const err = caught as CollectionFollowError;
    expect(err.message).not.toBe('');
    expect(err.code).toBe('collection-unavailable');
  });

  it('clears a previous error at the start of the next call', async () => {
    const { result } = renderHook(() => useCollectionFollow());
    act(() => {
      void result.current.setFollow({ collectionId: 9, follow: true }).catch(() => {});
    });
    dispatchResult({ requestId: lastRequest(postMessageMock).payload.requestId, error: 'declined' });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      void result.current.setFollow({ collectionId: 9, follow: true }).catch(() => {});
    });
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  describe('isCollectionFollowErrorCode', () => {
    it('accepts every member of the closed set', () => {
      for (const code of COLLECTION_FOLLOW_ERROR_CODES) {
        expect(isCollectionFollowErrorCode(code)).toBe(true);
      }
    });

    it('rejects free text, including strings that CONTAIN a code', () => {
      expect(isCollectionFollowErrorCode('nope')).toBe(false);
      expect(isCollectionFollowErrorCode('')).toBe(false);
      // Substring, not membership — a `.includes()` implementation would pass
      // this and misclassify a server message as a host refusal.
      expect(isCollectionFollowErrorCode('the request was declined by the server')).toBe(false);
      expect(isCollectionFollowErrorCode('DECLINED')).toBe(false);
    });
  });

  it('pins the closed refusal set EXACTLY (fails when it grows or shrinks)', () => {
    // Mirrors civitai/civitai's `CollectionFollowRefusal`. A host that gains a
    // code without this SDK gaining it would classify the new one as free text,
    // silently losing `declined`-style handling for it.
    expect([...COLLECTION_FOLLOW_ERROR_CODES].sort()).toEqual([
      'collection-unavailable',
      'declined',
      'invalid-request',
      'not-ready',
      'review-mode',
      'sign-in-required',
    ]);
  });
});
