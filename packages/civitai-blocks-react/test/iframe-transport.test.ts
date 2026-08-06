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

  it('accepts BLOCK_INIT when viewer omits status (#2521 privacy minimization)', async () => {
    // The platform omits the viewer's coarse ban/mute `status` from BLOCK_INIT
    // for privacy (civitai #2521). A signed-in viewer WITHOUT `status` must still
    // validate + init. Regression: it used to drop as "malformed", which left
    // every signed-in viewer's block blank once BLOCK_INIT actually arrived.
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();
    window.dispatchEvent(
      mockParentMessage(
        { type: 'BLOCK_INIT', payload: buildInitPayload({ viewer: { id: 7, username: 'mod' } }) },
        PARENT_ORIGIN,
      ),
    );
    await initPromise;
    expect(transport.getSnapshot().ready).toBe(true);
    expect(transport.getSnapshot().viewer?.id).toBe(7);
    expect(transport.getSnapshot().viewer?.status).toBeUndefined();
    transport.dispose();
  });

  it('still drops BLOCK_INIT with a present-but-invalid viewer.status', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();
    window.dispatchEvent(
      mockParentMessage(
        { type: 'BLOCK_INIT', payload: buildInitPayload({ viewer: { id: 7, username: 'mod', status: 'bogus' as never } }) },
        PARENT_ORIGIN,
      ),
    );
    expect(transport.getSnapshot().ready).toBe(false);
    vi.advanceTimersByTime(11_000);
    await expect(initPromise).rejects.toThrow(/timed out/);
    warnSpy.mockRestore();
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

  it('drops a well-formed IMAGE_SCAN_RESOLVED push from a disallowed origin (async-scan invariant #4)', async () => {
    // Locks the origin gate for UNSOLICITED parent→block pushes: a byte-perfect,
    // payload-valid IMAGE_SCAN_RESOLVED that happens to come from the wrong origin
    // must be dropped BEFORE it reaches an onMessage handler — otherwise a
    // cross-origin page could forge a "scanned" verdict for a block. Guards
    // against a future reorder that dispatches the push ahead of the origin check.
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();
    window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
    await initPromise;

    const received: unknown[] = [];
    const off = transport.onMessage('IMAGE_SCAN_RESOLVED', (payload) => received.push(payload));

    const scanPush: ParentToBlockMessage = {
      type: 'IMAGE_SCAN_RESOLVED',
      payload: {
        requestId: 'req-1',
        imageId: 123,
        result: {
          status: 'scanned',
          image: { imageId: 123, nsfwLevel: 1, contentRating: 'pg', url: 'https://image.civitai.com/x' },
        },
      },
    };

    // Disallowed origin → dropped at the allowlist gate, handler never fires
    // (a consumer's scanStatus() would stay pending, not resolve to "scanned").
    window.dispatchEvent(mockParentMessage(scanPush, OTHER_ORIGIN));
    expect(received).toEqual([]);

    // Positive control: the identical push from the ALLOWED origin IS delivered.
    window.dispatchEvent(mockParentMessage(scanPush, PARENT_ORIGIN));
    expect(received).toEqual([scanPush.payload]);

    off();
    transport.dispose();
  });

  it('accepts BLOCK_INIT from a wildcard-matched preview subdomain', async () => {
    const transport = new IframeTransport({
      allowedParentOrigins: ['https://civitai.com', 'https://*.civitaic.com'],
    });
    const initPromise = transport.waitForInit();

    const init: ParentToBlockMessage = { type: 'BLOCK_INIT', payload: buildInitPayload() };
    window.dispatchEvent(mockParentMessage(init, 'https://pr-2319.civitaic.com'));

    await initPromise;
    expect(transport.getSnapshot().ready).toBe(true);
    transport.dispose();
  });

  describe('getHostOrigin (validated host origin — token-exfiltration guard)', () => {
    it('returns null before BLOCK_INIT lands', () => {
      const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
      expect(transport.getHostOrigin()).toBeNull();
      transport.dispose();
    });

    it('returns exactly the allowlisted origin after a valid BLOCK_INIT', async () => {
      const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
      window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
      await transport.waitForInit();
      // Exactly the sender's origin — this is the base URL the money-scoped
      // block token is later sent to.
      expect(transport.getHostOrigin()).toBe(PARENT_ORIGIN);
      transport.dispose();
    });

    it('returns the wildcard-matched preview subdomain that actually sent BLOCK_INIT', async () => {
      const transport = new IframeTransport({
        allowedParentOrigins: ['https://civitai.com', 'https://*.civitaic.com'],
      });
      window.dispatchEvent(
        mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, 'https://pr-2319.civitaic.com'),
      );
      await transport.waitForInit();
      expect(transport.getHostOrigin()).toBe('https://pr-2319.civitaic.com');
      transport.dispose();
    });

    it('SECURITY: a BLOCK_INIT from a NON-allowlisted origin never sets the host origin', async () => {
      // The whole point: getHostOrigin() must only ever be an allowlist-validated
      // origin. A spoofed init from evil.example.com is dropped at the origin gate,
      // so the host origin stays null — the block would never send its bearer
      // token to the attacker's origin.
      const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
      window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, OTHER_ORIGIN));

      // Never captured the bad origin.
      expect(transport.getHostOrigin()).toBeNull();

      // And a subsequent LEGITIMATE init still sets it to the good origin only.
      window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
      await transport.waitForInit();
      expect(transport.getHostOrigin()).toBe(PARENT_ORIGIN);
      transport.dispose();
    });

    it('freezes the host origin to the FIRST init sender (dedupe contract)', async () => {
      // A retry tick from a different (still-allowlisted) origin must not move it.
      const transport = new IframeTransport({
        allowedParentOrigins: ['https://civitai.com', 'https://*.civitaic.com'],
      });
      window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN));
      await transport.waitForInit();
      expect(transport.getHostOrigin()).toBe(PARENT_ORIGIN);

      window.dispatchEvent(
        mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, 'https://pr-9.civitaic.com'),
      );
      // Frozen to the first sender — the repeat init is a no-op.
      expect(transport.getHostOrigin()).toBe(PARENT_ORIGIN);
      transport.dispose();
    });
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
    // The ONLY thing that may leave the frame before BLOCK_INIT is the
    // contentless `BLOCK_HELLO` announce posted by the constructor. Assert that
    // exactly, rather than "nothing was sent": the property under test is that
    // the outbound QUEUE is not flushed early, and stating it as a filter keeps
    // the test able to catch a real early flush.
    expect(postMessageMock.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual([
      'BLOCK_HELLO',
    ]);
    postMessageMock.mockClear();

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

  it('dedupes repeated BLOCK_INIT (host retry-until-ready contract)', async () => {
    // The civitai host (IframeHost.tsx) re-sends BLOCK_INIT on a ~400ms interval
    // until it sees BLOCK_READY, to defeat the cross-origin iframe onLoad race
    // (civitai PR #2546). That design is ONLY safe because the transport dedupes:
    // every BLOCK_INIT after the first MUST be a no-op. This pins that contract.
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const listener = vi.fn();
    transport.subscribe(listener);

    // First (authoritative) init.
    window.dispatchEvent(
      mockParentMessage(
        { type: 'BLOCK_INIT', payload: buildInitPayload({ context: { slotId: 'model.sidebar_top', modelId: 42 } }) },
        PARENT_ORIGIN,
      ),
    );
    await transport.waitForInit();
    const emitsAfterFirst = listener.mock.calls.length;
    const readyAfterFirst = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'BLOCK_READY').length;
    expect(readyAfterFirst).toBe(1);

    // A second BLOCK_INIT (a retry tick) with DIFFERENT content. Must be ignored:
    // no snapshot change, no extra BLOCK_READY, no re-emit to subscribers.
    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'BLOCK_INIT',
          payload: buildInitPayload({
            context: { slotId: 'model.sidebar_top', modelId: 999 },
            token: { raw: 'jwt-OTHER', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
          }),
        },
        PARENT_ORIGIN,
      ),
    );

    const snap = transport.getSnapshot();
    expect(snap.context.modelId).toBe(42); // unchanged — repeat init ignored
    expect(snap.token.raw).toBe('jwt-1'); // unchanged
    expect(postMessageMock.mock.calls.filter((c) => c[0]?.type === 'BLOCK_READY').length).toBe(1); // no second READY
    expect(listener.mock.calls.length).toBe(emitsAfterFirst); // no additional emit
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

