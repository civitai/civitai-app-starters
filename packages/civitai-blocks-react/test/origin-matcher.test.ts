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

  // #397 — entries were only `.trim()`ed, so a perfectly reasonable spelling of
  // the right origin produced an allowlist that matched nothing and a 10s init
  // timeout with no clue why. These pin the equivalences that ARE accepted.
  describe('entry normalisation — accepted equivalences', () => {
    it('accepts a trailing slash on an exact entry', () => {
      const m = new OriginMatcher(['https://civitai.com/']);
      expect(m.matches('https://civitai.com')).toBe(true);
    });

    it('accepts a mixed-case scheme and host (RFC 3986 §3.1/§3.2.2)', () => {
      const m = new OriginMatcher(['HTTPS://CIVITAI.COM']);
      expect(m.matches('https://civitai.com')).toBe(true);
    });

    it('accepts an explicit DEFAULT port (https:443)', () => {
      const m = new OriginMatcher(['https://civitai.com:443']);
      expect(m.matches('https://civitai.com')).toBe(true);
    });

    it('accepts an explicit DEFAULT port (http:80)', () => {
      const m = new OriginMatcher(['http://localhost:80']);
      expect(m.matches('http://localhost')).toBe(true);
    });

    it('accepts all three at once', () => {
      const m = new OriginMatcher(['  HTTPS://CiViTai.COM:443/  ']);
      expect(m.matches('https://civitai.com')).toBe(true);
    });

    it('normalises an IDN host to the punycode a browser puts on event.origin', () => {
      const m = new OriginMatcher(['https://пример.com']);
      expect(m.matches('https://xn--e1afmkfd.com')).toBe(true);
    });

    it('exposes the normalised exact origins for postMessage targeting', () => {
      const m = new OriginMatcher(['https://civitai.com/', 'HTTPS://CIVITAI.COM', 'https://*.civitaic.com']);
      // De-duplicated by normalisation, and the wildcard is not a concrete target.
      expect(m.exactOrigins).toEqual(['https://civitai.com']);
    });
  });

  // 🔴 The other half of the same change: normalisation must NOT widen. Each of
  // these is a distinction that stays significant; a normaliser that over-reaches
  // (lowercasing a whole string, stripping every port, comparing only the host)
  // turns one of them green.
  describe('entry normalisation — distinctions that must be KEPT', () => {
    it('keeps a NON-default port significant', () => {
      const m = new OriginMatcher(['https://civitai.com:8443']);
      expect(m.matches('https://civitai.com')).toBe(false);
      expect(m.matches('https://civitai.com:8443')).toBe(true);
    });

    it('does not let an apex entry match an origin carrying a non-default port', () => {
      const m = new OriginMatcher(['https://civitai.com']);
      expect(m.matches('https://civitai.com:8443')).toBe(false);
    });

    it('keeps the scheme significant across normalisation', () => {
      const m = new OriginMatcher(['HTTPS://CIVITAI.COM/']);
      expect(m.matches('http://civitai.com')).toBe(false);
    });

    it('does not match a different host', () => {
      const m = new OriginMatcher(['https://civitai.com/']);
      expect(m.matches('https://civitai.org')).toBe(false);
    });

    it('does not match a subdomain when only the apex is allowed', () => {
      const m = new OriginMatcher(['https://civitai.com:443']);
      expect(m.matches('https://pr-9.civitai.com')).toBe(false);
    });

    it('does not match a prefix-collision attacker domain', () => {
      // The classic normalisation bug: `https://civitai.com.evil.com` must never
      // satisfy an exact `https://civitai.com` entry.
      const m = new OriginMatcher(['https://civitai.com/']);
      expect(m.matches('https://civitai.com.evil.com')).toBe(false);
      expect(m.matches('https://evil.com/https://civitai.com')).toBe(false);
      expect(m.matches('https://notcivitai.com')).toBe(false);
    });

    it('keeps a trailing-dot (fully-qualified) host distinct, as the browser does', () => {
      expect(new OriginMatcher(['https://civitai.com']).matches('https://civitai.com.')).toBe(false);
      expect(new OriginMatcher(['https://civitai.com.']).matches('https://civitai.com')).toBe(false);
    });

    it('does NOT normalise the candidate origin — a path-bearing string is not an origin', () => {
      // `new URL('https://civitai.com/evil').origin` is `https://civitai.com`, so
      // round-tripping the CANDIDATE through the URL parser would accept this.
      // Only entries are normalised; the candidate is compared as given.
      const m = new OriginMatcher(['https://civitai.com']);
      expect(m.matches('https://civitai.com/evil')).toBe(false);
      expect(m.matches('https://civitai.com/')).toBe(false);
      expect(m.matches('HTTPS://CIVITAI.COM')).toBe(false);
    });
  });

  // A silently-dropped allowlist entry is #397's own failure mode one level up:
  // the operator believes an origin is allowed and nothing says otherwise.
  describe('entries that are not origins are rejected LOUDLY', () => {
    it('throws on an entry with no scheme', () => {
      expect(() => new OriginMatcher(['civitai.com'])).toThrow(/invalid allowed parent origin/i);
    });

    it('throws on an entry carrying a path', () => {
      expect(() => new OriginMatcher(['https://civitai.com/embed'])).toThrow(/a path/i);
    });

    it('throws on an entry carrying a query string or fragment', () => {
      expect(() => new OriginMatcher(['https://civitai.com?x=1'])).toThrow(/a query string/i);
      expect(() => new OriginMatcher(['https://civitai.com#frag'])).toThrow(/a fragment/i);
    });

    it('throws on an entry carrying userinfo', () => {
      expect(() => new OriginMatcher(['https://user:pass@civitai.com'])).toThrow(/credentials/i);
    });

    it('throws on a scheme whose origin serialises to the literal "null"', () => {
      // `event.origin` is the string "null" for a sandboxed opaque frame, so an
      // entry normalising to "null" would allowlist every opaque frame at once.
      expect(() => new OriginMatcher(['foo://bar'])).toThrow(/serialises to the literal "null"/i);
      expect(() => new OriginMatcher(['file://localhost'])).toThrow(
        /serialises to the literal "null"/i,
      );
      expect(new OriginMatcher(['https://civitai.com']).matches('null')).toBe(false);
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

  // Normalisation must COMPOSE with the wildcard form rather than break it: a
  // wildcard entry goes through the same URL canonicalisation via a placeholder
  // label, so it obeys the same case / default-port / trailing-slash rules.
  describe('wildcard entries normalise the same way exact ones do', () => {
    it('accepts a mixed-case wildcard', () => {
      const m = new OriginMatcher(['HTTPS://*.CIVITAIC.COM']);
      expect(m.matches('https://pr-9.civitaic.com')).toBe(true);
      expect(m.matches('https://civitaic.com')).toBe(false);
    });

    it('accepts a trailing slash on a wildcard', () => {
      const m = new OriginMatcher(['https://*.civitaic.com/']);
      expect(m.matches('https://pr-9.civitaic.com')).toBe(true);
    });

    it('accepts an explicit default port on a wildcard', () => {
      const m = new OriginMatcher(['https://*.civitaic.com:443']);
      expect(m.matches('https://pr-9.civitaic.com')).toBe(true);
    });

    it('keeps a NON-default port significant on a wildcard', () => {
      const m = new OriginMatcher(['https://*.civitaic.com:8443']);
      expect(m.matches('https://pr-9.civitaic.com')).toBe(false);
      expect(m.matches('https://pr-9.civitaic.com:8443')).toBe(true);
    });

    it('still refuses suffix smuggling after normalisation', () => {
      const m = new OriginMatcher(['HTTPS://*.CIVITAIC.COM:443/']);
      expect(m.matches('https://civitaic.com.attacker.tld')).toBe(false);
      expect(m.matches('https://evilcivitaic.com')).toBe(false);
      expect(m.matches('http://pr-9.civitaic.com')).toBe(false);
    });

    it('throws on a wildcard carrying a path instead of quietly never matching', () => {
      expect(() => new OriginMatcher(['https://*.civitaic.com/evil'])).toThrow(/a path/i);
    });

    it('throws on a wildcard with more than one "*"', () => {
      expect(() => new OriginMatcher(['https://*.*.civitaic.com'])).toThrow(/invalid wildcard/i);
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
