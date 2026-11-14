import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, BlockPersistedGenerationSource } from '@civitai/app-sdk/blocks';

import { usePersistGenerationSource } from '../src/hooks/usePersistGenerationSource.js';
import { getTransport } from '../src/transport/singleton.js';
import { RequestTimeoutError } from '../src/transport/transport.js';
import { resetTransport } from '../src/testing.js';

/**
 * `usePersistGenerationSource()` — the block half of PERSIST_GENERATION_SOURCE →
 * GENERATION_SOURCE_PERSISTED (HQ task app_blocks_sdk_x7dw).
 *
 * Every expected value is a LITERAL from the decided contract. Fixture fields
 * are pairwise distinct (width ≠ height ≠ imageId, `ready: false` in one case
 * and `true` in another) so a hook that swaps, hardcodes or drops a field
 * cannot pass.
 */

const PARENT_ORIGIN = 'https://civitai.com';

/** The timeout the hook must use: 45 s, the host's ~30 s scan wait plus room. */
const EXPECTED_TIMEOUT_MS = 45_000;
/** The transport's default, which the host's own scan wait would exhaust. */
const DEFAULT_TIMEOUT_MS = 30_000;

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: ['ai:write:budgeted'], expiresAt: new Date(Date.now() + 600_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

type SentPersist = { payload: { requestId: string; workflowId: string; imageIndex: number } };

function calls(mock: ReturnType<typeof vi.fn>, type: string) {
  return mock.mock.calls.filter((c) => c[0]?.type === type);
}
function lastPersist(mock: ReturnType<typeof vi.fn>): SentPersist {
  const c = calls(mock, 'PERSIST_GENERATION_SOURCE');
  return c[c.length - 1]![0] as SentPersist;
}
function dispatch(type: string, payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  });
}

