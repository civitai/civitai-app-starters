import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, BlockWildcardPack, BlockWildcardPackErrorCode } from '@civitai/app-sdk/blocks';

import { useWildcardPack, WildcardPackError } from '../src/hooks/useWildcardPack.js';
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

function lastRequest(postMessageMock: ReturnType<typeof vi.fn>): {
  payload: { requestId: string; modelVersionId: number };
} {
  const calls = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_WILDCARD_PACK');
  return calls[calls.length - 1]![0] as { payload: { requestId: string; modelVersionId: number } };
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'WILDCARD_PACK_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

const SAMPLE_PACK: BlockWildcardPack = {
  modelId: 618692,
  modelVersionId: 691639,
  modelName: 'Sample Wildcard Pack',
  versionName: 'v1.0',
  creatorUsername: 'creator',
  lists: { colors: ['red', 'green'] },
  truncated: false,
  truncatedLists: [],
  maturity: { browsingLevel: 1, sfwOnly: true },
};

describe('useWildcardPack', () => {
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

  it('posts GET_WILDCARD_PACK with the modelVersionId and resolves a pack', async () => {
    const { result } = renderHook(() => useWildcardPack(691639));

    expect(result.current.loading).toBe(true);
    const sent = lastRequest(postMessageMock);
    expect(sent.payload.modelVersionId).toBe(691639);
    expect(typeof sent.payload.requestId).toBe('string');
    const raw = postMessageMock.mock.calls.find((c) => c[0]?.type === 'GET_WILDCARD_PACK');
    expect(raw![1]).toBe(PARENT_ORIGIN);

    dispatchResult({ requestId: sent.payload.requestId, pack: SAMPLE_PACK });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.pack).toEqual(SAMPLE_PACK);
  });

  const codes: BlockWildcardPackErrorCode[] = [
    'not-found',
    'forbidden',
    'too-large',
    'parse-failed',
    'busy',
  ];

  it.each(codes)('surfaces the discriminated `%s` error as a WildcardPackError.code', async (code) => {
    const { result } = renderHook(() => useWildcardPack(691639));
    dispatchResult({ requestId: lastRequest(postMessageMock).payload.requestId, error: code });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(WildcardPackError);
    expect((result.current.error as WildcardPackError).code).toBe(code);
    expect(result.current.error?.message).toBe(code);
    expect(result.current.pack).toBeNull();
  });

  it('does not fetch for a non-positive modelVersionId (no outbound, not loading)', async () => {
    const { result } = renderHook(() => useWildcardPack(0));
    expect(postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_WILDCARD_PACK')).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.pack).toBeNull();
  });

  it('ignores a response whose requestId does not match', async () => {
    const { result } = renderHook(() => useWildcardPack(691639));
    const realId = lastRequest(postMessageMock).payload.requestId;

    dispatchResult({ requestId: 'other', pack: SAMPLE_PACK });
    await Promise.resolve();
    expect(result.current.loading).toBe(true);

    dispatchResult({ requestId: realId, pack: SAMPLE_PACK });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pack).toEqual(SAMPLE_PACK);
  });

  it('refetch() re-requests (e.g. to retry a `busy` result)', async () => {
    const { result } = renderHook(() => useWildcardPack(691639));
    dispatchResult({ requestId: lastRequest(postMessageMock).payload.requestId, error: 'busy' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.error as WildcardPackError).code).toBe('busy');

    const before = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_WILDCARD_PACK').length;
    act(() => result.current.refetch());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    const after = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_WILDCARD_PACK').length;
    expect(after).toBe(before + 1);

    dispatchResult({ requestId: lastRequest(postMessageMock).payload.requestId, pack: SAMPLE_PACK });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pack).toEqual(SAMPLE_PACK);
  });
});
