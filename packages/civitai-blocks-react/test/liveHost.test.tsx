import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPageSlotContext } from '@civitai/app-sdk/blocks';

import { createLiveHost, decodeBlockTokenPayload } from '../src/testing.js';
import type { PickerOverlayHandle } from '../src/testing.js';
import type {
  BlockCheckpointInfo,
  BlockInitPayload,
  BlockResourceInfo,
  BlockWorkflowSnapshot,
} from '@civitai/app-sdk/blocks';

/**
 * Unit coverage for `createLiveHost` (Phase 2 of the dev-token live mode).
 *
 * These tests run with NO real network — they inject a mock `fetchImpl` and
 * assert the live host:
 *   - forwards each workflow message to the right `blocks.*` tRPC mutation with
 *     the Bearer block token + the `{ json: { blockToken, body } }` superjson
 *     envelope, and dispatches the correct reply keyed by `requestId`;
 *   - maps a backend error into a failed-shape reply (never hangs);
 *   - builds BLOCK_INIT from the decoded token + a mocked `/blocks/me`;
 *   - SERVES App-Storage KV via the block-token `apps.storage.*` procs (GET for
 *     queries, POST for mutations) and FORWARDS SET_USER_CHECKPOINT to
 *     `blocks.updateUserSettings`;
 *   - opens a buzz-purchase tab and replies purchased:false (the one remaining
 *     honest-by-design non-served capability).
 *
 * The live host fires inbound replies as `MessageEvent`s on `window`; we listen
 * directly (no SDK transport / hooks) so the wire contract is asserted at the
 * postMessage boundary.
 */

const ORIGIN = window.location.origin;

/** base64url-encode a UTF-8 string (no padding) — for hand-building a fake JWT. */
function base64url(s: string): string {
  const b64 =
    typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build a fake (UNSIGNED) JWT with a controllable payload. */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

const NOW_SEC = Math.floor(Date.now() / 1000);

const DEFAULT_CLAIMS = {
  blockId: 'block-abc',
  appId: 'app_xyz',
  appBlockId: 'apb_123',
  blockInstanceId: 'page_apb_123',
  ctx: { slotId: 'app.page', entityType: 'none' },
  scopes: ['ai:write:budgeted', 'models:read:self'],
  buzzBudget: 200,
  maxBrowsingLevel: 3,
  sub: 'user:42',
  iat: NOW_SEC,
  exp: NOW_SEC + 15 * 60,
};

const BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'a cat' },
};

/** A tRPC superjson success envelope carrying `{ snapshot }`. */
function trpcOk(snapshot: BlockWorkflowSnapshot) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ result: { data: { json: { snapshot } } } }),
    json: async () => ({ result: { data: { json: { snapshot } } } }),
  } as unknown as Response;
}

/** A tRPC superjson success envelope carrying an arbitrary plain `data` object. */
function trpcData(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ result: { data: { json: data } } }),
    json: async () => ({ result: { data: { json: data } } }),
  } as unknown as Response;
}

/** Decode a tRPC GET request's `?input=` querystring back to its `{ json }` payload. */
function decodeInputParam(url: string): unknown {
  const q = url.indexOf('?');
  const params = new URLSearchParams(q >= 0 ? url.slice(q + 1) : '');
  const raw = params.get('input');
  return raw == null ? undefined : JSON.parse(raw);
}

/** A tRPC error envelope (HTTP 500-ish). */
function trpcErr(message: string, status = 500) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { json: { message } } }),
    json: async () => ({ error: { json: { message } } }),
  } as unknown as Response;
}

/** A /api/v1/blocks/me success response. */
function meOk(me: { id: number; username: string | null; status?: string }) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(me),
    json: async () => me,
  } as unknown as Response;
}

/** Collect inbound messages the live host dispatches to the block. */
function collectInbound() {
  const messages: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const listener = (e: MessageEvent) => {
    if (e.origin !== ORIGIN) return;
    const data = e.data as { type?: string; payload?: Record<string, unknown> };
    if (data && typeof data.type === 'string') messages.push({ type: data.type, payload: data.payload });
  };
  window.addEventListener('message', listener);
  return {
    messages,
    stop: () => window.removeEventListener('message', listener),
  };
}

