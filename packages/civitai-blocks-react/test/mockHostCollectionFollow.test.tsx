import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CollectionFollowError,
  useCollectionFollow,
} from '../src/hooks/useCollectionFollow.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost`'s SET_COLLECTION_FOLLOW handler, driven through the REAL hook
 * and transport.
 *
 * 🔴 WHAT THIS MOCK STRUCTURALLY CANNOT PROVE, stated so it is not read as
 * more: the consent dialog is HOST chrome, so the mock settles immediately
 * where the real host waits on a click. Nothing here exercises the TIMING of a
 * confirm — only the outcomes. The `declined` path below is the closest
 * available proxy and it is an outcome, not a wait.
 */

const ORIGIN = window.location.origin;

describe('createMockHost — collection follow', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  it('echoes the write, and reads its own write back on the next toggle', async () => {
    uninstall = createMockHost({}).install();
    const { result } = renderHook(() => useCollectionFollow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let r: unknown;
    await act(async () => {
      r = await result.current.setFollow({ collectionId: 7, follow: true });
    });
    expect(r).toEqual({ collectionId: 7, followed: true });

    await act(async () => {
      r = await result.current.setFollow({ collectionId: 7, follow: false });
    });
    expect(r).toEqual({ collectionId: 7, followed: false });
  });

  it('refuses with a CODE when `collectionFollowError` names one', async () => {
    uninstall = createMockHost({ collectionFollowError: 'declined' }).install();
    const { result } = renderHook(() => useCollectionFollow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let caught: unknown;
    await act(async () => {
      await result.current.setFollow({ collectionId: 7, follow: true }).catch((e: unknown) => {
        caught = e;
      });
    });
    expect(caught).toBeInstanceOf(CollectionFollowError);
    expect((caught as CollectionFollowError).declined).toBe(true);
  });

  it('refuses with FREE TEXT when `collectionFollowError` is a server message', async () => {
    // The variant a code-only knob could not express, and the one a block is
    // most likely to render verbatim.
    uninstall = createMockHost({ collectionFollowError: 'Collection is private' }).install();
    const { result } = renderHook(() => useCollectionFollow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let caught: unknown;
    await act(async () => {
      await result.current.setFollow({ collectionId: 7, follow: true }).catch((e: unknown) => {
        caught = e;
      });
    });
    expect((caught as CollectionFollowError).code).toBeUndefined();
    expect((caught as CollectionFollowError).message).toBe('Collection is private');
  });

  it('mirrors the real host and refuses a malformed id rather than coercing it', async () => {
    // 🔴 Without this the mock is MORE permissive than production, so a block
    // bug (a numeric-string id) works in dev:mock and is refused live — the
    // exact drift a mock exists to prevent.
    uninstall = createMockHost({}).install();
    const { result } = renderHook(() => useCollectionFollow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    for (const bad of [0, -1, 1.5, '7' as unknown as number]) {
      let caught: unknown;
      await act(async () => {
        await result.current
          .setFollow({ collectionId: bad, follow: true })
          .catch((e: unknown) => {
            caught = e;
          });
      });
      expect((caught as CollectionFollowError).code, `collectionId=${String(bad)}`).toBe(
        'invalid-request',
      );
    }
  });

  it('seeds from `collectionFollows` and MERGES a setScenario patch', async () => {
    const host = createMockHost({ collectionFollows: { 1: true, 2: true } });
    uninstall = host.install();
    const { result } = renderHook(() => useCollectionFollow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    host.setScenario({ collectionFollows: { 1: false } });
    // The merge is observable through the WRITE path: collection 2's seeded
    // state must survive a patch that names only collection 1. (A replacing
    // patch would silently unfollow every other collection the block has
    // toggled.)
    let r: unknown;
    await act(async () => {
      r = await result.current.setFollow({ collectionId: 2, follow: false });
    });
    expect(r).toEqual({ collectionId: 2, followed: false });

    host.setScenario({ collectionFollowError: 'review-mode' });
    let caught: unknown;
    await act(async () => {
      await result.current.setFollow({ collectionId: 2, follow: true }).catch((e: unknown) => {
        caught = e;
      });
    });
    expect((caught as CollectionFollowError).code).toBe('review-mode');
  });
});
