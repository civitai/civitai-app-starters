import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 *   - replies "not supported in live v1" for storage / pickers / user-checkpoint;
 *   - opens a buzz-purchase tab and replies purchased:false.
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
    expect(payload.viewer).toEqual({ id: 42, username: 'dev-mod', status: 'active' });
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

  it('falls back to an anon-ish viewer when /blocks/me fails', async () => {
    const fetchImpl = vi.fn(async () => trpcErr('nope', 401)) as unknown as typeof fetch;
    const host = createLiveHost({ blockToken: fakeJwt(DEFAULT_CLAIMS), fetchImpl });
    uninstall = host.install();
    const payload = (await waitForMessage(inbound, 'BLOCK_INIT')) as unknown as BlockInitPayload;
    expect(payload.viewer).toMatchObject({ id: 0 });
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

  it('SET_USER_CHECKPOINT replies ok:false not-supported', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');
    post('SET_USER_CHECKPOINT', { requestId: 'r-suc', versionId: 5 });
    const payload = await waitForMessage(inbound, 'USER_CHECKPOINT_SET');
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/not supported/i);
  });

  it('APP_STORAGE_* reply with not-supported defaults', async () => {
    install();
    await waitForMessage(inbound, 'BLOCK_INIT');

    post('APP_STORAGE_GET', { requestId: 'r-g', key: 'k' });
    const get = await waitForMessage(inbound, 'APP_STORAGE_GET_RESULT');
    expect(get.value).toBeNull();
    expect(get.error).toMatch(/not supported/i);

    post('APP_STORAGE_SET', { requestId: 'r-s', key: 'k', value: 1 });
    const set = await waitForMessage(inbound, 'APP_STORAGE_SET_RESULT');
    expect(set.ok).toBe(false);
    expect(set.error).toMatch(/not supported/i);

    post('APP_STORAGE_DELETE', { requestId: 'r-d', key: 'k' });
    const del = await waitForMessage(inbound, 'APP_STORAGE_DELETE_RESULT');
    expect(del.ok).toBe(false);
    expect(del.deleted).toBe(false);

    post('APP_STORAGE_LIST', { requestId: 'r-l' });
    const list = await waitForMessage(inbound, 'APP_STORAGE_LIST_RESULT');
    expect(list.keys).toEqual([]);

    post('APP_STORAGE_QUOTA', { requestId: 'r-q' });
    const quota = await waitForMessage(inbound, 'APP_STORAGE_QUOTA_RESULT');
    expect(quota.usedBytes).toBe(0);
    expect(quota.rowCount).toBe(0);
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
    post('REQUEST_CONSENT', { scopes: ['ai:write:budgeted'] });
    await new Promise((r) => setTimeout(r, 20));
    // No reply dispatched (can't grant), but a clear warning is logged.
    expect(inbound.messages.length).toBe(before);
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/REQUEST_CONSENT/);
    expect(logged).toMatch(/civitai login --token/);
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
