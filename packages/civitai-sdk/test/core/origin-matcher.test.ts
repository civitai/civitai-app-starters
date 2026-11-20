import { describe, expect, it } from 'vitest';

import { OriginMatcher } from '../../src/core/origin-matcher.js';

const m = new OriginMatcher(['https://civitai.com', 'https://*.civitai.com']);

describe('OriginMatcher', () => {
  it('accepts the exact origin and a subdomain', () => {
    expect(m.matches('https://civitai.com')).toBe(true);
    expect(m.matches('https://app.civitai.com')).toBe(true);
    expect(m.matches('https://a.b.civitai.com')).toBe(true);
  });

  it('rejects a suffix that is not on a label boundary', () => {
    expect(m.matches('https://evilcivitai.com')).toBe(false);
  });

  it('rejects the allowed host used as a prefix of another domain', () => {
    expect(m.matches('https://civitai.com.attacker.tld')).toBe(false);
  });

  it('is scheme-pinned', () => {
    expect(m.matches('http://app.civitai.com')).toBe(false);
  });

  it('rejects an empty label', () => {
    expect(m.matches('https://.civitai.com')).toBe(false);
  });

  it('rejects a path smuggled into the host span', () => {
    expect(m.matches('https://attacker.tld/app.civitai.com')).toBe(false);
  });

  it('rejects userinfo pointing the real host elsewhere', () => {
    expect(m.matches('https://app.civitai.com@attacker.tld')).toBe(false);
  });

  it('an empty allowlist matches nothing', () => {
    expect(new OriginMatcher([]).matches('https://civitai.com')).toBe(false);
  });

  it('rejects a malformed wildcard at construction', () => {
    expect(() => new OriginMatcher(['https://*'])).toThrow(/invalid wildcard/);
    expect(() => new OriginMatcher(['*'])).toThrow(/invalid wildcard/);
  });

  it('fails closed on a port against a WILDCARD entry', () => {
    // Deliberate: the suffix is dot-anchored to the host, so a port never matches.
    // Production is 443-only; a ported parent must be listed as an exact entry.
    expect(m.matches('https://app.civitai.com:8080')).toBe(false);
    expect(new OriginMatcher(['https://app.civitai.com:8080']).matches(
      'https://app.civitai.com:8080',
    )).toBe(true);
  });
});