/** Wait until a message of `type` appears, returning its payload. */
async function waitForMessage(
  inbound: ReturnType<typeof collectInbound>,
  type: string,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 50; i += 1) {
    const found = inbound.messages.find((m) => m.type === type);
    if (found) return found.payload ?? {};
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${type}; saw: ${inbound.messages.map((m) => m.type).join(', ')}`,
  );
}

/**
 * Like {@link waitForMessage} but with a generous budget (~5s) for replies that
 * land after the live host's POLL retry backoff (250/500/1000ms).
 */
async function waitForMessageLong(
  inbound: ReturnType<typeof collectInbound>,
  type: string,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 250; i += 1) {
    const found = inbound.messages.find((m) => m.type === type);
    if (found) return found.payload ?? {};
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `timed out waiting for ${type}; saw: ${inbound.messages.map((m) => m.type).join(', ')}`,
  );
}

/** Post an outbound message through the patched `window.parent`. */
function post(type: string, payload: Record<string, unknown>) {
  window.parent.postMessage({ type, payload }, ORIGIN);
}

describe('decodeBlockTokenPayload', () => {
  it('decodes the payload segment of a JWT', () => {
    const token = fakeJwt(DEFAULT_CLAIMS);
    const decoded = decodeBlockTokenPayload(token);
    expect(decoded.blockId).toBe('block-abc');
    expect(decoded.scopes).toEqual(['ai:write:budgeted', 'models:read:self']);
    expect(decoded.buzzBudget).toBe(200);
    expect(decoded.sub).toBe('user:42');
  });

  it('returns {} for a malformed token', () => {
    expect(decodeBlockTokenPayload('not-a-jwt')).toEqual({});
    expect(decodeBlockTokenPayload('')).toEqual({});
    // A segment that base64url-decodes to non-JSON → {} (never throws).
    expect(decodeBlockTokenPayload('a.@@@.c')).toEqual({});
  });
});

describe('createLiveHost — BLOCK_INIT', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('builds BLOCK_INIT from the decoded token + a mocked /blocks/me', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/blocks/me')) {
        return meOk({ id: 42, username: 'dev-mod', status: 'active' });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const host = createLiveHost({ blockToken: fakeJwt(DEFAULT_CLAIMS), fetchImpl });
    uninstall = host.install();

    const payload = (await waitForMessage(inbound, 'BLOCK_INIT')) as unknown as BlockInitPayload;
    expect(payload.blockId).toBe('block-abc');
    expect(payload.appId).toBe('app_xyz');
    expect(payload.blockInstanceId).toBe('page_apb_123');
    // EXACTLY `{ id, username, signedIn }` — two halves, two provenances (the
    // full note is on `anonFallbackViewer` in `liveHost.ts`):
    //  - NO `status` mirrors production TODAY. `/api/v1/blocks/me` DID return
    //    `status: 'active'` above and it is deliberately dropped: the platform
    //    withholds the viewer's moderation state from third-party iframes
    //    (civitai #2521), so a live dev host that forwarded it would be more
    //    generous than production and would let a block read a field it will
    //    never get.
    //  - `signedIn` runs AHEAD of production. It does not exist under
    //    `src/components/AppBlocks/` on civitai/civitai `main`; it arrives with
    //    civitai/civitai#3707 (OPEN, unmerged). Emitted so the field is
    //    exercisable locally; `viewer !== null` is still the gate to ship.
    // `toEqual` (not `toMatchObject`) is the assertion that can see the extra
    // key.
    expect(payload.viewer).toEqual({ id: 42, username: 'dev-mod', signedIn: true });
    expect(payload.context.slotId).toBe('app.page');
    expect(payload.token.raw).toBe(fakeJwt(DEFAULT_CLAIMS));
    expect(payload.token.scopes).toContain('ai:write:budgeted');
    expect(payload.token.buzzBudget).toBe(200);
    expect(payload.maxBrowsingLevel).toBe(3);
    // /blocks/me was called with the Bearer token.
    const meCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).endsWith('/api/v1/blocks/me'),
    );
    expect(meCall).toBeTruthy();
    expect((meCall![1] as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${fakeJwt(DEFAULT_CLAIMS)}`,
    });
  });

  it('default fetch (no fetchImpl) is invoked BOUND to globalThis (no "Illegal invocation")', async () => {
    // A real browser `fetch` throws "Illegal invocation" when called as a
    // detached reference; we encode that contract by recording `this`. The
    // default fetch wrapper must call `globalThis.fetch` as a METHOD
    // (this === globalThis), not a bare reference (this === undefined under ESM
    // strict mode), which was the bug that broke the catalog/picker + every
    // live-host call when no fetchImpl was passed.
    const calledThis: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      calledThis.push(this);
      return Promise.resolve(meOk({ id: 7, username: 'dev', status: 'active' }));
    } as unknown as typeof fetch;
    try {
      const host = createLiveHost({ blockToken: fakeJwt(DEFAULT_CLAIMS) }); // NO fetchImpl
      uninstall = host.install();
      await waitForMessage(inbound, 'BLOCK_INIT'); // triggers /blocks/me via the default fetch
      expect(calledThis.length).toBeGreaterThan(0);
      for (const t of calledThis) expect(t).toBe(globalThis);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('falls back to an anon-ish viewer when /blocks/me fails', async () => {
    const fetchImpl = vi.fn(async () => trpcErr('nope', 401)) as unknown as typeof fetch;
    const host = createLiveHost({ blockToken: fakeJwt(DEFAULT_CLAIMS), fetchImpl });
    uninstall = host.install();
    const payload = (await waitForMessage(inbound, 'BLOCK_INIT')) as unknown as BlockInitPayload;
    // The FALLBACK path must carry the same key set as the success path — an
    // exact `toEqual`, not `toMatchObject({ id: 0 })`, which cannot see a
    // missing `signedIn` or a smuggled `status`.
    expect(payload.viewer).toEqual({ id: 0, username: 'dev-live', signedIn: true });
  });

  it('🔴 the DEFAULT page context is complete, and `slug` is not the blockId', async () => {
    // `PageBlockHost.buildContext()` always sends slug/subPath/viewerUserId/
    // viewerUsername/theme, so a `{ slotId }` stub would let a page author
    // compile against fields the harness never delivers — and would no longer
    // even narrow through `isPageSlotContext`.
    //
    // `slug` is a PLACEHOLDER: the block token carries no slug claim, so the
    // live host cannot know it. It must NOT be filled from `decoded.blockId`
    // (here 'block-abc') — a blockId is a different identifier in a different
    // namespace, and a block that built a URL out of it would build a wrong one.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/blocks/me')) return meOk({ id: 42, username: 'dev-mod' });
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
    const host = createLiveHost({ blockToken: fakeJwt(DEFAULT_CLAIMS), fetchImpl, theme: 'light' });
    uninstall = host.install();
    const payload = (await waitForMessage(inbound, 'BLOCK_INIT')) as unknown as BlockInitPayload;

    const ctx = payload.context;
    expect(isPageSlotContext(ctx)).toBe(true);
    if (!isPageSlotContext(ctx)) throw new Error('expected a page slot context');
    expect(ctx.slug).not.toBe('block-abc');
    expect(ctx.slug).toBe('live-dev-app');
    expect(ctx.subPath).toBe('');
    expect(ctx.entityType).toBe('none');
    expect(ctx.viewerUserId).toBe(42);
    expect(ctx.viewerUsername).toBe('dev-mod');
    expect(ctx.theme).toBe('light');
  });

  it('a caller-supplied context that omits `theme` still receives the host theme', async () => {
    // Kills the mutant that drops the `hostContextWithTheme(...)` call: the
    // DEFAULT context already carries `theme`, so only a caller-supplied one can
    // observe the difference.
    const fetchImpl = vi.fn(async () => meOk({ id: 42, username: 'dev-mod' })) as unknown as typeof fetch;
    const host = createLiveHost({
      blockToken: fakeJwt(DEFAULT_CLAIMS),
      fetchImpl,
      theme: 'light',
      context: { slotId: 'app.page', slug: 'seed-explorer', subPath: 'compare/42', viewerUserId: 42 },
    });
    uninstall = host.install();
    const payload = (await waitForMessage(inbound, 'BLOCK_INIT')) as unknown as BlockInitPayload;
    const ctx = payload.context;
    if (!isPageSlotContext(ctx)) throw new Error('expected a page slot context');
    expect(ctx.theme).toBe('light');
    expect(ctx.slug).toBe('seed-explorer');
  });

  it('uses an explicit viewer override without fetching /blocks/me', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;
    const host = createLiveHost({
      blockToken: fakeJwt(DEFAULT_CLAIMS),
      viewer: { id: 7, username: 'override' },
      fetchImpl,
    });
    uninstall = host.install();
    const payload = (await waitForMessage(inbound, 'BLOCK_INIT')) as unknown as BlockInitPayload;
    expect(payload.viewer).toEqual({ id: 7, username: 'override' });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('createLiveHost — workflow forwarding', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  function installWithFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    fetchMock = vi.fn(impl);
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'dev-mod' }, // skip /blocks/me
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('ESTIMATE_WORKFLOW → blocks.estimateWorkflow → ESTIMATE_RESULT keyed by requestId', async () => {
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.estimateWorkflow')) {
        return trpcOk({ workflowId: 'whatif', status: 'pending', cost: { total: 12 } });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('ESTIMATE_WORKFLOW', { requestId: 'r-est', body: BODY });
    const payload = await waitForMessage(inbound, 'ESTIMATE_RESULT');
    expect(payload.requestId).toBe('r-est');
    expect((payload.snapshot as BlockWorkflowSnapshot).cost?.total).toBe(12);

    // Assert URL + Bearer + superjson body envelope.
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('blocks.estimateWorkflow'))!;
    expect(String(call[0])).toBe('https://civitai.com/api/trpc/blocks.estimateWorkflow');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(String(init.body))).toEqual({ json: { blockToken: TOKEN, body: BODY } });
  });

  it('SUBMIT_WORKFLOW → blocks.submitWorkflow → WORKFLOW_SUBMITTED', async () => {
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.submitWorkflow')) {
        return trpcOk({ workflowId: 'wf_1', status: 'pending' });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('SUBMIT_WORKFLOW', { requestId: 'r-sub', body: BODY });
    const payload = await waitForMessage(inbound, 'WORKFLOW_SUBMITTED');
    expect(payload.requestId).toBe('r-sub');
    expect((payload.snapshot as BlockWorkflowSnapshot).workflowId).toBe('wf_1');
  });

  it('POLL_WORKFLOW → blocks.pollWorkflow → WORKFLOW_STATUS', async () => {
    installWithFetch(async (url, init) => {
      if (url.endsWith('blocks.pollWorkflow')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ json: { blockToken: TOKEN, workflowId: 'wf_1' } });
        return trpcOk({
          workflowId: 'wf_1',
          status: 'succeeded',
          imageUrls: ['https://img.test/a.png'],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('POLL_WORKFLOW', { requestId: 'r-poll', workflowId: 'wf_1' });
    const payload = await waitForMessage(inbound, 'WORKFLOW_STATUS');
    expect(payload.requestId).toBe('r-poll');
    expect((payload.snapshot as BlockWorkflowSnapshot).status).toBe('succeeded');
    expect((payload.snapshot as BlockWorkflowSnapshot).imageUrls).toEqual([
      'https://img.test/a.png',
    ]);
  });

  it('POLL transient error then success → retries, dispatches the SUCCESS (not failed)', async () => {
    // The poll's FIRST tRPC call errors (a 500 transport blip — e.g. a
    // not-yet-rolled-out pod); the retry succeeds. The block must see the
    // eventual `succeeded` snapshot, NEVER a fabricated terminal `failed`. This
    // is the round-5 dogfood bug: a poll blip turned a server-side success into
    // FAILED and stopped the loop.
    let pollCalls = 0;
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.pollWorkflow')) {
        pollCalls += 1;
        if (pollCalls === 1) return trpcErr('upstream connect error (503)', 503);
        return trpcOk({
          workflowId: 'wf_1',
          status: 'succeeded',
          imageUrls: ['https://img.test/ok.png'],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('POLL_WORKFLOW', { requestId: 'r-retry', workflowId: 'wf_1' });
    // First retry backoff is 250ms — wait generously.
    const payload = await waitForMessageLong(inbound, 'WORKFLOW_STATUS');
    expect(payload.requestId).toBe('r-retry');
    const snap = payload.snapshot as BlockWorkflowSnapshot;
    expect(snap.status).toBe('succeeded'); // NOT 'failed'
    expect(snap.imageUrls).toEqual(['https://img.test/ok.png']);
    expect(pollCalls).toBe(2); // retried exactly once before succeeding
  });

  it('POLL with a GENUINE failed status (HTTP 200 snapshot) → terminal failed (no retry)', async () => {
    // A workflow the orchestrator actually failed comes back as a 200 response
    // whose snapshot.status is 'failed'. That IS terminal — forward it as-is,
    // do not retry it as if it were a transport blip.
    let pollCalls = 0;
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.pollWorkflow')) {
        pollCalls += 1;
        return trpcOk({ workflowId: 'wf_1', status: 'failed', error: 'NSFW prompt rejected' });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('POLL_WORKFLOW', { requestId: 'r-realfail', workflowId: 'wf_1' });
    const payload = await waitForMessage(inbound, 'WORKFLOW_STATUS');
    const snap = payload.snapshot as BlockWorkflowSnapshot;
    expect(snap.status).toBe('failed');
    expect(snap.error).toMatch(/NSFW prompt rejected/);
    expect(pollCalls).toBe(1); // a real failed status is not retried
  });

  it('POLL transport error that NEVER recovers → keep-polling `processing`, not terminal `failed`', async () => {
    // Every poll attempt 401s (a backend that stays unreachable through the
    // retry budget). After the bounded retries the host must NOT fabricate a
    // terminal `failed` — it replies with a NON-terminal `processing` snapshot
    // carrying the transient error, so the block's own poll loop keeps trying
    // and a real outcome can still surface.
    let pollCalls = 0;
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.pollWorkflow')) {
        pollCalls += 1;
        return trpcErr('unauthorized (pod not ready)', 401);
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('POLL_WORKFLOW', { requestId: 'r-stuck', workflowId: 'wf_1' });
    const payload = await waitForMessageLong(inbound, 'WORKFLOW_STATUS');
    const snap = payload.snapshot as BlockWorkflowSnapshot;
    expect(snap.status).toBe('processing'); // NON-terminal — keep polling
    expect(snap.status).not.toBe('failed');
    expect(snap.workflowId).toBe('wf_1'); // keeps the id so the block maps it back
    expect(snap.error).toMatch(/unauthorized/);
    // 1 initial + 3 retries (POLL_RETRY_BACKOFF_MS has 3 entries).
    expect(pollCalls).toBe(4);
  });

  it('CANCEL_WORKFLOW → blocks.cancelWorkflow → WORKFLOW_CANCELED', async () => {
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.cancelWorkflow')) {
        return trpcOk({ workflowId: 'wf_1', status: 'canceled' });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('CANCEL_WORKFLOW', { requestId: 'r-cancel', workflowId: 'wf_1' });
    const payload = await waitForMessage(inbound, 'WORKFLOW_CANCELED');
    expect(payload.requestId).toBe('r-cancel');
    expect((payload.snapshot as BlockWorkflowSnapshot).status).toBe('canceled');
  });

  it('a backend ERROR maps to a failed-shape reply (no hang)', async () => {
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.submitWorkflow')) {
        return trpcErr('orchestrator exploded');
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('SUBMIT_WORKFLOW', { requestId: 'r-fail', body: BODY });
    const payload = await waitForMessage(inbound, 'WORKFLOW_SUBMITTED');
    expect(payload.requestId).toBe('r-fail');
    const snap = payload.snapshot as BlockWorkflowSnapshot;
    expect(snap.status).toBe('failed');
    expect(snap.workflowId).toBe('failed'); // non-empty sentinel so the SDK doesn't drop it
    expect(snap.error).toMatch(/orchestrator exploded/);
  });

  it('a network throw maps to a failed-shape reply', async () => {
    installWithFetch(async (url) => {
      if (url.endsWith('blocks.estimateWorkflow')) throw new TypeError('network down');
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('ESTIMATE_WORKFLOW', { requestId: 'r-net', body: BODY });
    const payload = await waitForMessage(inbound, 'ESTIMATE_RESULT');
    const snap = payload.snapshot as BlockWorkflowSnapshot;
    expect(snap.status).toBe('failed');
    expect(snap.error).toMatch(/network down/);
  });
});

describe('createLiveHost — token + non-forwarded messages', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  function install(extra?: { token?: string }) {
    const fetchImpl = vi.fn(async () => meOk({ id: 42, username: 'm' })) as unknown as typeof fetch;
    const host = createLiveHost({
      blockToken: extra?.token ?? TOKEN,
      viewer: { id: 42, username: 'm' },
      fetchImpl,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('REQUEST_TOKEN echoes the pasted token wrapped, keyed by requestId', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('REQUEST_TOKEN', { requestId: 'r-tok', blockInstanceId: 'page_apb_123' });
    const payload = await waitForMessage(inbound, 'TOKEN_REFRESH_RESPONSE');
    expect(payload.requestId).toBe('r-tok');
    expect((payload.token as { raw: string }).raw).toBe(TOKEN);
    expect((payload.token as { scopes: string[] }).scopes).toContain('ai:write:budgeted');
  });

  it('REQUEST_TOKEN on an EXPIRED token still echoes it (backend will 401)', async () => {
    const expiredToken = fakeJwt({ ...DEFAULT_CLAIMS, exp: NOW_SEC - 10 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    install({ token: expiredToken });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('REQUEST_TOKEN', { requestId: 'r-exp', blockInstanceId: 'x' });
    const payload = await waitForMessage(inbound, 'TOKEN_REFRESH_RESPONSE');
    expect((payload.token as { raw: string }).raw).toBe(expiredToken);
    expect(errSpy).toHaveBeenCalled(); // actionable "re-mint" error logged
  });

  it('OPEN_BUZZ_PURCHASE opens a tab + replies purchased:false', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('OPEN_BUZZ_PURCHASE', { requestId: 'r-buy', suggestedAmount: 100 });
    const payload = await waitForMessage(inbound, 'BUZZ_PURCHASE_RESULT');
    expect(payload.requestId).toBe('r-buy');
    expect(payload.purchased).toBe(false);
    expect(openSpy).toHaveBeenCalledWith('https://civitai.com/purchase/buzz', '_blank');
  });

  it('TRACK_EVENT / REQUEST_SIGN_IN / BLOCK_ERROR are no-op (no reply, no throw)', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    const before = inbound.messages.length;
    post('TRACK_EVENT', { eventName: 'x' });
    post('REQUEST_SIGN_IN', {});
    post('BLOCK_ERROR', { message: 'boom', fatal: false });
    // Give any (incorrect) replies a tick to land.
    await new Promise((r) => setTimeout(r, 20));
    expect(inbound.messages.length).toBe(before);
  });

  it('REQUEST_CONSENT logs an actionable error (live mode cannot grant) — no reply', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    const before = inbound.messages.length;
    // NOTE (post-CONSENT_UNAVAILABLE): `DEFAULT_CLAIMS` ALREADY carries
    // `ai:write:budgeted`, so this is the BENIGN re-request — the block asked
    // for a scope it already holds. That is why nothing is pushed here, and it
    // is the behaviour we want: a refusal rendered over a permission that works
    // is worse than silence. The refusal path is covered below with a token that
    // genuinely lacks the scope.
    post('REQUEST_CONSENT', { scopes: ['ai:write:budgeted'] });
    await new Promise((r) => setTimeout(r, 20));
    // No reply dispatched (can't grant), but a clear warning is logged.
    expect(inbound.messages.length).toBe(before);
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/REQUEST_CONSENT/);
    expect(logged).toMatch(/civitai login --token/);
  });

  it('REQUEST_CONSENT for a scope the token LACKS pushes CONSENT_UNAVAILABLE', async () => {
    // 🔴 Live mode can grant NOTHING — there is no consent UI to open and no way
    // to re-mint a token with a scope it does not carry. So every request for a
    // scope the token lacks is permanently un-grantable, and before this push the
    // only trace was a `console.warn` in the DEV's devtools: the block's own UI
    // went on telling the user to click Generate again. Emitting it here is what
    // makes a refusal handler written against production reachable in
    // `pnpm dev:live` at all.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readOnly = fakeJwt({ ...DEFAULT_CLAIMS, scopes: ['user:read:self'], buzzBudget: undefined });
    install({ token: readOnly });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('REQUEST_CONSENT', { scopes: ['ai:write:budgeted', 'buzz:read:self'] });
    const payload = await waitForMessage(inbound, 'CONSENT_UNAVAILABLE');
    expect(payload).toEqual({
      reason: 'ungrantable',
      scopes: ['ai:write:budgeted', 'buzz:read:self'],
    });
  });

  it('🔴 REQUEST_CONSENT naming only UNKNOWN scopes still pushes, with scopes: []', async () => {
    // The trap, at the live host. `notify` is decided on the UNFILTERED set, so
    // an un-grantable scope outside the platform vocabulary still refuses out
    // loud — only the NAMES are filtered, because the hint is untrusted block
    // input and this payload is rendered by block UI.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readOnly = fakeJwt({ ...DEFAULT_CLAIMS, scopes: ['user:read:self'], buzzBudget: undefined });
    install({ token: readOnly });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('REQUEST_CONSENT', {
      scopes: ['<img src=x onerror=alert(1)>', 'not:a:real:scope', 'A'.repeat(5000)],
    });
    const payload = await waitForMessage(inbound, 'CONSENT_UNAVAILABLE');
    expect(payload).toEqual({ reason: 'ungrantable', scopes: [] });
  });

  it('REQUEST_CONSENT with NO scopes hint pushes nothing (still logs)', async () => {
    // Without an explicit requested scope proven un-grantable there is no way to
    // tell "already granted" from "clamped", so the host stays silent rather
    // than guessing.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readOnly = fakeJwt({ ...DEFAULT_CLAIMS, scopes: ['user:read:self'], buzzBudget: undefined });
    install({ token: readOnly });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('REQUEST_CONSENT', {});
    await new Promise((r) => setTimeout(r, 20));
    expect(inbound.messages.filter((m) => m.type === 'CONSENT_UNAVAILABLE')).toHaveLength(0);
    // The log still fires — it is unconditional and unchanged by this PR.
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/REQUEST_CONSENT/);

    // POSITIVE CONTROL for the zero above: the SAME host + SAME collector DOES
    // deliver a CONSENT_UNAVAILABLE when the hint names an un-grantable scope,
    // so the empty filter result is a real silence and not a probe wired to
    // nothing.
    post('REQUEST_CONSENT', { scopes: ['ai:write:budgeted'] });
    const payload = await waitForMessage(inbound, 'CONSENT_UNAVAILABLE');
    expect(payload).toEqual({ reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
  });
});

describe('createLiveHost — read-only token startup warning', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    vi.restoreAllMocks();
  });

  function install(token: string) {
    const host = createLiveHost({
      blockToken: token,
      viewer: { id: 42, username: 'm' },
      fetchImpl: vi.fn(async () => meOk({ id: 42, username: 'm' })) as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  it('warns up front when the token lacks ai:write:budgeted (OAuth-minted)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readOnly = fakeJwt({ ...DEFAULT_CLAIMS, scopes: ['user:read:self'], buzzBudget: undefined });
    install(readOnly);
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/READ-ONLY/);
    expect(logged).toMatch(/ai:write:budgeted/);
    expect(logged).toMatch(/civitai login --token/);
  });

  it('does NOT warn for a spendable (personal-key-minted) token', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    install(fakeJwt(DEFAULT_CLAIMS));
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/READ-ONLY/);
  });
});

describe('createLiveHost — picker (serves the catalog locally, no longer a stub)', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  /** A /api/v1/blocks/models (or /api/v1/models) catalog page response. */
  function catalogOk(items: unknown[], nextCursor: string | null = null) {
    const body = { items, metadata: { nextCursor } };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }

  const CKPT_MODEL = {
    id: 100,
    name: 'Awesome XL',
    type: 'Checkpoint',
    nsfw: false,
    modelVersions: [
      {
        id: 9001,
        name: 'v2.0',
        baseModel: 'SDXL 1.0',
        images: [{ url: 'https://image.civitai.com/a/original=true/x.jpeg' }],
      },
    ],
  };
  const LORA_MODEL = {
    id: 300,
    name: 'Cool LoRA',
    type: 'LORA',
    nsfw: false,
    modelVersions: [{ id: 7777, name: 'v1', baseModel: 'SDXL 1.0', images: [] }],
  };

  /**
   * Install a live host whose fetch answers /blocks/me, the catalog endpoints,
   * and (optionally) records which catalog URLs were hit. `onPickerReady` is the
   * test seam — it drives the overlay programmatically once it's loaded.
   */
  function install(
    items: unknown[],
    onPickerReady: (h: PickerOverlayHandle) => void,
    sink?: { urls: string[] },
  ) {
    const fetchImpl = vi.fn(async (url: string) => {
      sink?.urls.push(url);
      if (url.includes('/api/v1/blocks/models') || url.endsWith('/api/v1/models') || url.includes('/api/v1/models?')) {
        return catalogOk(items);
      }
      return meOk({ id: 42, username: 'm' });
    }) as unknown as typeof fetch;
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'm' },
      fetchImpl,
      onPickerReady,
    });
    uninstall = host.install();
    return fetchImpl as unknown as ReturnType<typeof vi.fn>;
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('OPEN_CHECKPOINT_PICKER does NOT reply "not supported", fetches the catalog, and on a pick dispatches a correctly-shaped selected', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = { urls: [] as string[] };
    const fetchImpl = install([CKPT_MODEL], (h) => h.selectFirst(), sink);
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('OPEN_CHECKPOINT_PICKER', { requestId: 'r-ckpt', baseModelGroup: 'SDXL' });
    const payload = await waitForMessage(inbound, 'CHECKPOINT_PICKER_RESULT');

    // (a) not the old stub — a real selection landed.
    expect(payload.requestId).toBe('r-ckpt');
    const selected = payload.selected as BlockCheckpointInfo;
    expect(selected).toEqual({
      versionId: 9001,
      modelId: 100,
      modelName: 'Awesome XL',
      versionName: 'v2.0',
      baseModel: 'SDXL 1.0',
    });

    // (b) the catalog was fetched via the AUTHORITATIVE blocks endpoint w/ Bearer.
    const catalogCall = fetchImpl.mock.calls.find((c) =>
      String(c[0]).includes('/api/v1/blocks/models'),
    );
    expect(catalogCall).toBeTruthy();
    expect(String(catalogCall![0])).toContain('types=Checkpoint');
    expect((catalogCall![1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });

    // The old NOT_SUPPORTED warning must NOT have fired.
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/not supported/i);
  });

  it('OPEN_CHECKPOINT_PICKER dismissal yields NO selected', async () => {
    install([CKPT_MODEL], (h) => h.dismiss());
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('OPEN_CHECKPOINT_PICKER', { requestId: 'r-dismiss', baseModelGroup: 'SDXL' });
    const payload = await waitForMessage(inbound, 'CHECKPOINT_PICKER_RESULT');
    expect(payload.requestId).toBe('r-dismiss');
    expect(payload.selected).toBeUndefined();
  });

  it('OPEN_RESOURCE_PICKER (LORA) fetches the catalog and dispatches a BlockResourceInfo on pick', async () => {
    const fetchImpl = install([LORA_MODEL], (h) => h.selectFirst());
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('OPEN_RESOURCE_PICKER', { requestId: 'r-lora', resourceType: 'LORA' });
    const payload = await waitForMessage(inbound, 'RESOURCE_PICKER_RESULT');
    expect(payload.requestId).toBe('r-lora');
    const selected = payload.selected as BlockResourceInfo;
    expect(selected).toEqual({
      versionId: 7777,
      modelId: 300,
      modelName: 'Cool LoRA',
      versionName: 'v1',
      baseModel: 'SDXL 1.0',
      modelType: 'LORA',
    });
    const catalogCall = fetchImpl.mock.calls.find((c) =>
      String(c[0]).includes('/api/v1/blocks/models'),
    );
    expect(String(catalogCall![0])).toContain('types=LORA');
  });

  it('OPEN_RESOURCE_PICKER dismissal yields NO selected', async () => {
    install([LORA_MODEL], (h) => h.dismiss());
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('OPEN_RESOURCE_PICKER', { requestId: 'r-lora-x', resourceType: 'LORA' });
    const payload = await waitForMessage(inbound, 'RESOURCE_PICKER_RESULT');
    expect(payload.requestId).toBe('r-lora-x');
    expect(payload.selected).toBeUndefined();
  });

  it('mounts an overlay into the document and tears it down on selection', async () => {
    let captured: PickerOverlayHandle | undefined;
    install([CKPT_MODEL], (h) => {
      captured = h;
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('OPEN_CHECKPOINT_PICKER', { requestId: 'r-dom', baseModelGroup: 'SDXL' });

    // Wait for the overlay to be ready (catalog loaded) → DOM node present.
    for (let i = 0; i < 50 && !captured; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(captured).toBeTruthy();
    expect(document.querySelector('[data-live-picker-overlay]')).not.toBeNull();
    // A clickable card exists for the loaded model.
    expect(document.querySelector('[data-picker-card="9001"]')).not.toBeNull();

    // Pick → overlay unmounts + a result lands.
    captured!.selectByVersionId(9001);
    const payload = await waitForMessage(inbound, 'CHECKPOINT_PICKER_RESULT');
    expect((payload.selected as BlockCheckpointInfo).versionId).toBe(9001);
    expect(document.querySelector('[data-live-picker-overlay]')).toBeNull();
  });

  it('host teardown closes an open overlay (no leaked DOM, dismissal result)', async () => {
    let captured: PickerOverlayHandle | undefined;
    install([CKPT_MODEL], (h) => {
      captured = h;
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('OPEN_CHECKPOINT_PICKER', { requestId: 'r-teardown', baseModelGroup: 'SDXL' });
    for (let i = 0; i < 50 && !captured; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(document.querySelector('[data-live-picker-overlay]')).not.toBeNull();

    uninstall?.();
    uninstall = undefined;
    expect(document.querySelector('[data-live-picker-overlay]')).toBeNull();
    expect(captured!.resolved).toBe(true);
  });
});

describe('createLiveHost — App-Storage KV (served via apps.storage.*)', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  function installWithFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    fetchMock = vi.fn(impl);
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'dev-mod' }, // skip /blocks/me
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('APP_STORAGE_GET → apps.storage.get (GET, ?input) → value', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.get')) return trpcData({ value: { theme: 'dark' } });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('APP_STORAGE_GET', { requestId: 'r-g', key: 'prefs' });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_GET_RESULT');
    expect(payload.requestId).toBe('r-g');
    expect(payload.value).toEqual({ theme: 'dark' });

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.storage.get'))!;
    // GET — no body, input in the querystring.
    expect((call[1] as RequestInit).method).toBe('GET');
    expect((call[1] as RequestInit).body).toBeUndefined();
    expect(String(call[0])).toContain('/api/trpc/apps.storage.get?input=');
    expect((call[1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(decodeInputParam(String(call[0]))).toEqual({ json: { blockToken: TOKEN, key: 'prefs' } });
  });

  it('APP_STORAGE_GET missing value → null', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.get')) return trpcData({ value: null });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('APP_STORAGE_GET', { requestId: 'r-g2', key: 'missing' });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_GET_RESULT');
    expect(payload.value).toBeNull();
    expect(payload.error).toBeUndefined();
  });

  it('APP_STORAGE_SET → apps.storage.set (POST body) → ok:true + sizeBytes', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.set')) return trpcData({ ok: true, sizeBytes: 17 });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('APP_STORAGE_SET', { requestId: 'r-s', key: 'prefs', value: { theme: 'dark' } });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_SET_RESULT');
    expect(payload.requestId).toBe('r-s');
    expect(payload.ok).toBe(true);
    expect(payload.sizeBytes).toBe(17);

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.storage.set'))!;
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(String(call[0])).toBe('https://civitai.com/api/trpc/apps.storage.set');
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { blockToken: TOKEN, key: 'prefs', value: { theme: 'dark' } },
    });
  });

  it('APP_STORAGE_SET without a backend sizeBytes → ok:true, sizeBytes omitted', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.set')) return trpcData({ ok: true });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('APP_STORAGE_SET', { requestId: 'r-s2', key: 'k', value: 1 });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_SET_RESULT');
    expect(payload.ok).toBe(true);
    expect('sizeBytes' in payload).toBe(false);
  });

  it('APP_STORAGE_DELETE → apps.storage.delete (POST) → ok + deleted', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.delete')) return trpcData({ ok: true, deleted: true });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('APP_STORAGE_DELETE', { requestId: 'r-d', key: 'prefs' });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_DELETE_RESULT');
    expect(payload.requestId).toBe('r-d');
    expect(payload.ok).toBe(true);
    expect(payload.deleted).toBe(true);

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.storage.delete'))!;
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { blockToken: TOKEN, key: 'prefs' },
    });
  });

  it('APP_STORAGE_DELETE of an absent key → ok:true, deleted:false', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.delete')) return trpcData({ ok: true, deleted: false });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('APP_STORAGE_DELETE', { requestId: 'r-d2', key: 'gone' });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_DELETE_RESULT');
    expect(payload.ok).toBe(true);
    expect(payload.deleted).toBe(false);
  });

  it('APP_STORAGE_LIST → apps.storage.list (GET) → keys (ISO updatedAt) + nextCursor', async () => {
    const updated = new Date('2026-06-27T12:00:00.000Z');
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.list')) {
        return trpcData({
          keys: [{ key: 'a', updatedAt: updated }],
          nextCursor: 'Y3Vyc29y',
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('APP_STORAGE_LIST', { requestId: 'r-l', prefix: 'pre', limit: 10, cursor: 'cur' });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_LIST_RESULT');
    expect(payload.requestId).toBe('r-l');
    expect(payload.keys).toEqual([{ key: 'a', updatedAt: '2026-06-27T12:00:00.000Z' }]);
    expect(payload.nextCursor).toBe('Y3Vyc29y');

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.storage.list'))!;
    expect((call[1] as RequestInit).method).toBe('GET');
    // limit clamped + prefix/cursor included as strings.
    expect(decodeInputParam(String(call[0]))).toEqual({
      json: { blockToken: TOKEN, limit: 10, prefix: 'pre', cursor: 'cur' },
    });
  });

  it('APP_STORAGE_LIST clamps the limit + drops a partial-page nextCursor', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.list')) return trpcData({ keys: [], nextCursor: undefined });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('APP_STORAGE_LIST', { requestId: 'r-l2', limit: 9999 });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_LIST_RESULT');
    expect(payload.keys).toEqual([]);
    expect('nextCursor' in payload).toBe(false);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.storage.list'))!;
    // 9999 clamped to 200; no prefix/cursor keys present.
    expect(decodeInputParam(String(call[0]))).toEqual({ json: { blockToken: TOKEN, limit: 200 } });
  });

  it('APP_STORAGE_QUOTA → apps.storage.getQuota (GET) → the 4 numbers', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.getQuota')) {
        return trpcData({ usedBytes: 12, rowCount: 3, limitBytes: 50_000_000, limitRows: 1000 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('APP_STORAGE_QUOTA', { requestId: 'r-q' });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_QUOTA_RESULT');
    expect(payload).toMatchObject({
      requestId: 'r-q',
      usedBytes: 12,
      rowCount: 3,
      limitBytes: 50_000_000,
      limitRows: 1000,
    });
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.storage.getQuota'))!;
    expect((call[1] as RequestInit).method).toBe('GET');
    expect(decodeInputParam(String(call[0]))).toEqual({ json: { blockToken: TOKEN } });
  });

  it('a storage error (FORBIDDEN) maps to the error-shape reply (no hang)', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.storage.get')) {
        return trpcErr('storage get requires the apps:storage:read scope', 403);
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('APP_STORAGE_GET', { requestId: 'r-forbidden', key: 'k' });
    const payload = await waitForMessage(inbound, 'APP_STORAGE_GET_RESULT');
    expect(payload.requestId).toBe('r-forbidden');
    expect(payload.value).toBeNull();
    expect(payload.error).toMatch(/apps:storage:read/);
  });
});

