import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeCode, refreshToken } from '../src/oauth/token.js';
import { hasScope, scopesFromBitmask, TokenScope } from '../src/scopes/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Every fixture below picks a scope combination that is pairwise distinct from
 * every other fixture AND distinct from every bitmask literal named in any
 * assertion, so a mutant that hardcodes one literal cannot survive by
 * coincidence. In particular none of them equals `TokenScopePresets.AIServices`
 * (114689) except the case that deliberately asserts it.
 */

const baseOpts = {
  clientId: 'cid',
  redirectUri: 'https://app.example/cb',
  codeVerifier: 'verifier',
};

function tokenBody(scope: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {
    access_token: 'at',
    refresh_token: 'rt',
    expires_in: 3600,
    token_type: 'Bearer',
  };
  if (scope !== undefined) body.scope = scope;
  return body;
}

async function exchangeWithScope(scope: unknown, fallbackScope?: number) {
  fetchMock.mockResolvedValueOnce(jsonResponse(tokenBody(scope)));
  return exchangeCode({ ...baseOpts, code: 'c', ...(fallbackScope === undefined ? {} : { fallbackScope }) });
}

describe('shapeTokens scope parsing (LB-E / #326)', () => {
  // ---- REGRESSION: the RFC 6749 §5.1 space-delimited-name form ----
  it('parses a space-delimited list of scope NAMES into the OR of their bits', async () => {
    // UserWrite(2) | MediaDelete(128) | VaultRead(8388608) === 8388738
    const tokens = await exchangeWithScope('UserWrite MediaDelete VaultRead');
    expect(tokens.scope).toBe(8388738);
  });

  it('never yields NaN for a name list, so hasScope answers true for each granted scope', async () => {
    const tokens = await exchangeWithScope('UserWrite MediaDelete VaultRead');
    expect(Number.isFinite(tokens.scope)).toBe(true);
    expect(hasScope(tokens.scope, TokenScope.UserWrite)).toBe(true);
    expect(hasScope(tokens.scope, TokenScope.MediaDelete)).toBe(true);
    expect(hasScope(tokens.scope, TokenScope.VaultRead)).toBe(true);
    // and is not over-broad
    expect(hasScope(tokens.scope, TokenScope.UserRead)).toBe(false);
  });

  it('round-trips a name list back through scopesFromBitmask', async () => {
    const tokens = await exchangeWithScope('UserWrite MediaDelete VaultRead');
    expect(scopesFromBitmask(tokens.scope)).toEqual(['UserWrite', 'MediaDelete', 'VaultRead']);
  });

  it('tolerates irregular whitespace in a name list', async () => {
    const tokens = await exchangeWithScope('  UserWrite\tMediaDelete   VaultRead  ');
    expect(tokens.scope).toBe(8388738);
  });

  // ---- REGRESSION: a space-delimited list of decimal values ----
  it('ORs a space-delimited list of decimal scope values', async () => {
    // ModelsRead(4) | ArticlesWrite(512) | AIServicesRead(16384) === 16900
    const tokens = await exchangeWithScope('4 512 16384');
    expect(tokens.scope).toBe(16900);
  });

  // ---- REGRESSION: unparseable must throw, not silently degrade ----
  it('throws naming the offending value when a name is unrecognised', async () => {
    await expect(exchangeWithScope('UserWrite NotAScope')).rejects.toThrow(/NotAScope/);
  });

  it('throws naming the offending value for a wholly unparseable scope', async () => {
    await expect(exchangeWithScope('???')).rejects.toThrow(/\?\?\?/);
  });

  it('throws on a negative decimal rather than producing a negative bitmask', async () => {
    await expect(exchangeWithScope('-5')).rejects.toThrow(/-5/);
  });

  it('throws on a non-integer decimal', async () => {
    await expect(exchangeWithScope('1.5')).rejects.toThrow(/1\.5/);
  });

  // The two guards below are reached by DISJOINT inputs on purpose. `'-5'` and
  // `'1.5'` above are rejected by the digits-only regex before the range check
  // ever runs, so they cannot detect a broken range check — and vice versa.

  // Reaches ONLY the range check: no string parsing is involved at all.
  it('throws on a negative JSON number scope (range check, no regex involved)', async () => {
    await expect(exchangeWithScope(-5)).rejects.toThrow(/-5/);
  });

  it('throws on a fractional JSON number scope', async () => {
    await expect(exchangeWithScope(1.5)).rejects.toThrow(/1\.5/);
  });

  // Reaches ONLY the range check: digits-only, so the regex accepts it, but the
  // value would wrap to 0 under `|`. Must throw, not silently become 0.
  it('throws on a digits-only value too large for a 31-bit bitmask', async () => {
    await expect(exchangeWithScope('4294967296')).rejects.toThrow(/4294967296/);
  });

  // Reaches ONLY the digits-only regex: `Number('0x20')` is 32, a perfectly
  // valid in-range bitmask, so the range check would wave it through.
  it('throws on a hex-looking token rather than silently accepting Number() coercion', async () => {
    await expect(exchangeWithScope('0x20')).rejects.toThrow(/0x20/);
  });

  it('throws on exponent notation rather than silently accepting it', async () => {
    await expect(exchangeWithScope('1e3')).rejects.toThrow(/1e3/);
  });

  it('treats an explicit null scope as absent, not as an error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"access_token":"at","scope":null}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const tokens = await exchangeCode({ ...baseOpts, code: 'c', fallbackScope: 33 });
    expect(tokens.scope).toBe(33);
  });

  it('throws on a scope of the wrong type entirely', async () => {
    await expect(exchangeWithScope({ granted: ['UserRead'] })).rejects.toThrow(/granted/);
  });

  // ---- INVARIANT GUARDS (green at 66f9e09 too — NOT regression coverage) ----
  // These pin the numeric forms Civitai documents today, which `Number()`
  // already handled. They exist so the new parser cannot regress the path that
  // actually works in production; they never reproduced #326.
  it('[invariant guard] parses the decimal-integer-as-string form Civitai documents', async () => {
    // developer.civitai.com/site/oauth/endpoints documents `"scope": "114689"`.
    const tokens = await exchangeWithScope('114689');
    expect(tokens.scope).toBe(114689);
  });

  it('[invariant guard] passes through a real JSON number unchanged', async () => {
    const tokens = await exchangeWithScope(2097152);
    expect(tokens.scope).toBe(2097152);
  });

  // ---- absent scope: not an error; this is what fallbackScope is for ----
  it('uses fallbackScope when the server omits scope entirely', async () => {
    // UserRead(1) | MediaRead(32) === 33
    const tokens = await exchangeWithScope(undefined, 33);
    expect(tokens.scope).toBe(33);
  });

  it('uses fallbackScope for an empty-string scope', async () => {
    const tokens = await exchangeWithScope('   ', 33);
    expect(tokens.scope).toBe(33);
  });

  // Green at 66f9e09 too — an invariant guard, not regression coverage. It
  // pins that wiring `fallbackScope` up did NOT change the no-fallback default.
  it('[invariant guard] yields 0 when scope is omitted and no fallbackScope was supplied', async () => {
    const tokens = await exchangeWithScope(undefined);
    expect(tokens.scope).toBe(0);
  });

  // ---- refreshToken shares the same parser and the same fallback wiring ----
  it('refreshToken parses a name list identically', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(tokenBody('ModelsWrite BountiesRead')));
    // ModelsWrite(8) | BountiesRead(2048) === 2056
    const tokens = await refreshToken({ clientId: 'cid', refreshToken: 'rt' });
    expect(tokens.scope).toBe(2056);
  });

  it('refreshToken falls back to the previously granted scope when scope is omitted', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(tokenBody(undefined)));
    const tokens = await refreshToken({ clientId: 'cid', refreshToken: 'rt', fallbackScope: 2056 });
    expect(tokens.scope).toBe(2056);
  });
});
