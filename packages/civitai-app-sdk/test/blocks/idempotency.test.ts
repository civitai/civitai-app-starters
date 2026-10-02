import { describe, expect, it } from 'vitest';

import {
  BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH,
  BLOCK_IDEMPOTENCY_KEY_REGEX,
  blockIdempotencyKeyRejection,
  isValidBlockIdempotencyKey,
} from '../../src/blocks/idempotency.js';

/**
 * The vendored host rule for a money-POST `idempotencyKey`.
 *
 * 🔴 WHY THIS LIVES IN **THIS** PACKAGE'S SUITE, not only downstream. The module
 * is published here and is consumed by non-React callers, but every behavioural
 * test of it was initially written in `@civitai/blocks-react` — so an app-sdk
 * change could have broken the rule with app-sdk's OWN suite green. That is the
 * isolation seam: each package tested, the relationship between them owned by
 * nobody. These are the package-local cases; the hook-boundary and mock-host
 * behaviour stay downstream, where those surfaces live.
 *
 * THE DEFECT (2026-10-02). A block composed `sheetId:panelId:nonce`, passed 201
 * local tests, and 400'd every save in production with `invalid_format` /
 * `must match pattern /^[A-Za-z0-9_-]{1,64}$/`.
 */
describe('BLOCK_IDEMPOTENCY_KEY_REGEX', () => {
  it('matches the host rule exactly, as a source literal', () => {
    // Pinned as a STRING so a change to the pattern is visible in the diff of
    // this assertion rather than only in behaviour.
    expect(String(BLOCK_IDEMPOTENCY_KEY_REGEX)).toBe('/^[A-Za-z0-9_-]{1,64}$/');
  });

  it('🔴 carries NO `g` flag — a sticky lastIndex would alternate per call', () => {
    // A `g`-flagged regex advances `lastIndex` across `.test()` calls on the SAME
    // instance, so an identical key would be accepted on one submit and refused
    // on its retry. This module is a shared singleton, so that is reachable.
    expect(BLOCK_IDEMPOTENCY_KEY_REGEX.global).toBe(false);
    const key = 'stable-key_1';
    expect(BLOCK_IDEMPOTENCY_KEY_REGEX.test(key)).toBe(true);
    expect(BLOCK_IDEMPOTENCY_KEY_REGEX.test(key)).toBe(true);
    expect(BLOCK_IDEMPOTENCY_KEY_REGEX.test(key)).toBe(true);
  });

  it('the named bound agrees with the pattern, on BOTH sides of the boundary', () => {
    expect(BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH).toBe(64);
    const atBound = 'k'.repeat(BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH);
    const overBound = 'k'.repeat(BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH + 1);
    expect(BLOCK_IDEMPOTENCY_KEY_REGEX.test(atBound)).toBe(true);
    expect(BLOCK_IDEMPOTENCY_KEY_REGEX.test(overBound)).toBe(false);
  });
});

describe('isValidBlockIdempotencyKey', () => {
  it('accepts the shapes the SDK itself mints and the host documents', () => {
    for (const ok of [
      '3f1a9c2e-5b6d-4e7f-8a90-1b2c3d4e5f60', // crypto.randomUUID()
      'idem-abc123-def456', // the generator's fallback
      'A_z-0',
      'k'.repeat(64),
      'a',
    ]) {
      expect(isValidBlockIdempotencyKey(ok)).toBe(true);
    }
  });

  it('refuses the host-documented rejections, the empty string and the 65th char', () => {
    for (const bad of [
      'sheet_42:panel_7:a1b2c3', // THE reported production value
      'has:colon',
      'has space',
      'new\nline',
      'dot.separated',
      'slash/separated',
      '',
      'k'.repeat(65),
    ]) {
      expect(isValidBlockIdempotencyKey(bad)).toBe(false);
    }
  });

  it('refuses a NON-STRING — a wire `string` is not a runtime guarantee', () => {
    // A block compiled against an older SDK, or plain JS, can put anything here.
    for (const bad of [undefined, null, 12345, {}, [], true, Symbol('k')]) {
      expect(isValidBlockIdempotencyKey(bad)).toBe(false);
    }
  });

  it('returns a plain boolean, NOT a type predicate', () => {
    // 🔴 Deliberate: a `value is string` signature narrows the FALSE branch to
    // `never` for an already-`string` argument, which made the rejection builder
    // below uncompilable and would make a legitimate else-branch read as dead
    // code in any caller. Pinned behaviourally — a type predicate still returns
    // a boolean at runtime, so this asserts the VALUE while
    // `tsconfig.typecheck.json` covers the signature.
    expect(typeof isValidBlockIdempotencyKey('ok')).toBe('boolean');
    expect(typeof isValidBlockIdempotencyKey('bad:key')).toBe('boolean');
  });
});

