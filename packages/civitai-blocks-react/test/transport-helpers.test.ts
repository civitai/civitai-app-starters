import { describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, WrappedToken } from '@civitai/app-sdk/blocks';

import {
  EMPTY_SNAPSHOT,
  generateIdempotencyKey,
  nextRequestId,
  sendTypedRequest,
  snapshotFromInit,
  tokenFromWrapped,
  type BlockTransport,
} from '../src/internal/transport.js';

/**
 * Pure helpers in transport.ts (snapshotFromInit / tokenFromWrapped /
 * nextRequestId / EMPTY_SNAPSHOT / sendTypedRequest) are exercised INDIRECTLY by
 * iframe-transport.test.ts, but never pinned directly. These are the load-
 * bearing wire→runtime conversions (esp. tokenFromWrapped, which must carry
 * scopes + buzzBudget, not just raw/expiresAt), so pin them here.
 */

function wrapped(overrides: Partial<WrappedToken> = {}): WrappedToken {
  return {
    raw: 'jwt-abc',
    scopes: ['models:read:self', 'ai:write:budgeted'],
    expiresAt: '2030-01-01T00:00:00.000Z',
    buzzBudget: 1234,
    ...overrides,
  };
}

function buildInit(overrides: Partial<BlockInitPayload> = {}): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'my-block',
    appId: 'app_test',
    token: wrapped(),
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: { a: 1 }, userSettings: { b: 2 } },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'iframe',
    ...overrides,
  };
}

describe('tokenFromWrapped', () => {
  it('rehydrates the ISO expiresAt into a Date and carries scopes + buzzBudget', () => {
    const token = tokenFromWrapped(wrapped());
    expect(token.raw).toBe('jwt-abc');
    expect(token.scopes).toEqual(['models:read:self', 'ai:write:budgeted']);
    expect(token.buzzBudget).toBe(1234);
    expect(token.expiresAt).toBeInstanceOf(Date);
    expect(token.expiresAt.toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('leaves buzzBudget undefined when the wrapped token omits it', () => {
    const token = tokenFromWrapped(wrapped({ buzzBudget: undefined }));
    expect(token.buzzBudget).toBeUndefined();
  });
});

describe('snapshotFromInit', () => {
  it('maps a BLOCK_INIT payload to a ready snapshot with every field', () => {
    const snap = snapshotFromInit(buildInit());
    expect(snap.ready).toBe(true);
    expect(snap.renderMode).toBe('iframe');
    expect(snap.context).toEqual({ slotId: 'model.sidebar_top', modelId: 42 });
    expect(snap.settings).toEqual({ publisherSettings: { a: 1 }, userSettings: { b: 2 } });
    expect(snap.viewer).toEqual({ id: 7, username: 'alice', status: 'active' });
    expect(snap.theme).toBe('dark');
    expect(snap.blockInstanceId).toBe('inst-1');
    expect(snap.blockId).toBe('my-block');
    expect(snap.appId).toBe('app_test');
    expect(snap.token.expiresAt).toBeInstanceOf(Date);
  });

  it('carries the #2670 domain + maxBrowsingLevel fields when present', () => {
    const snap = snapshotFromInit(buildInit({ domain: 'red', maxBrowsingLevel: 31 }));
    expect(snap.domain).toBe('red');
    expect(snap.maxBrowsingLevel).toBe(31);
  });

  it('leaves domain + maxBrowsingLevel undefined for a host predating #2670', () => {
    const snap = snapshotFromInit(buildInit());
    expect(snap.domain).toBeUndefined();
    expect(snap.maxBrowsingLevel).toBeUndefined();
  });
});

describe('EMPTY_SNAPSHOT', () => {
  it('is the not-ready sentinel with safe defaults', () => {
    expect(EMPTY_SNAPSHOT.ready).toBe(false);
    expect(EMPTY_SNAPSHOT.viewer).toBeNull();
    expect(EMPTY_SNAPSHOT.context.slotId).toBe('');
    expect(EMPTY_SNAPSHOT.token.raw).toBe('');
    expect(EMPTY_SNAPSHOT.token.scopes).toEqual([]);
    expect(EMPTY_SNAPSHOT.settings).toEqual({ publisherSettings: {}, userSettings: {} });
  });
});

describe('nextRequestId', () => {
  it('is monotonic (a later id sorts after an earlier one by its counter suffix)', () => {
    const a = nextRequestId();
    const b = nextRequestId();
    const counterOf = (id: string) => Number(id.split('-')[1]);
    expect(counterOf(b)).toBe(counterOf(a) + 1);
  });

  it('has a random prefix so concurrent instances do not collide', () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextRequestId()));
    expect(ids.size).toBe(50);
    // shape: `<6-char base36>-<counter>`
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{1,6}-\d+$/);
  });
});

