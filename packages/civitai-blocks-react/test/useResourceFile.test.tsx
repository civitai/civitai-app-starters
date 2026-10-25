import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BlockInitPayload,
  BlockResourceFile,
  BlockResourceFileErrorCode,
} from '@civitai/app-sdk/blocks';

import { ResourceFileError, useResourceFile } from '../src/hooks/useResourceFile.js';
import { RequestTimeoutError } from '../src/transport/transport.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useResourceFile` over the `GET_RESOURCE_FILE` → `RESOURCE_FILE_RESULT`
 * bridge (civitai/civitai-app-starters#664, phase 2), driven through the real
 * transport with a stubbed `window.parent`.
 */

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

type SentPayload = { requestId: string; modelVersionId: number; fileId?: number };

function requests(postMessageMock: ReturnType<typeof vi.fn>): SentPayload[] {
  return postMessageMock.mock.calls
    .filter((c) => c[0]?.type === 'GET_RESOURCE_FILE')
    .map((c) => (c[0] as { payload: SentPayload }).payload);
}

function lastRequest(postMessageMock: ReturnType<typeof vi.fn>): SentPayload {
  const all = requests(postMessageMock);
  return all[all.length - 1]!;
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'RESOURCE_FILE_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

const SAMPLE_FILE: BlockResourceFile = {
  meta: {
    modelId: 4101,
    modelVersionId: 5202,
    fileId: 6303,
    fileName: 'portrait-workflow.json',
    modelName: 'Portrait workflow',
    versionName: 'v3',
    creatorUsername: 'maker',
  },
  entries: [
    {
      path: 'portrait-workflow.json',
      format: 'api',
      graph: { '3': { class_type: 'KSampler', inputs: { seed: 1 } } },
    },
  ],
  truncated: false,
};

describe('useResourceFile', () => {
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
    vi.useRealTimers();
  });

  it('happy path: posts GET_RESOURCE_FILE with the modelVersionId and resolves the file', async () => {
    const { result } = renderHook(() => useResourceFile(5202));

    expect(result.current.loading).toBe(true);
    const sent = lastRequest(postMessageMock);
    expect(sent.modelVersionId).toBe(5202);
    expect(typeof sent.requestId).toBe('string');
    // No `fileId` key at all when the caller gave none: the host picks the file.
    expect('fileId' in sent).toBe(false);
    const raw = postMessageMock.mock.calls.find((c) => c[0]?.type === 'GET_RESOURCE_FILE');
    expect(raw![1]).toBe(PARENT_ORIGIN);

    dispatchResult({ requestId: sent.requestId, file: SAMPLE_FILE });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.file).toEqual(SAMPLE_FILE);
  });

  it('forwards a fileId when one is given', async () => {
    renderHook(() => useResourceFile(5202, 6303));
    const sent = lastRequest(postMessageMock);
    expect(sent.modelVersionId).toBe(5202);
    expect(sent.fileId).toBe(6303);
  });

  const codes: BlockResourceFileErrorCode[] = [
    'not-found',
    'forbidden',
    'unauthorized',
    'too-large',
    'parse-failed',
    'busy',
    'rate-limited',
  ];

  it.each(codes)('error path: surfaces `%s` as a ResourceFileError.code', async (code) => {
    const { result } = renderHook(() => useResourceFile(5202));
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, error: code });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(ResourceFileError);
    expect((result.current.error as ResourceFileError).code).toBe(code);
    expect(result.current.error?.message).toBe(code);
    expect(result.current.file).toBeNull();
  });

  it('timeout: waits 120 s, not the 30 s protocol default, then surfaces a RequestTimeoutError', async () => {
    // The host's signed-URL fetch alone may take 30 s, before the resolve and the
    // unzip/parse; at the default bound a valid reply for a large file on a slow
    // connection would land after the block gave up. 120 s is a LITERAL here, not
    // read from the constant under test.
    vi.useFakeTimers();
    const { result } = renderHook(() => useResourceFile(5202));
    expect(requests(postMessageMock)).toHaveLength(1);
    expect(result.current.loading).toBe(true);

    // Past the 30 s default: still waiting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    // Still waiting just short of 120 s; the host stays silent throughout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(88_000); // t = 119 s
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000); // t = 121 s
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(RequestTimeoutError);
    expect((result.current.error as RequestTimeoutError).requestType).toBe('GET_RESOURCE_FILE');
    expect((result.current.error as RequestTimeoutError).timeoutMs).toBe(120_000);
    expect(result.current.file).toBeNull();
  });

  it('timeout: a valid reply after 100 s is still delivered', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useResourceFile(5202));
    const sent = lastRequest(postMessageMock);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    dispatchResult({ requestId: sent.requestId, file: SAMPLE_FILE });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.file).toEqual(SAMPLE_FILE);
  });

  it('timeout: a reply with an unknown error code is DROPPED, so the request times out', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useResourceFile(5202));
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, error: 'kaboom' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RESOURCE_FILE_RESULT'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(121_000);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(RequestTimeoutError);
    expect(result.current.error).not.toBeInstanceOf(ResourceFileError);
  });

  it.each([
    ['a zero modelVersionId', 0, undefined],
    ['a negative modelVersionId', -4, undefined],
    ['a fractional modelVersionId', 1.5, undefined],
    ['a zero fileId', 5202, 0],
    ['a fractional fileId', 5202, 2.5],
  ])('does not fetch for %s (no outbound, not loading)', (_label, versionId, fileId) => {
    const { result } = renderHook(() => useResourceFile(versionId, fileId));
    expect(requests(postMessageMock)).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.file).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('ignores a response whose requestId does not match', async () => {
    const { result } = renderHook(() => useResourceFile(5202));
    const realId = lastRequest(postMessageMock).requestId;

    dispatchResult({ requestId: 'other', file: SAMPLE_FILE });
    await Promise.resolve();
    expect(result.current.loading).toBe(true);

    dispatchResult({ requestId: realId, file: SAMPLE_FILE });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.file).toEqual(SAMPLE_FILE);
  });

  it('switching versions clears the previous file: A succeeds, B errors, `file` is null', async () => {
    const { result, rerender } = renderHook(({ id }: { id: number }) => useResourceFile(id), {
      initialProps: { id: 5202 },
    });
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, file: SAMPLE_FILE });
    await waitFor(() => expect(result.current.file).toEqual(SAMPLE_FILE));

    rerender({ id: 9909 });
    // Cleared at once, not only when B settles: A's graphs never show for B.
    expect(result.current.file).toBeNull();
    expect(result.current.loading).toBe(true);

    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, error: 'not-found' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.error as ResourceFileError).code).toBe('not-found');
    expect(result.current.file).toBeNull();
  });

  it('switching fileId clears the previous file too', async () => {
    const { result, rerender } = renderHook(
      ({ fileId }: { fileId?: number }) => useResourceFile(5202, fileId),
      { initialProps: { fileId: 6303 as number | undefined } },
    );
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, file: SAMPLE_FILE });
    await waitFor(() => expect(result.current.file).toEqual(SAMPLE_FILE));

    rerender({ fileId: 6304 });
    expect(result.current.file).toBeNull();
  });

  it('switching to an INVALID id clears the previous file and error', async () => {
    const { result, rerender } = renderHook(({ id }: { id: number }) => useResourceFile(id), {
      initialProps: { id: 5202 },
    });
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, file: SAMPLE_FILE });
    await waitFor(() => expect(result.current.file).toEqual(SAMPLE_FILE));
    rerender({ id: 0 });
    expect(result.current.file).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    // And a stale error does not survive a switch to an invalid id either.
    rerender({ id: 5203 });
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, error: 'busy' });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ResourceFileError));
    rerender({ id: -1 });
    expect(result.current.error).toBeNull();
    expect(result.current.file).toBeNull();
  });

  it('refetch() on the SAME key keeps the current file while it reloads', async () => {
    const { result } = renderHook(() => useResourceFile(5202));
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, file: SAMPLE_FILE });
    await waitFor(() => expect(result.current.file).toEqual(SAMPLE_FILE));
    act(() => result.current.refetch());
    expect(result.current.loading).toBe(true);
    expect(result.current.file).toEqual(SAMPLE_FILE);
  });

  it('refetches when the fileId changes', async () => {
    const { rerender } = renderHook(({ fileId }: { fileId?: number }) => useResourceFile(5202, fileId), {
      initialProps: { fileId: undefined },
    });
    expect(requests(postMessageMock)).toHaveLength(1);
    rerender({ fileId: 6303 });
    expect(requests(postMessageMock)).toHaveLength(2);
    expect(lastRequest(postMessageMock).fileId).toBe(6303);
  });

  it('refetch() re-requests (e.g. to retry a `busy` result)', async () => {
    const { result } = renderHook(() => useResourceFile(5202));
    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, error: 'busy' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.error as ResourceFileError).code).toBe('busy');

    const before = requests(postMessageMock).length;
    act(() => result.current.refetch());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(requests(postMessageMock).length).toBe(before + 1);

    dispatchResult({ requestId: lastRequest(postMessageMock).requestId, file: SAMPLE_FILE });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.file).toEqual(SAMPLE_FILE);
  });
});
