import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeCode, refreshToken } from '../src/oauth/token.js';

/**
 * Coverage for `shapeTokens`' handling of `OAuthTokenResponse.scope` (#326).
 *
 * `parseScope` is deliberately NOT exported — every case below reaches it the
 * way a real caller does, through `exchangeCode` / `refreshToken`.
 *
 * Red/green matrix in the PR body. Two base refs matter:
 *   - `66f9e09` — before the fix. `Number()` with no guard.
 *   - `fd31070` — the first cut of this PR, which THREW `OAuthScopeError`
 *     (`status = 200`) on an unusable scope, so all four starters rendered
 *     `/?error=token_exchange:200`. Cases asserting "resolves" are regression
 *     coverage against that, not just against `66f9e09`.
 * Cases labelled `[invariant guard]` are green at `66f9e09` and are NOT
 * counted as regression coverage.
 *
 * Fixture values are pairwise distinct and distinct from every literal any
 * assertion names, so a mutant that hardcodes one cannot survive by
 * coincidence.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn();
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseOpts = {
  clientId: 'cid',
  redirectUri: 'https://app.example/cb',
  codeVerifier: 'verifier',
};

/** `scope: undefined` means "the server omitted the field entirely". */
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
  return exchangeCode({
    ...baseOpts,
    code: 'c',
    ...(fallbackScope === undefined ? {} : { fallbackScope }),
  });
}

describe('shapeTokens scope parsing (LB-E / #326)', () => {
  // ---- the #326 shape: RFC 6749 §5.1 space-delimited names --------------
  // The literal worked example from issue #326. `Number()` of it is NaN, and
  // `NaN & x` is 0, so every `hasScope()` answered false for a user who had
  // just consented. These names are RFC-style, not this SDK's PascalCase TS
  // keys, so no name table could have resolved them either.
  const RFC_SCOPE = 'ai:write:budgeted user:read:self';

  it('resolves an RFC-shaped scope to fallbackScope instead of NaN', async () => {
    const tokens = await exchangeWithScope(RFC_SCOPE, 33);
    expect(tokens.scope).toBe(33);
  });

  it('resolves an RFC-shaped scope to 0, never NaN, with no fallbackScope', async () => {
    const tokens = await exchangeWithScope(RFC_SCOPE);
    expect(tokens.scope).toBe(0);
    expect(Number.isNaN(tokens.scope)).toBe(false);
  });

  it('warns once, naming the value received, when a scope is unusable', async () => {
    await exchangeWithScope(RFC_SCOPE, 33);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain(RFC_SCOPE);
    expect(message).toContain('33');
  });

  // Regression against `fd31070`, which threw `OAuthScopeError` with
  // `status = 200` here — every starter renders `token_exchange:${err.status}`,
  // so an unreadable scope became `/?error=token_exchange:200`: a hard login
  // failure captioned with a success code.
  it('RESOLVES on an unusable scope rather than rejecting the whole exchange', async () => {
    await expect(exchangeWithScope(RFC_SCOPE, 33)).resolves.toMatchObject({
      access_token: 'at',
      scope: 33,
    });
  });

  // ---- the range guard, four distinct rejections ------------------------
  // Each fixture reaches a different clause of the guard, so a mutant that
  // drops one clause dies on its own case.

  it('rejects a negative scope rather than yielding a negative bitmask', async () => {
    const tokens = await exchangeWithScope(-5, 33);
    expect(tokens.scope).toBe(33);
  });

  it('rejects a fractional scope', async () => {
    const tokens = await exchangeWithScope(1.5, 33);
    expect(tokens.scope).toBe(33);
  });

  it('rejects a value too large for a 31-bit signed bitmask', async () => {
    // 2**32 — well clear of the 2**31-1 ceiling, so the case cannot pass by
    // landing on the boundary itself.
    const tokens = await exchangeWithScope('4294967296', 33);
    expect(tokens.scope).toBe(33);
  });

  it('rejects a non-finite scope', async () => {
    const tokens = await exchangeWithScope('Infinity', 33);
    expect(tokens.scope).toBe(33);
  });

  it('rejects a scope of the wrong type entirely', async () => {
    const tokens = await exchangeWithScope({ granted: ['UserRead'] }, 33);
    expect(tokens.scope).toBe(33);
  });

  // ---- absent scope: not a fault; this is what fallbackScope is for -----

  it('uses fallbackScope when the server omits scope entirely', async () => {
    const tokens = await exchangeWithScope(undefined, 33);
    expect(tokens.scope).toBe(33);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats an explicit null scope as absent, not as a fault', async () => {
    const tokens = await exchangeWithScope(null, 33);
    expect(tokens.scope).toBe(33);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only scope as absent, not as "granted nothing"', async () => {
    const tokens = await exchangeWithScope('   ', 33);
    expect(tokens.scope).toBe(33);
  });

  // ---- refreshToken shares the parser and the fallback wiring -----------

  it('refreshToken falls back to the previously granted scope when scope is omitted', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(tokenBody(undefined)));
    const tokens = await refreshToken({ clientId: 'cid', refreshToken: 'rt', fallbackScope: 2056 });
    expect(tokens.scope).toBe(2056);
  });

  it('refreshToken keeps the previously granted scope when scope is unusable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(tokenBody(RFC_SCOPE)));
    const tokens = await refreshToken({ clientId: 'cid', refreshToken: 'rt', fallbackScope: 2056 });
    expect(tokens.scope).toBe(2056);
  });

  // ---- INVARIANT GUARDS (green at 66f9e09 — NOT regression coverage) ----
  // These pin the forms Civitai documents today, which `Number()` already
  // handled. They exist so the guard cannot regress the path that works in
  // production; they never reproduced #326.

  it('[invariant guard] parses the decimal-integer-as-string form Civitai documents', async () => {
    // developer.civitai.com/site/oauth/endpoints documents `"scope": "114689"`.
    const tokens = await exchangeWithScope('114689');
    expect(tokens.scope).toBe(114689);
  });

  it('[invariant guard] passes through a real JSON number unchanged', async () => {
    const tokens = await exchangeWithScope(2097152);
    expect(tokens.scope).toBe(2097152);
  });

  it('[invariant guard] does not warn for a scope it can read', async () => {
    await exchangeWithScope('114689');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('[invariant guard] yields 0 when scope is omitted and no fallbackScope was supplied', async () => {
    const tokens = await exchangeWithScope(undefined);
    expect(tokens.scope).toBe(0);
  });
});