describe('usePersistGenerationSource', () => {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends exactly { requestId, workflowId, imageIndex } — no url — to the parent origin', () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    act(() => {
      void result.current.persist({ workflowId: 'wf_app_3', imageIndex: 2 }).catch(() => {});
    });

    const all = calls(postMessageMock, 'PERSIST_GENERATION_SOURCE');
    expect(all).toHaveLength(1);
    const [msg, target] = all[0]!;
    expect(target).toBe(PARENT_ORIGIN);
    const sent = msg as SentPersist & { type: string };
    expect(typeof sent.payload.requestId).toBe('string');
    expect(sent.payload.requestId.length).toBeGreaterThan(0);
    // EXACT payload: the three contract fields and nothing else.
    expect(sent).toEqual({
      type: 'PERSIST_GENERATION_SOURCE',
      payload: { requestId: sent.payload.requestId, workflowId: 'wf_app_3', imageIndex: 2 },
    });
    expect(JSON.stringify(sent.payload)).not.toContain('http');
  });

  it('sends imageIndex 0 as 0 (not dropped as falsy)', () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    act(() => {
      void result.current.persist({ workflowId: 'wf_app_1', imageIndex: 0 }).catch(() => {});
    });
    expect(lastPersist(postMessageMock).payload).toMatchObject({ workflowId: 'wf_app_1', imageIndex: 0 });
  });

  it('resolves with the host result { url, width, height, imageId, ready }', async () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    let p!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      p = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 1 });
    });
    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      result: {
        url: 'https://image.civitai.com/x/original=true/a.jpeg',
        width: 832,
        height: 1216,
        imageId: 7301,
        ready: false,
      },
    });
    await expect(p).resolves.toEqual({
      url: 'https://image.civitai.com/x/original=true/a.jpeg',
      width: 832,
      height: 1216,
      imageId: 7301,
      ready: false,
    });
  });

  it('resolves `ready: true` as true (the field is read, not hardcoded)', async () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    let p!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      p = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
    });
    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      result: { url: 'https://image.civitai.com/x/b.jpeg', width: 640, height: 960, imageId: 7302, ready: true },
    });
    await expect(p).resolves.toMatchObject({ imageId: 7302, ready: true });
  });

  it('rejects with the host error string, and exposes it as `error`', async () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    let p!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      p = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
      p.catch(() => {});
    });
    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      error: 'not supported on this host',
    });
    await expect(p).rejects.toThrow(/^not supported on this host$/);
    await waitFor(() => expect(result.current.error?.message).toBe('not supported on this host'));
  });

  it('rejects with readable copy when the host error is an EMPTY string', async () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    let p!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      p = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
      p.catch(() => {});
    });
    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      error: '',
    });
    await expect(p).rejects.toThrow(/^failed to persist the generation source$/);
  });

  // A malformed reply must REJECT promptly — never resolve with unchecked
  // fields, and never be dropped (which would leave persist() hanging for 45 s).
  // Fake timers make "promptly" checkable: the rejection must land with the
  // clock advanced by 0 ms, so a dropped reply that later times out fails here.
  it.each([
    ['neither result nor error', {}],
    ['result is not an object', { result: 'nope' }],
    ['result.url missing', { result: { width: 512, height: 768, imageId: 7303, ready: true } }],
    ['result.url empty', { result: { url: '', width: 512, height: 768, imageId: 7303, ready: true } }],
    ['result.width not a number', { result: { url: 'https://image.civitai.com/c.jpeg', width: '512', height: 768, imageId: 7303, ready: true } }],
    ['result.height zero', { result: { url: 'https://image.civitai.com/c.jpeg', width: 512, height: 0, imageId: 7303, ready: true } }],
    ['result.imageId missing', { result: { url: 'https://image.civitai.com/c.jpeg', width: 512, height: 768, ready: true } }],
    ['result.ready not a boolean', { result: { url: 'https://image.civitai.com/c.jpeg', width: 512, height: 768, imageId: 7303, ready: 'yes' } }],
    ['error is not a string', { error: 42 }],
  ])('rejects (does not hang) on a malformed reply: %s', async (_label, fields) => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => usePersistGenerationSource());
    let p!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      p = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
    });
    let settled: { ok: true } | { ok: false; err: unknown } | null = null;
    p.then(
      () => (settled = { ok: true }),
      (err: unknown) => (settled = { ok: false, err }),
    );
    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      ...fields,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(settled).not.toBeNull();
    const s = settled as unknown as { ok: boolean; err?: unknown };
    expect(s.ok).toBe(false);
    expect(s.err).not.toBeInstanceOf(RequestTimeoutError);
    expect((s.err as Error).message).toBe('the host sent a malformed reply to PERSIST_GENERATION_SOURCE');
    warn.mockRestore();
  });

  it('toggles isPending: false → true while in flight → false after the reply; clears `error` on the next call', async () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();

    // First call fails, leaving `error` set.
    let first!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      first = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
      first.catch(() => {});
    });
    expect(result.current.isPending).toBe(true);
    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      error: 'workflow not owned',
    });
    await expect(first).rejects.toThrow('workflow not owned');
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.error?.message).toBe('workflow not owned');

    // Second call: pending again, `error` cleared at the start.
    let second!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      second = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 1 });
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.error).toBeNull();
    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      result: { url: 'https://image.civitai.com/d.jpeg', width: 512, height: 768, imageId: 7304, ready: true },
    });
    await expect(second).resolves.toMatchObject({ imageId: 7304 });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('keeps isPending true until EVERY concurrent persist has settled', async () => {
    const { result } = renderHook(() => usePersistGenerationSource());
    let a!: Promise<BlockPersistedGenerationSource>;
    let b!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      a = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
    });
    const idA = lastPersist(postMessageMock).payload.requestId;
    act(() => {
      b = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 1 });
    });
    const idB = lastPersist(postMessageMock).payload.requestId;
    expect(idA).not.toBe(idB);

    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: idA,
      result: { url: 'https://image.civitai.com/e.jpeg', width: 512, height: 768, imageId: 7305, ready: true },
    });
    await expect(a).resolves.toMatchObject({ imageId: 7305 });
    expect(result.current.isPending).toBe(true);

    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: idB,
      result: { url: 'https://image.civitai.com/f.jpeg', width: 512, height: 768, imageId: 7306, ready: true },
    });
    await expect(b).resolves.toMatchObject({ imageId: 7306 });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('survives the 30 s default (the host waits ~30 s for the scan) and resolves a late reply', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePersistGenerationSource());
    let p!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      p = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
    });
    let settled = false;
    p.then(
      () => (settled = true),
      () => (settled = true),
    );
    // Past the default, short of the persist bound.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 5_000);
    });
    expect(settled).toBe(false);

    dispatch('GENERATION_SOURCE_PERSISTED', {
      requestId: lastPersist(postMessageMock).payload.requestId,
      result: { url: 'https://image.civitai.com/g.jpeg', width: 512, height: 768, imageId: 7307, ready: false },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await expect(p).resolves.toMatchObject({ imageId: 7307, ready: false });
  });

  it('rejects with a RequestTimeoutError at 45 s when the host never answers', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePersistGenerationSource());
    let p!: Promise<BlockPersistedGenerationSource>;
    act(() => {
      p = result.current.persist({ workflowId: 'wf_app_3', imageIndex: 0 });
    });
    let caught: unknown = null;
    p.catch((err: unknown) => {
      caught = err;
    });

    // Just before the bound: still pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPECTED_TIMEOUT_MS - 1);
    });
    expect(caught).toBeNull();
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(caught).toBeInstanceOf(RequestTimeoutError);
    expect((caught as RequestTimeoutError).requestType).toBe('PERSIST_GENERATION_SOURCE');
    expect((caught as RequestTimeoutError).timeoutMs).toBe(EXPECTED_TIMEOUT_MS);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBe(caught);
  });
});
