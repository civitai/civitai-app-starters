import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generatePkce, generateState } from '../src/oauth/pkce.js';

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('generatePkce', () => {
  it('produces verifier and S256 challenge', () => {
    const pkce = generatePkce();
    expect(pkce.method).toBe('S256');
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.verifier).not.toBe(pkce.challenge);
  });

  it("challenge is sha256(verifier) base64url-encoded", () => {
    const pkce = generatePkce();
    const expected = base64UrlEncode(createHash('sha256').update(pkce.verifier).digest());
    expect(pkce.challenge).toBe(expected);
  });

  it('returns different values on successive calls', () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it('verifier is at least 43 base64url chars (RFC 7636 §4.1)', () => {
    const pkce = generatePkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.verifier.length).toBeLessThanOrEqual(128);
  });
});

describe('generateState', () => {
  it('returns base64url chars of expected length', () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns unique values per call', () => {
    expect(generateState()).not.toBe(generateState());
  });

  it('honors custom byte length', () => {
    const short = generateState(4);
    const long = generateState(64);
    expect(long.length).toBeGreaterThan(short.length);
  });
});
