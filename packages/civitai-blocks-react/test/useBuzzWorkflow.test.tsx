import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
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
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useBuzzWorkflow', () => {
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
  });

  it('starts idle with no result', () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('estimate() sends ESTIMATE_WORKFLOW and transitions idle→estimating→confirming', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let estimatePromise!: Promise<unknown>;
    act(() => {
      estimatePromise = result.current.estimate({ prompt: 'cat' });
    });
    expect(result.current.status).toBe('estimating');

    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { requestId: string; body: unknown } };
    expect(sent.type).toBe('ESTIMATE_WORKFLOW');
    expect(sent.payload.body).toEqual({ prompt: 'cat' });

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'ESTIMATE_RESULT',
            payload: {
              requestId: sent.payload.requestId,
              snapshot: { workflowId: 'est-1', status: 'pending', cost: { total: 5 } },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await estimatePromise;
    await waitFor(() => expect(result.current.status).toBe('confirming'));
    expect(result.current.result?.cost?.total).toBe(5);
  });

  it('submit() sends SUBMIT_WORKFLOW and transitions to polling for in-flight workflows', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let submitPromise!: Promise<unknown>;
    act(() => {
      submitPromise = result.current.submit({ prompt: 'cat' });
    });
    expect(result.current.status).toBe('submitting');

    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { requestId: string } };
    expect(sent.type).toBe('SUBMIT_WORKFLOW');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'WORKFLOW_SUBMITTED',
            payload: {
              requestId: sent.payload.requestId,
              snapshot: { workflowId: 'wf-1', status: 'processing' },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await submitPromise;
    await waitFor(() => expect(result.current.status).toBe('polling'));
    expect(result.current.result?.workflowId).toBe('wf-1');
  });

  it('poll() to a terminal status transitions to done', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let pollPromise!: Promise<unknown>;
    act(() => {
      pollPromise = result.current.poll('wf-1');
    });
    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { requestId: string; workflowId: string } };
    expect(sent.type).toBe('POLL_WORKFLOW');
    expect(sent.payload.workflowId).toBe('wf-1');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'WORKFLOW_STATUS',
            payload: {
              requestId: sent.payload.requestId,
              snapshot: { workflowId: 'wf-1', status: 'succeeded', imageUrls: ['https://cdn/x.png'] },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await pollPromise;
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result?.imageUrls).toEqual(['https://cdn/x.png']);
  });
});
