import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, BlockShareLinkResult } from '@civitai/app-sdk/blocks';

import { useShareLink } from '../src/hooks/useShareLink.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../src/transport/requestTimeouts.js';
import { getTransport } from '../src/transport/singleton.js';
import { RequestTimeoutError } from '../src/transport/transport.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useShareLink()` — SHARE_LINK → SHARE_LINK_RESULT (HQ app_blocks_sdk_j1gc).
 *
 * The HOST builds the canonical URL and performs the copy (or opens the share sheet);
 * the hook sends only the view to link to and returns what really happened:
 * `{ url, copied, method }`. `copied: false` is a normal result, not an error: the app
 * shows `url` as selectable text.
 */

const PARENT_ORIGIN = 'https://civitai.com';
const URL_42 = 'https://civitai.com/apps/run/live-characters/c/42?take=3';

function buildInit(context: BlockInitPayload['context']): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 600_000).toISOString() },
    context,
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

const PAGE_CONTEXT = {
  slotId: 'app.page',
  entityType: 'none',
  slug: 'live-characters',
  subPath: 'c/42',
  search: '?take=3',
  hash: '#top',
  viewerUserId: 7,
} as BlockInitPayload['context'];

type SentShare = { type: string; payload: { requestId: string; subPath: string; search?: string; hash?: string } };

function calls(mock: ReturnType<typeof vi.fn>, type: string) {
  return mock.mock.calls.filter((c) => c[0]?.type === type);
}
function lastShare(mock: ReturnType<typeof vi.fn>): SentShare {
  const c = calls(mock, 'SHARE_LINK');
  return c[c.length - 1]![0] as SentShare;
}
function dispatch(type: string, payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  });
}