describe('IframeTransport THEME_CHANGE (host-pushed live theme)', () => {
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

  // DELIBERATELY 'dark', not the 'light' of `EMPTY_SNAPSHOT.theme`. With a
  // 'light' fixture the "dropped" assertions below (`expect(theme).toBe(...)`)
  // are byte-identical to the never-initialised sentinel, so they cannot tell a
  // correctly-dropped message from a transport that never applied BLOCK_INIT at
  // all. Starting off-sentinel makes every drop assertion structurally strict.
  function initTransport(context?: BlockInitPayload['context']) {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'BLOCK_INIT',
          payload: buildInitPayload({ theme: 'dark', ...(context ? { context } : {}) }),
        },
        PARENT_ORIGIN,
      ),
    );
    return transport;
  }

  it('applies a host-pushed THEME_CHANGE to the snapshot and notifies subscribers', async () => {
    const transport = initTransport();
    await transport.waitForInit();
    expect(transport.getSnapshot().theme).toBe('dark');

    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);
    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'light' } }, PARENT_ORIGIN),
    );

    expect(transport.getSnapshot().theme).toBe('light');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    transport.dispose();
  });

  it('touches NOTHING but theme (token/viewer/context/ready are untouched)', async () => {
    const transport = initTransport();
    await transport.waitForInit();
    const before = transport.getSnapshot();

    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'light' } }, PARENT_ORIGIN),
    );

    const after = transport.getSnapshot();
    expect(after.theme).toBe('light');
    expect(after.ready).toBe(true);
    expect(after.token).toBe(before.token);
    expect(after.viewer).toBe(before.viewer);
    // This fixture's context carries NO `theme` key, so it must come through
    // BY IDENTITY — the push must never INTRODUCE the field (see the
    // context-mirroring tests below for the case where it IS present).
    expect(after.context).toBe(before.context);
    expect('theme' in after.context).toBe(false);
    expect(after.blockInstanceId).toBe(before.blockInstanceId);
    transport.dispose();
  });

  it('MIRRORS the new theme into context.theme when the host sent that field', async () => {
    // The host forwards theme twice — top-level and inside BLOCK_INIT.context
    // (`theme` is on its context allowlist; `ModelSlotContext.theme` is a
    // documented, exported SDK field). Both readers must move together, or a
    // block reading `context.theme` silently stays on the mount-time value.
    const transport = initTransport({ slotId: 'model.sidebar_top', modelId: 42, theme: 'dark' });
    await transport.waitForInit();
    expect(transport.getSnapshot().context.theme).toBe('dark');

    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'light' } }, PARENT_ORIGIN),
    );

    const after = transport.getSnapshot();
    expect(after.theme).toBe('light');
    expect(after.context.theme).toBe('light');
    // Every OTHER context field survives untouched.
    expect(after.context.slotId).toBe('model.sidebar_top');
    expect(after.context.modelId).toBe(42);
    transport.dispose();
  });

  it('does NOT re-emit on a redundant push of the same theme', async () => {
    const transport = initTransport();
    await transport.waitForInit();
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);

    // Same value as the snapshot already holds → no snapshot identity change,
    // so no useSyncExternalStore re-render.
    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'dark' } }, PARENT_ORIGIN),
    );
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'light' } }, PARENT_ORIGIN),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    transport.dispose();
  });

  it('sends NO reply — it is a host-initiated push, not a request', async () => {
    const transport = initTransport();
    await transport.waitForInit();
    postMessageMock.mockClear();

    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'light' } }, PARENT_ORIGIN),
    );
    expect(postMessageMock).not.toHaveBeenCalled();
    transport.dispose();
  });

  it('drops a malformed THEME_CHANGE (off-ladder theme) and leaves the snapshot alone', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = initTransport();
    await transport.waitForInit();

    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'midnight' } }, PARENT_ORIGIN),
    );

    expect(transport.getSnapshot().theme).toBe('dark');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('THEME_CHANGE'));
    warnSpy.mockRestore();
    transport.dispose();
  });

  it('drops a well-formed THEME_CHANGE from a DISALLOWED origin', async () => {
    const transport = initTransport();
    await transport.waitForInit();

    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'light' } }, OTHER_ORIGIN),
    );

    // The origin allowlist runs before anything else in handleMessage; a
    // sibling frame must not be able to repaint another publisher's block.
    expect(transport.getSnapshot().theme).toBe('dark');
    transport.dispose();
  });

  it('a pre-init push is applied but NEVER makes the block ready, and BLOCK_INIT still wins', async () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    // Arrives BEFORE BLOCK_INIT: freshest value the host has, so apply it —
    // but it must not flip `ready` (only BLOCK_INIT does).
    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'dark' } }, PARENT_ORIGIN),
    );
    expect(transport.getSnapshot().theme).toBe('dark');
    expect(transport.getSnapshot().ready).toBe(false);

    // BLOCK_INIT replaces the WHOLE snapshot — the payload stays authoritative.
    window.dispatchEvent(
      mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload({ theme: 'light' }) }, PARENT_ORIGIN),
    );
    await transport.waitForInit();
    expect(transport.getSnapshot().theme).toBe('light');
    expect(transport.getSnapshot().ready).toBe(true);
    transport.dispose();
  });

  it('OLD SDK back-compat: a parent push with NO handler is a complete no-op', async () => {
    // A DEPLOYED block runs an SDK that predates THEME_CHANGE, so its
    // handleMessage has no branch for it: not BLOCK_INIT, not TOKEN_REFRESH, no
    // requestId to match a pending request, no push listener → it falls through
    // to the no-op tail. This pins that fall-through with a type the CURRENT
    // transport also does not know, which is structurally the same position an
    // old SDK is in for THEME_CHANGE.
    const transport = initTransport();
    await transport.waitForInit();
    const before = transport.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);
    postMessageMock.mockClear();

    window.dispatchEvent(
      mockParentMessage({ type: 'SOME_FUTURE_HOST_PUSH', payload: { anything: 1 } }, PARENT_ORIGIN),
    );

    expect(transport.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
    unsubscribe();
    transport.dispose();
  });

  it('does not resolve or disturb an in-flight request', async () => {
    const transport = initTransport();
    await transport.waitForInit();
    postMessageMock.mockClear();

    const pending = sendTypedRequest(
      transport,
      { type: 'GET_BUZZ_BALANCE', payload: {} },
      'BUZZ_BALANCE_RESULT',
      { timeoutMs: 250 },
    );

    window.dispatchEvent(
      mockParentMessage({ type: 'THEME_CHANGE', payload: { theme: 'light' } }, PARENT_ORIGIN),
    );
    expect(transport.getSnapshot().theme).toBe('light');

    vi.advanceTimersByTime(300);
    await expect(pending).rejects.toThrow(/timed out/);
    transport.dispose();
  });
});