describe('generateIdempotencyKey', () => {
  // The civitai host restricts the money-POST idempotency key to `^[A-Za-z0-9_-]{1,200}$`
  // (audit 🟢) and 400s anything else. Every key this helper emits MUST clear that
  // charset — otherwise a workflow submit / tip would be rejected at the input.
  const SERVER_CHARSET = /^[A-Za-z0-9_-]{1,200}$/;

  it('emits crypto.randomUUID() when available, and it clears the server charset', () => {
    // Happy path: a secure context provides crypto.randomUUID.
    const key = generateIdempotencyKey();
    expect(key).toMatch(SERVER_CHARSET);
  });

  it('the RANDOM FALLBACK (no crypto.randomUUID) also clears the server charset', () => {
    // Force the fallback branch (older webview / non-secure context / test env).
    const original = globalThis.crypto;
    try {
      // @ts-expect-error — intentionally remove crypto to exercise the fallback.
      delete (globalThis as { crypto?: unknown }).crypto;
      for (let i = 0; i < 50; i++) {
        expect(generateIdempotencyKey()).toMatch(SERVER_CHARSET);
      }
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });

  it('is UNIQUE per call (each call is a distinct logical operation — audit 🟡-3 rationale)', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(100);
  });
});

describe('sendTypedRequest', () => {
  it('delegates to transport.sendRequest and returns its resolved payload', async () => {
    const fakePayload = { requestId: 'r1', balance: { blue: 1, green: 2, yellow: 3 } };
    const sendRequest = vi.fn().mockResolvedValue(fakePayload);
    const transport = { sendRequest } as unknown as BlockTransport;

    const res = await sendTypedRequest(
      transport,
      { type: 'GET_BUZZ_BALANCE', payload: {} },
      'BUZZ_BALANCE_RESULT',
    );
    expect(res).toBe(fakePayload);
    expect(sendRequest).toHaveBeenCalledWith(
      { type: 'GET_BUZZ_BALANCE', payload: {} },
      'BUZZ_BALANCE_RESULT',
      undefined,
    );
  });

  it('forwards the timeout option through to the transport', async () => {
    const sendRequest = vi.fn().mockResolvedValue({});
    const transport = { sendRequest } as unknown as BlockTransport;
    await sendTypedRequest(
      transport,
      { type: 'OPEN_CHECKPOINT_PICKER', payload: { baseModelGroup: 'SDXL' } },
      'CHECKPOINT_PICKER_RESULT',
      { timeoutMs: 600_000 },
    );
    expect(sendRequest).toHaveBeenCalledWith(
      { type: 'OPEN_CHECKPOINT_PICKER', payload: { baseModelGroup: 'SDXL' } },
      'CHECKPOINT_PICKER_RESULT',
      { timeoutMs: 600_000 },
    );
  });

  it('propagates a transport rejection (e.g. request timeout)', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('timed out after 30000ms'));
    const transport = { sendRequest } as unknown as BlockTransport;
    await expect(
      sendTypedRequest(transport, { type: 'GET_BUZZ_BALANCE', payload: {} }, 'BUZZ_BALANCE_RESULT'),
    ).rejects.toThrow('timed out after 30000ms');
  });
});
