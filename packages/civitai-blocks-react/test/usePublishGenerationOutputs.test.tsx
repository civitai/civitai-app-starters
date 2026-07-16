import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { usePublishGenerationOutputs } from '../src/hooks/usePublishGenerationOutputs.js';
import { getTransport } from '../src/internal/singleton.js';
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

function calls(mock: ReturnType<typeof vi.fn>, type: string) {
  return mock.mock.calls.filter((c) => c[0]?.type === type);
}
function lastPublish(
  mock: ReturnType<typeof vi.fn>,
): { payload: { requestId: string; workflowId: string; imageIndexes?: number[]; title?: string } } {
  const c = calls(mock, 'PUBLISH_GENERATION_OUTPUTS');
  return c[c.length - 1]![0] as {
    payload: { requestId: string; workflowId: string; imageIndexes?: number[]; title?: string };
  };
}
function dispatch(type: string, payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  });
}

describe('usePublishGenerationOutputs', () => {
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

  it('publish() forwards workflowId + imageIndexes (NO urls) and resolves the canned imageIds', async () => {
    const { result } = renderHook(() => usePublishGenerationOutputs());

    let resolved: number[] | null = null;
    act(() => {
      void result.current.publish({ workflowId: 'wf_app_2', imageIndexes: [0, 2], title: 'Round 3' }).then((v) => {
        resolved = v;
      });
    });

    const sent = lastPublish(postMessageMock);
    expect(typeof sent.payload.requestId).toBe('string');
    expect(sent.payload.workflowId).toBe('wf_app_2');
    expect(sent.payload.imageIndexes).toEqual([0, 2]);
    expect(sent.payload.title).toBe('Round 3');
    // The block NEVER sends urls — the host resolves them server-side.
    expect(JSON.stringify(sent.payload)).not.toContain('http');
    expect(sent.payload).not.toHaveProperty('url');
    expect(sent.payload).not.toHaveProperty('urls');
    // Outbound targeted the allowlisted parent origin.
    expect(calls(postMessageMock, 'PUBLISH_GENERATION_OUTPUTS')[0]![1]).toBe(PARENT_ORIGIN);

    dispatch('PUBLISH_RESULT', { requestId: sent.payload.requestId, result: { imageIds: [9001, 9002] } });

    await waitFor(() => expect(resolved).not.toBeNull());
    expect(resolved).toEqual([9001, 9002]);
  });

  it('omits imageIndexes + title from the outbound payload when not supplied', async () => {
    const { result } = renderHook(() => usePublishGenerationOutputs());
    act(() => {
      void result.current.publish({ workflowId: 'wf_app_1' }).catch(() => {});
    });
    const sent = lastPublish(postMessageMock);
    expect(sent.payload.workflowId).toBe('wf_app_1');
    expect(sent.payload).not.toHaveProperty('imageIndexes');
    expect(sent.payload).not.toHaveProperty('title');
  });

  it('rejects with the host FREE-TEXT error string (error, no result)', async () => {
    const { result } = renderHook(() => usePublishGenerationOutputs());

    let caught: Error | null = null;
    act(() => {
      void result.current.publish({ workflowId: 'wf_app_2' }).catch((e: Error) => (caught = e));
    });
    const sent = lastPublish(postMessageMock);
    dispatch('PUBLISH_RESULT', { requestId: sent.payload.requestId, error: 'block lacks ai:write:budgeted scope' });

    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('block lacks ai:write:budgeted scope');
  });
});
