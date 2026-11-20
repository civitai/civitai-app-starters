import { describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, WrappedToken } from '@civitai/app-sdk/blocks';

import { BLOCK_IDEMPOTENCY_KEY_REGEX } from '@civitai/app-sdk/blocks';

import {
  EMPTY_SNAPSHOT,
  InvalidIdempotencyKeyError,
  generateIdempotencyKey,
  nextRequestId,
  resolveIdempotencyKey,
  sendTypedRequest,
  snapshotFromInit,
  tokenFromWrapped,
  type BlockTransport,
} from '../src/transport/transport.js';

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
  // The civitai host restricts the money-POST idempotency key to `^[A-Za-z0-9_-]{1,64}$`
  // and 400s anything else. Every key this helper emits MUST clear that charset —
  // otherwise a workflow submit / tip is rejected at the input.
  //
  // 🔴 THESE THREE CASES COVER THE HALF THAT CANNOT FAIL, AND THAT IS NOT A
  // CRITICISM OF THEM — IT IS THE SCOPE THEY HAVE. `crypto.randomUUID()` (36
  // chars) and the `idem-<base36>` fallback (~35) both conform BY CONSTRUCTION
  // and never could not, so no mutation of the generator that keeps it a
  // generator can make them red. They pin the generator; they say NOTHING about
  // a CALLER-SUPPLIED key, which is the half that actually broke in production
  // (2026-10-02: `sheetId:panelId:nonce`, every save 400'd, 201 local tests
  // green). That gap is covered by the `resolveIdempotencyKey` block below, by
  // `mockHostIdempotency.test.tsx` at the protocol layer, and by
  // `TipButton.test.tsx` for the one key this package composes itself.
  //
  // The 64 bound is derived, not arbitrary: the host composes the orchestrator
  // `externalId` as `blk<NN><appBlockId><key>`, and the orchestrator enforces
  // `^[A-Za-z0-9_-]+$` with max 128 (WorkflowTemplate.cs). 64 keeps the worst-case
  // composition inside 128.
  //
  // 🔴 READ FROM THE VENDORED CONSTANT, NOT RE-SPELLED. A local copy of the regex
  // is what this whole arc is about: it cannot disagree with the rule the
  // runtime enforces if it IS that rule. See `@civitai/app-sdk/blocks`'
  // `idempotency.ts` for the provenance and the four host entry points.
  const SERVER_CHARSET = BLOCK_IDEMPOTENCY_KEY_REGEX;

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

/**
 * THE CALLER-SUPPLIED HALF — the one that broke production.
 *
 * `resolveIdempotencyKey` is the single hook-boundary gate: all three money
 * hooks (`useBuzzWorkflow.submit`, `useTip.tip`, `useGoodPurchase.purchase`)
 * route their `options?.idempotencyKey` through it, so these cases are the
 * contract for every one of them.
 *
 * 🔴 EACH CASE IS A DISTINCT REJECTION REASON, NOT FOUR SPELLINGS OF ONE. The
 * fixtures are pairwise distinct and none can only ever produce the asserted
 * constant's own value: the colon key is in-bounds for length and fails on
 * charset, the 65-char key is in-charset and fails on length, the empty string
 * fails on neither charset nor the 64 ceiling, and `"key with space"` fails on a
 * character that is NOT a colon — which is what stops the charset assertions
 * from passing only because they happen to mention ':'.
 */