describe('createLiveHost — SET_USER_CHECKPOINT (forwarded to blocks.updateUserSettings)', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  function installWithFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    fetchMock = vi.fn(impl);
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'dev-mod' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('forwards a numeric versionId to blocks.updateUserSettings → ok:true', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.updateUserSettings')) return trpcData({ ok: true });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('SET_USER_CHECKPOINT', { requestId: 'r-suc', versionId: 9001 });
    const payload = await waitForMessage(inbound, 'USER_CHECKPOINT_SET');
    expect(payload.requestId).toBe('r-suc');
    expect(payload.ok).toBe(true);
    expect(payload.error).toBeUndefined();

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('blocks.updateUserSettings'),
    )!;
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { blockToken: TOKEN, settings: { checkpoint_version_id: 9001 } },
    });
  });

  it('forwards an explicit null versionId (clear override) to the backend', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.updateUserSettings')) return trpcData({ ok: true });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SET_USER_CHECKPOINT', { requestId: 'r-null', versionId: null });
    const payload = await waitForMessage(inbound, 'USER_CHECKPOINT_SET');
    expect(payload.ok).toBe(true);
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('blocks.updateUserSettings'),
    )!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { blockToken: TOKEN, settings: { checkpoint_version_id: null } },
    });
  });

  it('surfaces the REAL backend error (page token lacks modelId) as ok:false', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.updateUserSettings')) {
        return trpcErr('block token lacks modelId context', 400);
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SET_USER_CHECKPOINT', { requestId: 'r-page', versionId: 9001 });
    const payload = await waitForMessage(inbound, 'USER_CHECKPOINT_SET');
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/lacks modelId context/);
  });

  it('an invalid versionId is rejected WITHOUT a backend call', async () => {
    installWithFetch(async (url) => {
      throw new Error(`should not have fetched ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SET_USER_CHECKPOINT', { requestId: 'r-bad', versionId: 'not-a-number' });
    const payload = await waitForMessage(inbound, 'USER_CHECKPOINT_SET');
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/versionId must be a number or null/);
    // No updateUserSettings call was made.
    const called = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes('blocks.updateUserSettings'),
    );
    expect(called).toBe(false);
  });
});

describe('createLiveHost — GET_BUZZ_BALANCE (served via blocks.getMyBuzzBalance)', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  function installWithFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    fetchMock = vi.fn(impl);
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'dev-mod' }, // skip /blocks/me
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('GET_BUZZ_BALANCE → blocks.getMyBuzzBalance (POST body) → balance', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.getMyBuzzBalance')) {
        return trpcData({ blue: 100, green: 20, yellow: 3 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('GET_BUZZ_BALANCE', { requestId: 'r-bal' });
    const payload = await waitForMessage(inbound, 'BUZZ_BALANCE_RESULT');
    expect(payload.requestId).toBe('r-bal');
    expect(payload.balance).toEqual({ blue: 100, green: 20, yellow: 3 });
    expect(payload.error).toBeUndefined();

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('blocks.getMyBuzzBalance'),
    )!;
    // MUTATION → POST, token-bound in the body (never the URL).
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(String(call[0])).toBe('https://civitai.com/api/trpc/blocks.getMyBuzzBalance');
    expect((call[1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { blockToken: TOKEN },
    });
  });

  it('a backend error maps to the error-shape reply (no hang)', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.getMyBuzzBalance')) {
        return trpcErr('buzz balance unavailable for an anonymous viewer', 401);
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('GET_BUZZ_BALANCE', { requestId: 'r-bal-err' });
    const payload = await waitForMessage(inbound, 'BUZZ_BALANCE_RESULT');
    expect(payload.requestId).toBe('r-bal-err');
    expect(payload.balance).toBeUndefined();
    expect(payload.error).toMatch(/anonymous viewer/);
  });

  it('a request without a requestId is dropped WITHOUT a backend call', async () => {
    installWithFetch(async (url) => {
      throw new Error(`should not have fetched ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('GET_BUZZ_BALANCE', {});
    // Give the host a tick to (not) reply, then assert nothing was dispatched
    // and no balance call was made.
    await new Promise((r) => setTimeout(r, 50));
    expect(inbound.messages.some((m) => m.type === 'BUZZ_BALANCE_RESULT')).toBe(false);
    const called = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes('blocks.getMyBuzzBalance'),
    );
    expect(called).toBe(false);
  });
});

