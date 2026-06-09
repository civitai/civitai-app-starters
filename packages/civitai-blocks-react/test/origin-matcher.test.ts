import { describe, expect, it } from 'vitest';

import { OriginMatcher } from '../src/internal/originMatcher.js';

describe('OriginMatcher', () => {
  describe('exact entries', () => {
    it('matches an exact origin', () => {
      const m = new OriginMatcher(['https://civitai.com']);
      expect(m.matches('https://civitai.com')).toBe(true);
    });

    it('does not match a different exact origin', () => {
      const m = new OriginMatcher(['https://civitai.com']);
      expect(m.matches('https://example.com')).toBe(false);
      // exact entry is NOT a wildcard — subdomains do not match
      expect(m.matches('https://pr-9.civitai.com')).toBe(false);
    });

    it('is scheme-sensitive for exact entries', () => {
      const m = new OriginMatcher(['https://civitai.com']);
      expect(m.matches('http://civitai.com')).toBe(false);
    });

    it('trims whitespace around entries', () => {
      const m = new OriginMatcher(['  https://civitai.com  ']);
      expect(m.matches('https://civitai.com')).toBe(true);
    });

    it('ignores empty entries', () => {
      const m = new OriginMatcher(['', '   ', 'https://civitai.com']);
      expect(m.matches('https://civitai.com')).toBe(true);
    });
  });

  describe('suffix-wildcard entries', () => {
    const m = new OriginMatcher(['https://*.civitaic.com']);

    it('matches a single-label subdomain', () => {
      expect(m.matches('https://pr-2319.civitaic.com')).toBe(true);
      expect(m.matches('https://pr-9.civitaic.com')).toBe(true);
    });

    it('matches a multi-label subtree', () => {
      expect(m.matches('https://a.b.civitaic.com')).toBe(true);
    });

    it('does NOT match the bare apex', () => {
      // civitaic.com itself must be a separate exact entry to be allowed.
      expect(m.matches('https://civitaic.com')).toBe(false);
    });

    it('does NOT match a suffix-smuggling attacker domain', () => {
      expect(m.matches('https://civitaic.com.attacker.tld')).toBe(false);
    });

    it('does NOT match a domain that merely ends with the bare suffix without a dot boundary', () => {
      expect(m.matches('https://evilcivitaic.com')).toBe(false);
    });

    it('is scheme-pinned', () => {
      expect(m.matches('http://pr-2319.civitaic.com')).toBe(false);
    });

    it('does not match a different registrable domain', () => {
      expect(m.matches('https://pr-2319.civitai.com')).toBe(false);
    });

    it('rejects host spans carrying a path', () => {
      expect(m.matches('https://pr-2319.civitaic.com/evil')).toBe(false);
    });
  });

  describe('civitai.com handled as a separate exact entry alongside a wildcard', () => {
    // Per the spec: civitai.com (the apex) is a distinct exact entry; the
    // wildcard only covers its subdomains. Keep both.
    const m = new OriginMatcher(['https://civitai.com', 'https://*.civitai.com']);

    it('matches the apex via the exact entry', () => {
      expect(m.matches('https://civitai.com')).toBe(true);
    });

    it('matches a subdomain via the wildcard entry', () => {
      expect(m.matches('https://next.civitai.com')).toBe(true);
    });

    it('a lone wildcard does NOT match the apex', () => {
      const wildcardOnly = new OriginMatcher(['https://*.civitai.com']);
      expect(wildcardOnly.matches('https://civitai.com')).toBe(false);
    });
  });

  describe('mixed allowlist (prod + preview)', () => {
    const m = new OriginMatcher([
      'https://civitai.com',
      'https://*.civitai.com',
      'https://*.civitaic.com',
    ]);

    it('matches prod apex, prod subdomains, and preview subdomains', () => {
      expect(m.matches('https://civitai.com')).toBe(true);
      expect(m.matches('https://next.civitai.com')).toBe(true);
      expect(m.matches('https://pr-2319.civitaic.com')).toBe(true);
    });

    it('still rejects attacker origins', () => {
      expect(m.matches('https://civitai.com.attacker.tld')).toBe(false);
      expect(m.matches('https://evilcivitaic.com')).toBe(false);
    });
  });

  describe('malformed wildcards', () => {
    it('throws on a bare "*"', () => {
      expect(() => new OriginMatcher(['*'])).toThrow(/invalid wildcard/i);
    });

    it('throws on a scheme-only wildcard "https://*"', () => {
      expect(() => new OriginMatcher(['https://*'])).toThrow(/invalid wildcard/i);
    });

    it('throws on a wildcard with no suffix "https://*."', () => {
      expect(() => new OriginMatcher(['https://*.'])).toThrow(/invalid wildcard/i);
    });
  });
});
