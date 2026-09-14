import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreatePostError, useCreatePostFromApp } from '../src/hooks/useCreatePostFromApp.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost`'s CREATE_POST_FROM_APP handler, driven through the REAL hook
 * and transport.
 *
 * 🔴 WHAT THIS MOCK STRUCTURALLY CANNOT PROVE, stated so it is not read as more.
 * The consent dialog is HOST chrome and it is the security control on this
 * bridge: the real host makes a server-side PREVIEW call and renders THAT — the
 * tag names that will actually be applied, host-fetched model names, real
 * thumbnails — before the viewer decides. The mock has no preview and no dialog,
 * so it settles immediately where the real host waits on a click, and nothing
 * here exercises either the timing or the CONTENT of that confirm. The
 * `declined` path below is the closest available proxy and it is an outcome, not
 * a wait.
 */

const ORIGIN = window.location.origin;

describe('createMockHost — create post from app', () => {
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

  it('returns the canned post', async () => {
    uninstall = createMockHost({}).install();
    const { result } = renderHook(() => useCreatePostFromApp());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let r: unknown;
    await act(async () => {
      r = await result.current.createPost({
        sources: [{ kind: 'workflow', workflowId: 'wf_1', imageIndexes: [0] }],
      });
    });
    expect(r).toEqual({
      postId: 4242,
      url: 'https://civitai.com/posts/4242',
      imageIds: [9101, 9102],
    });
  });

  it('returns a caller-supplied post when `createPostResult` is set', async () => {
    uninstall = createMockHost({
      createPostResult: { postId: 7, url: 'https://civitai.com/posts/7', imageIds: [1, 2, 3] },
    }).install();
    const { result } = renderHook(() => useCreatePostFromApp());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let r: unknown;
    await act(async () => {
      r = await result.current.createPost({ sources: [{ kind: 'published', imageIds: [1] }] });
    });
    expect(r).toEqual({ postId: 7, url: 'https://civitai.com/posts/7', imageIds: [1, 2, 3] });
  });

  it('refuses with a CODE when `createPostError` names one', async () => {
    uninstall = createMockHost({ createPostError: 'declined' }).install();
    const { result } = renderHook(() => useCreatePostFromApp());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let caught: unknown;
    await act(async () => {
      await result.current
        .createPost({ sources: [{ kind: 'workflow', workflowId: 'wf_1' }] })
        .catch((e: unknown) => {
          caught = e;
        });
    });
    expect(caught).toBeInstanceOf(CreatePostError);
    expect((caught as CreatePostError).declined).toBe(true);
    expect((caught as CreatePostError).code).toBe('declined');
    expect((caught as CreatePostError).timedOut).toBe(false);
  });

  it('refuses with FREE TEXT when `createPostError` is a server message, leaving `.code` undefined', async () => {
    // The distinction the hook's consumers branch on: a closed host code
    // (actionable, e.g. route `sign in to post` into useRequestSignIn) versus an
    // opaque server message that is safe to render. A validator that constrained
    // `error` to the code set would drop this reply entirely and hang the block.
    uninstall = createMockHost({
      createPostError: 'this app may not attach posts to its own publisher’s models',
    }).install();
    const { result } = renderHook(() => useCreatePostFromApp());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let caught: unknown;
    await act(async () => {
      await result.current
        .createPost({ sources: [{ kind: 'workflow', workflowId: 'wf_1' }] })
        .catch((e: unknown) => {
          caught = e;
        });
    });
    expect(caught).toBeInstanceOf(CreatePostError);
    expect((caught as CreatePostError).code).toBeUndefined();
    expect((caught as CreatePostError).declined).toBe(false);
    expect((caught as CreatePostError).message).toBe(
      'this app may not attach posts to its own publisher’s models',
    );
  });

  it('mirrors the real host payload gate: an EMPTY sources array is refused, not coerced', async () => {
    // 🔴 The point of a mock is that a block bug fails HERE rather than in
    // production. The real host's `resolveCreatePostRequest` refuses an empty
    // `sources` with exactly this code; a mock that happily posted would let an
    // empty selection work in dev and break on install.
    uninstall = createMockHost({}).install();
    const { result } = renderHook(() => useCreatePostFromApp());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let caught: unknown;
    await act(async () => {
      await result.current.createPost({ sources: [] }).catch((e: unknown) => {
        caught = e;
      });
    });
    expect(caught).toBeInstanceOf(CreatePostError);
    expect((caught as CreatePostError).code).toBe('no images to post');
  });

  it('`setScenario` re-points the result and the refusal live', async () => {
    const host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => useCreatePostFromApp());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    host.setScenario({ createPostError: 'sign in to post' });
    let caught: unknown;
    await act(async () => {
      await result.current
        .createPost({ sources: [{ kind: 'workflow', workflowId: 'wf_1' }] })
        .catch((e: unknown) => {
          caught = e;
        });
    });
    expect(caught).toBeInstanceOf(CreatePostError);
    expect((caught as CreatePostError).signInRequired).toBe(true);
  });
});