describe('createLiveHost — NAVIGATE', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  let openSpy: ReturnType<typeof vi.spyOn>;
  let assignSpy: ReturnType<typeof vi.spyOn>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  function install() {
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'dev-mod' }, // skip /blocks/me
      fetchImpl: vi.fn(async () =>
        trpcOk({ workflowId: 'x', status: 'pending' }),
      ) as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('new_tab target opens the resolved URL in a new tab (relative path → backend origin)', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('NAVIGATE', { path: '/models/123', target: 'new_tab' });
    await new Promise((r) => setTimeout(r, 10));
    expect(openSpy).toHaveBeenCalledWith('https://civitai.com/models/123', '_blank');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('current target assigns the resolved URL on the same frame', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('NAVIGATE', { path: '/user/alice', target: 'current' });
    await new Promise((r) => setTimeout(r, 10));
    expect(assignSpy).toHaveBeenCalledWith('https://civitai.com/user/alice');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('defaults to current-frame assign when no target is supplied', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('NAVIGATE', { path: '/' });
    await new Promise((r) => setTimeout(r, 10));
    expect(assignSpy).toHaveBeenCalledWith('https://civitai.com/');
  });

  it('passes an absolute URL through unchanged (not re-prefixed with the backend origin)', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('NAVIGATE', { path: 'https://example.com/x', target: 'new_tab' });
    await new Promise((r) => setTimeout(r, 10));
    expect(openSpy).toHaveBeenCalledWith('https://example.com/x', '_blank');
  });
});