/**
 * 🔴 EACH REASON IS ASSERTED AGAINST ITS OWN CLAUSE, NOT A SUBSTRING THAT ALSO
 * APPEARS IN BOILERPLATE. An earlier draft asserted `toContain('at most 64')`
 * for the length case — which every message ends with, so it passed for the
 * EMPTY-string case too. The fixtures are pairwise distinct and each fails on a
 * DIFFERENT clause, so a mutant collapsing them is visible.
 */
describe('blockIdempotencyKeyRejection', () => {
  it('returns null for a valid key — the gate is reachable, not a blanket deny', () => {
    expect(blockIdempotencyKeyRejection('fine_key-1')).toBeNull();
    expect(blockIdempotencyKeyRejection('k'.repeat(64))).toBeNull();
  });

  it('names the COLON and why it is excluded (in-charset otherwise, in-bounds)', () => {
    const why = blockIdempotencyKeyRejection('sheet_42:panel_7:a1b2c3');
    expect(why).toContain('":"');
    expect(why).toContain('delimiter');
    // De-duplicated: two colons, one complaint.
    expect(why!.match(/":"/g)).toHaveLength(1);
    // NOT a length complaint — this value is 23 chars.
    expect(why).not.toMatch(/it is \d+ characters/);
  });

  it('names the LENGTH for an in-charset over-long key, and only that', () => {
    const why = blockIdempotencyKeyRejection('a'.repeat(65));
    expect(why).toMatch(/it is 65 characters \(the host allows at most 64\)/);
    expect(why).not.toContain('it contains');
  });

  it('names EMPTY, which fails neither the charset nor the ceiling', () => {
    const why = blockIdempotencyKeyRejection('');
    expect(why).toContain('it is empty');
    expect(why).not.toMatch(/it is \d+ characters/);
    expect(why).not.toContain('it contains');
  });

  it('reports BOTH faults when a key is over-long AND out-of-charset', () => {
    const why = blockIdempotencyKeyRejection('a:'.repeat(40)); // 80 chars, colons
    expect(why).toMatch(/it is 80 characters/);
    expect(why).toContain('":"');
    expect(why).toContain(', and ');
  });

  it('names a NON-COLON offender without the colon-specific explanation', () => {
    const why = blockIdempotencyKeyRejection('key with space');
    expect(why).toContain('" "');
    // Otherwise the colon assertions above would be passing on boilerplate.
    expect(why).not.toContain('delimiter');
  });

  it('distinguishes a non-string from a malformed string', () => {
    expect(blockIdempotencyKeyRejection(12345)).toContain('must be a string');
    expect(blockIdempotencyKeyRejection(12345)).toContain('got number');
    expect(blockIdempotencyKeyRejection(null)).toContain('got null');
    expect(blockIdempotencyKeyRejection(undefined)).toContain('got undefined');
  });

  it('quotes the offending value so a log names what to fix', () => {
    expect(blockIdempotencyKeyRejection('a:b')).toContain('Offending value: "a:b"');
  });

  it('agrees with the predicate on every fixture — one rule, not two', () => {
    // The two functions are the only public entry points and must never
    // disagree: a key the predicate rejects must have a stated reason, and a key
    // it accepts must have none.
    for (const v of [
      'ok_key-1',
      'k'.repeat(64),
      'k'.repeat(65),
      '',
      'a:b',
      'a b',
      'a.b',
      12345,
      null,
      undefined,
    ]) {
      expect(blockIdempotencyKeyRejection(v) === null).toBe(isValidBlockIdempotencyKey(v));
    }
  });
});
