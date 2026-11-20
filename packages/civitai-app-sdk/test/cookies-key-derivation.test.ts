import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `scryptSync` is a DELIBERATELY EXPENSIVE KDF — Node's defaults are N=16384,
 * r=8, which costs ~16MB of memory and tens of milliseconds of CPU per call.
 * Every `sealCookie` / `unsealCookie` on `main` @ 0b6055b paid that, per call,
 * for a salt and a secret that never change.
 *
 * Two separate claims are pinned here, and they fail for different reasons:
 *
 *  1. MEMOIZATION — the key for a given secret is derived once, not per call.
 *  2. ORDERING — an input that the cheap format checks can already reject must
 *     never reach the KDF at all. This is the half that matters to an
 *     UNAUTHENTICATED attacker: a `civ_session` cookie is attacker-controlled,
 *     so without it a request carrying crafted garbage buys an scrypt run.
 *
 * Claim 2 is tested against a FRESH module registry and a never-before-seen
 * secret, so the memo from claim 1 cannot mask it — otherwise the test would
 * pass on ordering it never exercised.
 */

const scryptSpy = vi.fn();

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    scryptSync: (...args: Parameters<typeof actual.scryptSync>) => {
      scryptSpy(...args);
      return actual.scryptSync(...args);
    },
  };
});

type CookiesModule = typeof import('../src/cookies/index.js');

/** Re-import `src/cookies` with an empty module registry, so any module-scope
 *  memo starts cold. Without this the second test would inherit the first
 *  test's warm cache and pass without ever exercising the ordering. */
async function freshCookies(): Promise<CookiesModule> {
  vi.resetModules();
  return import('../src/cookies/index.js');
}

/** 12 bytes of IV hex + 16 bytes of tag hex — exactly the lengths `unsealCookie`
 *  checks for — followed by a ciphertext field that is not valid hex, so it
 *  decodes to zero bytes. Nothing here needs a key to be rejected. */
const WELL_FORMED_PREFIX_INVALID_BODY = `${'aa'.repeat(12)}:${'bb'.repeat(16)}:zz`;

describe('cookie key derivation cost', () => {
  beforeEach(() => {
    scryptSpy.mockClear();
  });

  it('derives the key once per secret — a second seal+unseal re-derives nothing', async () => {
    const { sealCookie, unsealCookie } = await freshCookies();
    const secret = 'memoization-secret-aaaaaaaaaaaaaaaaaaaa';

    // Warm-up round: whatever derivation the implementation needs, it may do.
    const first = sealCookie('payload-one', secret);
    expect(unsealCookie(first, secret)).toBe('payload-one');
    expect(scryptSpy, 'the KDF must run at least once to have a key at all').toHaveBeenCalled();

    scryptSpy.mockClear();

    // Second round, same secret: the key is already known.
    const second = sealCookie('payload-two', secret);
    expect(unsealCookie(second, secret)).toBe('payload-two');
    expect(
      scryptSpy.mock.calls.length,
      'second seal+unseal with the same secret must re-derive nothing',
    ).toBe(0);
  });

  it('keys the memo on the secret — a different secret still derives', async () => {
    const { sealCookie, unsealCookie } = await freshCookies();

    sealCookie('x', 'secret-alpha-aaaaaaaaaaaaaaaaaaaaaaaaaa');
    scryptSpy.mockClear();

    // A DIFFERENT secret must not be served the first secret's key. Sealing with
    // one and unsealing with the other must still fail.
    const sealedWithBeta = sealCookie('x', 'secret-beta-bbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(scryptSpy.mock.calls.length, 'a new secret needs its own derivation').toBe(1);
    expect(unsealCookie(sealedWithBeta, 'secret-alpha-aaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(null);
  });

  it('rejects a well-formed-prefix/invalid-body cookie WITHOUT running the KDF', async () => {
    const { unsealCookie } = await freshCookies();
    // A secret this module has never seen, so the memo is cold and cannot be
    // the reason the KDF does not run — only the check ordering can be.
    const secret = 'ordering-secret-never-derived-before-xyz';

    expect(unsealCookie(WELL_FORMED_PREFIX_INVALID_BODY, secret)).toBe(null);
    expect(
      scryptSpy.mock.calls.length,
      'an attacker-supplied cookie the cheap format checks can reject must not reach scrypt',
    ).toBe(0);
  });

  it('still rejects the other malformed shapes without the KDF', async () => {
    const { unsealCookie } = await freshCookies();
    const secret = 'ordering-secret-2-never-derived-before-q';

    expect(unsealCookie('', secret)).toBe(null);
    expect(unsealCookie('not-sealed', secret)).toBe(null);
    expect(unsealCookie('aa:bb', secret)).toBe(null);
    expect(unsealCookie('a:b:c:d', secret)).toBe(null);
    expect(unsealCookie(`${'aa'.repeat(11)}:${'bb'.repeat(16)}:cc`, secret)).toBe(null); // short IV
    expect(unsealCookie(`${'aa'.repeat(12)}:${'bb'.repeat(15)}:cc`, secret)).toBe(null); // short tag
    expect(scryptSpy.mock.calls.length, 'none of these needs a key').toBe(0);
  });
});
