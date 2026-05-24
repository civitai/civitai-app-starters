import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, ParentToBlockMessage } from '@civitai/app-sdk/blocks';

import { IframeTransport } from '../src/internal/iframeTransport.js';
import { sendTypedRequest } from '../src/internal/transport.js';
import { mockParentMessage } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';
const OTHER_ORIGIN = 'https://evil.example.com';

function buildInitPayload(overrides: Partial<BlockInitPayload> = {}): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'my-block',
    appId: 'app_test',
    token: { raw: 'jwt-1', scopes: ['models:read:self'], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 1, username: 'alice', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
    ...overrides,
  };
}

describe('IframeTransport', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  let originalParent: Window;

  beforeEach(() => {
    vi.useFakeTimers();
    postMessageMock = vi.fn();
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'parent', { value: originalParent, configurable: true, writable: true });
  });

  it('throws when constructed with no allowed origins', () => {
    expect(() => new IframeTransport({ allowedParentOrigins: [] })).toThrow(/at least one entry/);
  });

  it('accepts BLOCK_INIT from an allowed origin and exposes a ready snapshot', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();

    const init: ParentToBlockMessage = { type: 'BLOCK_INIT', payload: buildInitPayload() };
    window.dispatchEvent(mockParentMessage(init, PARENT_ORIGIN));

    await initPromise;
    const snap = transport.getSnapshot();
    expect(snap.ready).toBe(true);
    expect(snap.context.modelId).toBe(42);
    expect(snap.token.raw).toBe('jwt-1');
    expect(snap.viewer?.username).toBe('alice');
    transport.dispose();
  });

  it('silently drops BLOCK_INIT from a disallowed origin', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();

    const init: ParentToBlockMessage = { type: 'BLOCK_INIT', payload: buildInitPayload() };
    window.dispatchEvent(mockParentMessage(init, OTHER_ORIGIN));

    // Snapshot stays not-ready because the wrong-origin message was dropped.
    expect(transport.getSnapshot().ready).toBe(false);

    vi.advanceTimersByTime(11_000);
    await expect(initPromise).rejects.toThrow(/timed out waiting for BLOCK_INIT/);
    transport.dispose();
  });

  it('rejects waitForInit after 10s with no BLOCK_INIT', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();
    vi.advanceTimersByTime(10_000);
    await expect(initPromise).rejects.toThrow(/timed out/);
    transport.dispose();
  });

  it('queues outbound messages until init then flushes in order, with auto-BLOCK_READY trailing', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    transport.sendMessage({ type: 'RESIZE_IFRAME', payload: { height: 400 } });
    transport.sendMessage({ type: 'RESIZE_IFRAME', payload: { height: 500 } });
    expect(postMessageMock).not.toHaveBeenCalled();

    window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
    await transport.waitForInit();

    // Queued messages flush in arrival order; the transport's auto-BLOCK_READY
    // follows so the platform's 10s ready timeout doesn't fire on blocks that
    // never explicitly send one.
    expect(postMessageMock).toHaveBeenCalledTimes(3);
    expect(postMessageMock).toHaveBeenNthCalledWith(
      1,
      { type: 'RESIZE_IFRAME', payload: { height: 400 } },
      PARENT_ORIGIN,
    );
    expect(postMessageMock).toHaveBeenNthCalledWith(
      2,
      { type: 'RESIZE_IFRAME', payload: { height: 500 } },
      PARENT_ORIGIN,
    );
    expect(postMessageMock).toHaveBeenNthCalledWith(
      3,
      { type: 'BLOCK_READY', payload: { height: 0 } },
      PARENT_ORIGIN,
    );
    transport.dispose();
  });

  it('correlates request/response by requestId', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
    await transport.waitForInit();
    postMessageMock.mockClear();

    const responsePromise = sendTypedRequest(
      transport,
      { type: 'SUBMIT_WORKFLOW', payload: { body: { prompt: 'cat' } } },
      'WORKFLOW_SUBMITTED',
    );

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };
    expect(typeof sent.payload.requestId).toBe('string');

    const reply: ParentToBlockMessage = {
      type: 'WORKFLOW_SUBMITTED',
      payload: {
        requestId: sent.payload.requestId,
        snapshot: { workflowId: 'wf-1', status: 'pending', cost: { total: 5 } },
      },
    };
    window.dispatchEvent(mockParentMessage(reply, PARENT_ORIGIN));

    const result = await responsePromise;
    expect(result.snapshot.workflowId).toBe('wf-1');
    transport.dispose();
  });

  it('ignores reply messages with the wrong responseType', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
    await transport.waitForInit();
    postMessageMock.mockClear();

    const responsePromise = sendTypedRequest(
      transport,
      { type: 'SUBMIT_WORKFLOW', payload: { body: {} } },
      'WORKFLOW_SUBMITTED',
      { timeoutMs: 500 },
    );

    const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };
    // Reply with the matching requestId but wrong type — should NOT resolve.
    window.dispatchEvent(
      mockParentMessage(
        { type: 'ESTIMATE_RESULT', payload: { requestId: sent.payload.requestId, snapshot: { workflowId: 'x', status: 'pending' } } },
        PARENT_ORIGIN,
      ),
    );
    vi.advanceTimersByTime(600);
    await expect(responsePromise).rejects.toThrow(/timed out/);
    transport.dispose();
  });

  it('applies TOKEN_REFRESH_RESPONSE to the snapshot', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
    await transport.waitForInit();

    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);

    const newExpiry = new Date(Date.now() + 120_000).toISOString();
    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'TOKEN_REFRESH_RESPONSE',
          payload: {
            requestId: 'irrelevant',
            token: { raw: 'jwt-2', scopes: ['models:read:self'], expiresAt: newExpiry },
          },
        },
        PARENT_ORIGIN,
      ),
    );

    const snap = transport.getSnapshot();
    expect(snap.token.raw).toBe('jwt-2');
    expect(snap.token.expiresAt.toISOString()).toBe(newExpiry);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    transport.dispose();
  });

  it('applies host-pushed TOKEN_REFRESH (no requestId) to the snapshot', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
    await transport.waitForInit();

    const newExpiry = new Date(Date.now() + 600_000).toISOString();
    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'TOKEN_REFRESH',
          payload: {
            token: { raw: 'jwt-rotated', scopes: ['models:read:self', 'buzz:read:self'], expiresAt: newExpiry, buzzBudget: 500 },
          },
        },
        PARENT_ORIGIN,
      ),
    );

    const snap = transport.getSnapshot();
    expect(snap.token.raw).toBe('jwt-rotated');
    expect(snap.token.scopes).toEqual(['models:read:self', 'buzz:read:self']);
    expect(snap.token.buzzBudget).toBe(500);
    expect(snap.token.expiresAt.toISOString()).toBe(newExpiry);
    transport.dispose();
  });

  it('auto-sends BLOCK_READY immediately after applying BLOCK_INIT', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
    await transport.waitForInit();
    // BLOCK_READY is the first outbound — the platform's 10s ready timeout
    // depends on this; useBlockResize follows with real measurements.
    expect(postMessageMock).toHaveBeenCalledWith(
      { type: 'BLOCK_READY', payload: { height: 0 } },
      PARENT_ORIGIN,
    );
    transport.dispose();
  });

  describe('trust-boundary payload validation', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('drops a malformed BLOCK_INIT (unparseable expiresAt) instead of producing Invalid Date', async () => {
      const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
      // Bad init: token.expiresAt is gibberish.
      window.dispatchEvent(
        mockParentMessage(
          {
            type: 'BLOCK_INIT',
            payload: buildInitPayload({
              token: { raw: 'jwt', scopes: [], expiresAt: 'tomorrow' },
            }),
          },
          PARENT_ORIGIN,
        ),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('BLOCK_INIT'));
      // Snapshot must still be the empty/pre-init shape — not a half-populated one with Invalid Date.
      expect(transport.getSnapshot().ready).toBe(false);
      // A subsequent well-formed init must still be accepted.
      window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
      await transport.waitForInit();
      expect(transport.getSnapshot().ready).toBe(true);
      transport.dispose();
    });

    it('drops a malformed TOKEN_REFRESH_RESPONSE without clobbering token.raw', async () => {
      const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
      window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
      await transport.waitForInit();
      const before = transport.getSnapshot().token;

      // Missing token wrapper — must not call applyTokenRefresh.
      window.dispatchEvent(
        mockParentMessage(
          { type: 'TOKEN_REFRESH_RESPONSE', payload: { requestId: 'r' } },
          PARENT_ORIGIN,
        ),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TOKEN_REFRESH_RESPONSE'));
      expect(transport.getSnapshot().token.raw).toBe(before.raw);
      transport.dispose();
    });

    it('drops a malformed workflow reply (unknown status) without resolving pending', async () => {
      const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
      window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
      await transport.waitForInit();
      postMessageMock.mockClear();

      const pending = sendTypedRequest(
        transport,
        { type: 'SUBMIT_WORKFLOW', payload: { body: {} } },
        'WORKFLOW_SUBMITTED',
        { timeoutMs: 250 },
      );
      const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };

      // Reply with the matching requestId but a snapshot with an unknown status.
      window.dispatchEvent(
        mockParentMessage(
          {
            type: 'WORKFLOW_SUBMITTED',
            payload: { requestId: sent.payload.requestId, snapshot: { workflowId: 'w', status: 'queued' } },
          },
          PARENT_ORIGIN,
        ),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WORKFLOW_SUBMITTED'));
      vi.advanceTimersByTime(300);
      await expect(pending).rejects.toThrow(/timed out/);
      transport.dispose();
    });
  });
});