describe('useShareLink', () => {
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
        data: { type: 'BLOCK_INIT', payload: buildInit(PAGE_CONTEXT) },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('with no argument, links to the CURRENT view: subPath, search and hash from the route', () => {
    const { result } = renderHook(() => useShareLink());
    act(() => {
      void result.current.share().catch(() => {});
    });
    const all = calls(postMessageMock, 'SHARE_LINK');
    expect(all).toHaveLength(1);
    const [msg, target] = all[0]!;
    expect(target).toBe(PARENT_ORIGIN);
    const sent = msg as SentShare;
    expect(typeof sent.payload.requestId).toBe('string');
    expect(sent).toEqual({
      type: 'SHARE_LINK',
      payload: { requestId: sent.payload.requestId, subPath: 'c/42', search: '?take=3', hash: '#top' },
    });
  });

  it('with a target, sends exactly that view — and omits an empty search and hash', () => {
    const { result } = renderHook(() => useShareLink());
    act(() => {
      void result.current.share({ subPath: 'c/7' }).catch(() => {});
    });
    const sent = lastShare(postMessageMock);
    expect(sent.payload).toEqual({ requestId: sent.payload.requestId, subPath: 'c/7' });
  });

  it('never sends an absolute URL: only the view is the app’s to choose', () => {
    const { result } = renderHook(() => useShareLink());
    act(() => {
      void result.current.share({ subPath: 'c/7', search: '?take=1', hash: '#x' }).catch(() => {});
    });
    const sent = lastShare(postMessageMock);
    expect(Object.keys(sent.payload).sort()).toEqual(['hash', 'requestId', 'search', 'subPath']);
    expect(JSON.stringify(sent.payload)).not.toContain('http');
  });

  it('resolves { url, copied: true, method: "clipboard" } and exposes it as lastResult', async () => {
    const { result } = renderHook(() => useShareLink());
    let p!: Promise<BlockShareLinkResult>;
    act(() => {
      p = result.current.share();
    });
    dispatch('SHARE_LINK_RESULT', {
      requestId: lastShare(postMessageMock).payload.requestId,
      result: { url: URL_42, copied: true, method: 'clipboard' },
    });
    await expect(p).resolves.toEqual({ url: URL_42, copied: true, method: 'clipboard' });
    await waitFor(() =>
      expect(result.current.lastResult).toEqual({ url: URL_42, copied: true, method: 'clipboard' }),
    );
  });

  it('🔴 copied:false is a RESULT (show the url as text), not an error', async () => {
    const { result } = renderHook(() => useShareLink());
    let p!: Promise<BlockShareLinkResult>;
    act(() => {
      p = result.current.share();
    });
    dispatch('SHARE_LINK_RESULT', {
      requestId: lastShare(postMessageMock).payload.requestId,
      result: { url: URL_42, copied: false, method: 'none' },
    });
    await expect(p).resolves.toEqual({ url: URL_42, copied: false, method: 'none' });
    expect(result.current.error).toBeNull();
  });

  it('a completed share sheet is method "share" with copied false', async () => {
    const { result } = renderHook(() => useShareLink());
    let p!: Promise<BlockShareLinkResult>;
    act(() => {
      p = result.current.share();
    });
    dispatch('SHARE_LINK_RESULT', {
      requestId: lastShare(postMessageMock).payload.requestId,
      result: { url: URL_42, copied: false, method: 'share' },
    });
    await expect(p).resolves.toEqual({ url: URL_42, copied: false, method: 'share' });
  });

  it.each([['invalid share link'], ['rate_limited'], ['sharing is not available here']])(
    'rejects with the host error %s and exposes it as `error`',
    async (msg) => {
      const { result } = renderHook(() => useShareLink());
      let p!: Promise<BlockShareLinkResult>;
      act(() => {
        p = result.current.share({ subPath: '../x' });
        p.catch(() => {});
      });
      dispatch('SHARE_LINK_RESULT', { requestId: lastShare(postMessageMock).payload.requestId, error: msg });
      await expect(p).rejects.toThrow(new RegExp(`^${msg}$`));
      await waitFor(() => expect(result.current.error?.message).toBe(msg));
    },
  );

  it.each([
    ['neither result nor error', {}],
    ['result is not an object', { result: 'nope' }],
    ['result.url missing', { result: { copied: true, method: 'clipboard' } }],
    ['result.url empty', { result: { url: '', copied: true, method: 'clipboard' } }],
    ['result.url not http(s)', { result: { url: 'javascript:alert(1)', copied: false, method: 'none' } }],
    ['result.copied not a boolean', { result: { url: URL_42, copied: 'yes', method: 'clipboard' } }],
    ['result.method not a string', { result: { url: URL_42, copied: false, method: 1 } }],
    ['copied:true but method is not clipboard', { result: { url: URL_42, copied: true, method: 'none' } }],
    ['error is not a string', { error: 42 }],
  ])('rejects (does not hang) on a malformed reply: %s', async (_label, fields) => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useShareLink());
    let p!: Promise<BlockShareLinkResult>;
    act(() => {
      p = result.current.share();
    });
    let settled: { ok: boolean; err?: unknown } | null = null;
    p.then(
      () => (settled = { ok: true }),
      (err: unknown) => (settled = { ok: false, err }),
    );
    dispatch('SHARE_LINK_RESULT', { requestId: lastShare(postMessageMock).payload.requestId, ...fields });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(settled).not.toBeNull();
    const s = settled as unknown as { ok: boolean; err?: unknown };
    expect(s.ok).toBe(false);
    expect(s.err).not.toBeInstanceOf(RequestTimeoutError);
    expect((s.err as Error).message).toBe('the host sent a malformed reply to SHARE_LINK');
    warn.mockRestore();
  });

  it('toggles isPending while in flight', async () => {
    const { result } = renderHook(() => useShareLink());
    expect(result.current.isPending).toBe(false);
    let p!: Promise<BlockShareLinkResult>;
    act(() => {
      p = result.current.share();
    });
    expect(result.current.isPending).toBe(true);
    dispatch('SHARE_LINK_RESULT', {
      requestId: lastShare(postMessageMock).payload.requestId,
      result: { url: URL_42, copied: true, method: 'clipboard' },
    });
    await p;
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('waits the human bound (a share sheet waits on a person), not the 30 s default', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useShareLink());
    let p!: Promise<BlockShareLinkResult>;
    act(() => {
      p = result.current.share();
    });
    let caught: unknown = null;
    p.catch((err: unknown) => {
      caught = err;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HUMAN_INTERACTION_TIMEOUT_MS - 1);
    });
    expect(caught).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(caught).toBeInstanceOf(RequestTimeoutError);
  });
});