describe('createLiveHost — startup guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an actionable console.error when no block token is supplied', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Non-fatal: the host is still returned so the dev sees a clear error.
    const host = createLiveHost({ blockToken: '' });
    expect(host).toBeDefined();
    expect(typeof host.install).toBe('function');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No block token supplied'));
  });
});

describe('createLiveHost — SHARED storage (served via apps.shared.*)', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  function installWithFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    fetchMock = vi.fn(impl);
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'dev-mod' }, // skip /blocks/me
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('SHARED_LIST → apps.shared.list (GET) → items with ISO dates', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.list')) {
        return trpcData({
          items: [
            {
              key: 'req:1',
              authorUserId: 7,
              value: { title: 'Dark mode', body: 'please' },
              count: 3,
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-02T00:00:00.000Z',
            },
          ],
          nextCursor: 'bmV4dA==',
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('SHARED_LIST', { requestId: 'r-l', prefix: 'req:', limit: 5 });
    const payload = await waitForMessage(inbound, 'SHARED_LIST_RESULT');
    expect(payload.requestId).toBe('r-l');
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items[0].key).toBe('req:1');
    expect(items[0].count).toBe(3);
    expect(items[0].createdAt).toBe('2026-05-01T00:00:00.000Z');
    expect(payload.nextCursor).toBe('bmV4dA==');

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.shared.list'))!;
    expect((call[1] as RequestInit).method).toBe('GET');
    expect(decodeInputParam(String(call[0]))).toEqual({
      json: { blockToken: TOKEN, limit: 5, prefix: 'req:' },
    });
  });

  it('SHARED_GET_COUNT → apps.shared.getCount (GET) → count', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.getCount')) return trpcData({ count: 42 });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_GET_COUNT', { requestId: 'r-c', key: 'req:1' });
    const payload = await waitForMessage(inbound, 'SHARED_GET_COUNT_RESULT');
    expect(payload.count).toBe(42);
  });

  it('SHARED_GET_COUNTS → apps.shared.getCounts (GET) → counts map', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.getCounts')) return trpcData({ counts: { a: 1, b: 0 } });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_GET_COUNTS', { requestId: 'r-cs', keys: ['a', 'b'] });
    const payload = await waitForMessage(inbound, 'SHARED_GET_COUNTS_RESULT');
    expect(payload.counts).toEqual({ a: 1, b: 0 });
  });

  it('SHARED_APPEND → apps.shared.append (POST) → key', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.append')) return trpcData({ key: 'shared_9' });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_APPEND', { requestId: 'r-a', value: { title: 't' } });
    const payload = await waitForMessage(inbound, 'SHARED_APPEND_RESULT');
    expect(payload.key).toBe('shared_9');
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('apps.shared.append'))!;
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { blockToken: TOKEN, value: { title: 't' } },
    });
  });

  it('SHARED_VOTE → apps.shared.vote (POST) → count', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.vote')) return trpcData({ count: 5 });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_VOTE', { requestId: 'r-v', key: 'req:1' });
    const payload = await waitForMessage(inbound, 'SHARED_VOTE_RESULT');
    expect(payload.count).toBe(5);
  });

  it('SHARED_UNVOTE → apps.shared.unvote (POST) → count', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.unvote')) return trpcData({ count: 4 });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_UNVOTE', { requestId: 'r-uv', key: 'req:1' });
    const payload = await waitForMessage(inbound, 'SHARED_UNVOTE_RESULT');
    expect(payload.count).toBe(4);
  });

  it('SHARED_UPDATE → apps.shared.update (POST) → ok', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.update')) return trpcData({ ok: true });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_UPDATE', { requestId: 'r-u', key: 'req:1', value: { title: 't2' } });
    const payload = await waitForMessage(inbound, 'SHARED_UPDATE_RESULT');
    expect(payload.ok).toBe(true);
  });

  it('SHARED_WITHDRAW → apps.shared.withdraw (POST) → ok + deleted', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.withdraw')) return trpcData({ ok: true, deleted: true });
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_WITHDRAW', { requestId: 'r-w', key: 'req:1' });
    const payload = await waitForMessage(inbound, 'SHARED_WITHDRAW_RESULT');
    expect(payload.ok).toBe(true);
    expect(payload.deleted).toBe(true);
  });

  it('SHARED_VOTE backend error → error reply (never hangs)', async () => {
    installWithFetch(async (url) => {
      if (url.includes('apps.shared.vote')) return trpcErr('FORBIDDEN', 403);
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SHARED_VOTE', { requestId: 'r-ve', key: 'req:1' });
    const payload = await waitForMessage(inbound, 'SHARED_VOTE_RESULT');
    expect(payload.error).toBe('FORBIDDEN');
    expect(payload.count).toBe(0);
  });
});

