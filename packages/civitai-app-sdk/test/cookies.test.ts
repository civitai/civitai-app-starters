import { describe, expect, it } from 'vitest';
import {
  buildSetCookieHeader,
  readCookie,
  sealCookie,
  unsealCookie,
} from '../src/cookies/index.js';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('sealCookie / unsealCookie', () => {
  it('round-trips a simple string', () => {
    const sealed = sealCookie('hello world', SECRET);
    expect(sealed).not.toContain('hello world');
    expect(sealed).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    expect(unsealCookie(sealed, SECRET)).toBe('hello world');
  });

  it('round-trips a JSON payload', () => {
    const payload = JSON.stringify({ access_token: 'abc', expires_at: 12345, scope: 65537 });
    const sealed = sealCookie(payload, SECRET);
    expect(unsealCookie(sealed, SECRET)).toBe(payload);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = sealCookie('same', SECRET);
    const b = sealCookie('same', SECRET);
    expect(a).not.toBe(b);
  });

  it('returns null when secret is wrong', () => {
    const sealed = sealCookie('secret data', SECRET);
    expect(unsealCookie(sealed, 'a-different-secret')).toBe(null);
  });

  it('returns null on malformed input', () => {
    expect(unsealCookie('', SECRET)).toBe(null);
    expect(unsealCookie('not-sealed', SECRET)).toBe(null);
    expect(unsealCookie('aa:bb', SECRET)).toBe(null);
    expect(unsealCookie(':abc:def', SECRET)).toBe(null);
    expect(unsealCookie('aa:bb:zz', SECRET)).toBe(null);
  });

  it('returns null on tampered ciphertext (AEAD)', () => {
    const sealed = sealCookie('original', SECRET);
    const tampered = sealed.slice(0, -2) + 'ff';
    expect(unsealCookie(sealed, SECRET)).toBe('original');
    expect(unsealCookie(tampered, SECRET)).toBe(null);
  });

  it('returns null on tampered auth tag (AEAD)', () => {
    const sealed = sealCookie('original', SECRET);
    const [iv, tag, ct] = sealed.split(':');
    const flippedTag = tag!.slice(0, -2) + (tag!.endsWith('00') ? 'ff' : '00');
    expect(unsealCookie(`${iv}:${flippedTag}:${ct}`, SECRET)).toBe(null);
  });
});

describe('buildSetCookieHeader', () => {
  it('emits sensible defaults', () => {
    const header = buildSetCookieHeader('sess', 'abc123');
    expect(header).toContain('sess=abc123');
    expect(header).toContain('Max-Age=3600');
    expect(header).toContain('Path=/');
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=lax');
  });

  it('honors explicit attribute overrides', () => {
    const header = buildSetCookieHeader('sess', 'v', {
      maxAge: 60,
      path: '/api',
      domain: 'example.com',
      secure: false,
      httpOnly: false,
      sameSite: 'strict',
    });
    expect(header).toContain('Max-Age=60');
    expect(header).toContain('Path=/api');
    expect(header).toContain('Domain=example.com');
    expect(header).not.toContain('Secure');
    expect(header).not.toContain('HttpOnly');
    expect(header).toContain('SameSite=strict');
  });
});

describe('readCookie', () => {
  it('extracts a named cookie value', () => {
    expect(readCookie('a=1; sess=hello; b=2', 'sess')).toBe('hello');
  });

  it('returns null when missing', () => {
    expect(readCookie('a=1', 'sess')).toBe(null);
    expect(readCookie(null, 'sess')).toBe(null);
    expect(readCookie(undefined, 'sess')).toBe(null);
    expect(readCookie('', 'sess')).toBe(null);
  });

  it('handles values containing colons (sealed cookies)', () => {
    expect(readCookie('sess=abc:def:ghi', 'sess')).toBe('abc:def:ghi');
  });
});