describe('resolveIdempotencyKey — the caller-supplied key', () => {
  it('🔴 refuses the EXACT reported production shape `sheetId:panelId:nonce`', () => {
    // The real key that 400'd: in-charset apart from the delimiters, well under
    // 64 chars, and completely reasonable-looking. Nothing but the charset rule
    // rejects it.
    const bad = 'sheet_42:panel_7:a1b2c3';
    expect(bad.length).toBeLessThanOrEqual(64); // not a length failure
    expect(() => resolveIdempotencyKey('useBuzzWorkflow.submit', bad)).toThrow(
      InvalidIdempotencyKeyError,
    );
  });

  it('names the colon specifically, and says why it is excluded', () => {
    let caught: unknown;
    try {
      resolveIdempotencyKey('useBuzzWorkflow.submit', 'sheet_42:panel_7:a1b2c3');
    } catch (err) {
      caught = err;
    }
    const err = caught as InvalidIdempotencyKeyError;
    expect(err.message).toContain('":"');
    expect(err.message).toContain('delimiter');
    // De-duplicated: two colons in the value, one complaint.
    expect(err.message.match(/":"/g)).toHaveLength(1);
  });

  it('🔴 says NOTHING WAS SPENT — the money claim this error exists to carry', () => {
    let caught: unknown;
    try {
      resolveIdempotencyKey('useBuzzWorkflow.submit', 'a:b');
    } catch (err) {
      caught = err;
    }
    const err = caught as InvalidIdempotencyKeyError;
    // Refused BEFORE the send, so unlike every other rejection on these hooks
    // this one is unambiguous about money. See the class's docblock.
    expect(err.message).toContain('Nothing was sent and nothing was spent');
    expect(err.name).toBe('InvalidIdempotencyKeyError');
    expect(err.source).toBe('useBuzzWorkflow.submit');
    expect(err.idempotencyKey).toBe('a:b');
  });

  it('🔴 REFUSES rather than SANITISING — the key is never rewritten', () => {
    // The whole point: a sanitising implementation would RETURN 'a_b' (or 'ab')
    // and the caller would never know its identity had been changed under it.
    // Two distinct logical submits could then collapse onto one slot, or a retry
    // could be normalised differently from its first attempt and mint a SECOND
    // reservation. So the assertion is that it THROWS, not that it cleans up.
    expect(() => resolveIdempotencyKey('useTip.tip', 'a:b')).toThrow();
    // And it also must not have silently succeeded with a cleaned value.
    let returned: string | undefined;
    try {
      returned = resolveIdempotencyKey('useTip.tip', 'a:b');
    } catch {
      returned = undefined;
    }
    expect(returned).toBeUndefined();
  });

  it('refuses a 65-char key, naming the length and the bound (in-charset, so length is the only fault)', () => {
    const tooLong = 'a'.repeat(65);
    expect(BLOCK_IDEMPOTENCY_KEY_REGEX.test('a'.repeat(64))).toBe(true); // boundary: 64 is fine
    let caught: unknown;
    try {
      resolveIdempotencyKey('useGoodPurchase.purchase', tooLong);
    } catch (err) {
      caught = err;
    }
    const err = caught as InvalidIdempotencyKeyError;
    // 🔴 THE REASON CLAUSE, NOT A SUBSTRING THAT ALSO APPEARS IN BOILERPLATE.
    // Every message ends with "…at most 64 characters.", so asserting
    // `toContain('at most 64')` would pass for EVERY rejection — including the
    // empty-string one. Caught by the empty-string case below going red on
    // exactly that mistake. Pin the clause this arm actually generates.
    expect(err.message).toMatch(/it is 65 characters \(the host allows at most 64\)/);
    // NOT a charset complaint — 'a' is in the class. This is what keeps the
    // length arm from passing because of the charset arm.
    expect(err.message).not.toContain('it contains');
  });

  it('refuses the EMPTY string, which fails neither the charset nor the 64 ceiling', () => {
    let caught: unknown;
    try {
      resolveIdempotencyKey('useTip.tip', '');
    } catch (err) {
      caught = err;
    }
    const err = caught as InvalidIdempotencyKeyError;
    expect(err.message).toContain('it is empty');
    // Neither of the other two arms fired. Matched against the REASON clauses,
    // not against boilerplate every message carries.
    expect(err.message).not.toMatch(/it is \d+ characters/);
    expect(err.message).not.toContain('it contains');
  });

  it('refuses a character outside the class that is NOT a colon (a space)', () => {
    let caught: unknown;
    try {
      resolveIdempotencyKey('useTip.tip', 'key with space');
    } catch (err) {
      caught = err;
    }
    const err = caught as InvalidIdempotencyKeyError;
    expect(err.message).toContain('" "');
    // The colon-specific explanation must NOT appear for a non-colon fault,
    // or the colon assertions elsewhere would be passing on boilerplate.
    expect(err.message).not.toContain('delimiter');
  });

  it('🔴 ACCEPTS a valid caller key and returns it UNCHANGED — the gate is reachable, not a blanket deny', () => {
    // Underscores, hyphens, digits and letters, 64 chars exactly at the boundary.
    const good = 'sheet_42-panel_7-a1b2c3';
    expect(resolveIdempotencyKey('useBuzzWorkflow.submit', good)).toBe(good);
    const atBound = 'k'.repeat(64);
    expect(resolveIdempotencyKey('useBuzzWorkflow.submit', atBound)).toBe(atBound);
  });

  it('🔴 MINTS a key when the caller supplies none, and does NOT validate absence', () => {
    // `undefined` means "mint one for me" — the ordinary case for every block
    // that never passes a key. Routing it into the predicate would refuse
    // almost every submit in the suite.
    const minted = resolveIdempotencyKey('useBuzzWorkflow.submit', undefined);
    expect(minted).toMatch(BLOCK_IDEMPOTENCY_KEY_REGEX);
    expect(minted.length).toBeGreaterThan(0);
    // Distinct per call, like the generator it delegates to.
    expect(resolveIdempotencyKey('useBuzzWorkflow.submit', undefined)).not.toBe(minted);
  });

  it('attributes the refusal to the calling hook, so a log names where to look', () => {
    for (const source of ['useBuzzWorkflow.submit', 'useTip.tip', 'useGoodPurchase.purchase']) {
      let caught: unknown;
      try {
        resolveIdempotencyKey(source, 'nope:nope');
      } catch (err) {
        caught = err;
      }
      expect((caught as InvalidIdempotencyKeyError).source).toBe(source);
      expect((caught as Error).message.startsWith(`${source}: `)).toBe(true);
    }
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