describe('createLiveHost — OPEN_IMAGE_UPLOAD (no headless upload contract)', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('replies IMAGE_UPLOAD_RESULT dismissed (no `selected`) instead of hanging', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = createLiveHost({
      blockToken: fakeJwt(DEFAULT_CLAIMS),
      viewer: { id: 42, username: 'dev-mod' },
      fetchImpl: (async () => {
        throw new Error('no network expected for OPEN_IMAGE_UPLOAD');
      }) as unknown as typeof fetch,
    });
    uninstall = host.install();
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('OPEN_IMAGE_UPLOAD', { requestId: 'r-img' });
    const payload = await waitForMessage(inbound, 'IMAGE_UPLOAD_RESULT');
    expect(payload.requestId).toBe('r-img');
    // Dismissed: no `selected` → the hook resolves to null (no fabricated image).
    expect('selected' in payload).toBe(false);
  });
});

describe('createLiveHost — app subqueue (served via blocks.queryAppWorkflows / cancelAppWorkflow)', () => {
  let uninstall: (() => void) | undefined;
  let inbound: ReturnType<typeof collectInbound>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const TOKEN = fakeJwt(DEFAULT_CLAIMS);

  const DONE = {
    workflowId: 'wf_1',
    status: 'succeeded',
    images: [{ url: 'https://image.civitai.com/x/a.jpeg', width: 1024, height: 1024, nsfwLevel: 1 }],
    cost: 12,
    createdAt: '2026-07-14T12:00:00.000Z',
  };

  function installWithFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    fetchMock = vi.fn(impl);
    const host = createLiveHost({
      blockToken: TOKEN,
      viewer: { id: 42, username: 'dev-mod' }, // skip /blocks/me
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    uninstall = host.install();
  }

  beforeEach(() => {
    inbound = collectInbound();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    inbound.stop();
    vi.restoreAllMocks();
  });

  it('QUERY_APP_WORKFLOWS → blocks.queryAppWorkflows (POST, params spread first, token last) → result', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.queryAppWorkflows')) {
        return trpcData({ workflows: [DONE], cursor: 'next-abc' });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('QUERY_APP_WORKFLOWS', { requestId: 'r-q', params: { limit: 20, cursor: 'c0' } });
    const payload = await waitForMessage(inbound, 'APP_WORKFLOWS_RESULT');
    expect(payload.requestId).toBe('r-q');
    expect(payload.result).toEqual({ workflows: [DONE], cursor: 'next-abc' });
    expect(payload.error).toBeUndefined();

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('blocks.queryAppWorkflows'))!;
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(String(call[0])).toBe('https://civitai.com/api/trpc/blocks.queryAppWorkflows');
    expect((call[1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    // params spread FIRST, blockToken LAST (non-overridable). No `tags` field.
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { limit: 20, cursor: 'c0', blockToken: TOKEN },
    });
  });

  it('CANCEL_APP_WORKFLOW → blocks.cancelAppWorkflow (POST { blockToken, workflowId }) → result', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.cancelAppWorkflow')) {
        return trpcData({ workflow: { ...DONE, status: 'canceled' } });
      }
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('CANCEL_APP_WORKFLOW', { requestId: 'r-c', workflowId: 'wf_1' });
    const payload = await waitForMessage(inbound, 'CANCEL_APP_WORKFLOW_RESULT');
    expect(payload.requestId).toBe('r-c');
    expect((payload.result as { workflow: { status: string } }).workflow.status).toBe('canceled');
    expect(payload.error).toBeUndefined();

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('blocks.cancelAppWorkflow'))!;
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      json: { blockToken: TOKEN, workflowId: 'wf_1' },
    });
  });

  it('a backend error maps to the error-shape reply (no hang) for both bridges', async () => {
    installWithFetch(async (url) => {
      if (url.includes('blocks.queryAppWorkflows')) return trpcErr('block lacks ai:write:budgeted scope', 403);
      if (url.includes('blocks.cancelAppWorkflow')) return trpcErr('workflow is not in this app subqueue', 403);
      throw new Error(`unexpected ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('QUERY_APP_WORKFLOWS', { requestId: 'r-qe' });
    const qp = await waitForMessage(inbound, 'APP_WORKFLOWS_RESULT');
    expect(qp.result).toBeUndefined();
    expect(qp.error).toMatch(/ai:write:budgeted/);

    post('CANCEL_APP_WORKFLOW', { requestId: 'r-ce', workflowId: 'wf_1' });
    const cp = await waitForMessage(inbound, 'CANCEL_APP_WORKFLOW_RESULT');
    expect(cp.result).toBeUndefined();
    expect(cp.error).toMatch(/not in this app subqueue/);
  });

  it('a QUERY with no requestId is dropped WITHOUT a backend call', async () => {
    installWithFetch(async (url) => {
      throw new Error(`should not have fetched ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('QUERY_APP_WORKFLOWS', {});
    await new Promise((r) => setTimeout(r, 50));
    expect(inbound.messages.some((m) => m.type === 'APP_WORKFLOWS_RESULT')).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('blocks.queryAppWorkflows'))).toBe(false);
  });

  it('a CANCEL with a missing/empty workflowId is dropped WITHOUT a backend call', async () => {
    installWithFetch(async (url) => {
      throw new Error(`should not have fetched ${url}`);
    });
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('CANCEL_APP_WORKFLOW', { requestId: 'r-c', workflowId: '' });
    await new Promise((r) => setTimeout(r, 50));
    expect(inbound.messages.some((m) => m.type === 'CANCEL_APP_WORKFLOW_RESULT')).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('blocks.cancelAppWorkflow'))).toBe(false);
  });
});
