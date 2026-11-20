/**
 * Origin allowlist matching for {@link IframeTransport}.
 *
 * Each `allowedParentOrigins` entry is either:
 * - an EXACT origin (`https://civitai.com`) — matched by string equality
 *   against the NORMALISED entry, or
 * - a SUFFIX-WILDCARD origin (`https://*.civitaic.com`) — matches any
 *   `https://<sub>.civitaic.com`, where `<sub>` is one or more labels
 *   (single-label `pr-9` or a full subtree `a.b`), but NOT the bare apex
 *   `https://civitaic.com` and NOT a different registrable domain.
 *
 * The wildcard form mirrors the host-side CSP `frame-ancestors` convention
 * (`https://*.civitaic.com`) so a single block build can trust both prod
 * (`civitai.com`, an exact entry) and dynamic preview subdomains
 * (`pr-N.civitaic.com`, a wildcard entry).
 *
 * ## Normalisation — ENTRIES ONLY, NEVER THE CANDIDATE
 *
 * 🔴 SECURITY DIRECTION. Entries are canonicalised at construction; the
 * candidate handed to {@link OriginMatcher.matches} is compared RAW. That
 * asymmetry is deliberate and must not be "tidied up": a real `event.origin`
 * is already the serialization of a canonical origin (lowercase scheme + host,
 * no trailing slash, default port elided, IDN in punycode), so normalising it
 * again can only ADD accepts — e.g. `new URL('https://civitai.com/evil').origin`
 * is `https://civitai.com`, so a `.origin` round-trip on the candidate would
 * make a path-bearing string match an apex entry. Normalising only the entries
 * is value-preserving on the set of REAL origins accepted while closing the
 * spellings an operator actually writes.
 *
 * Equivalences deliberately ACCEPTED (an entry spelled this way matches the
 * equivalent `event.origin`), all of them delegated to the URL parser so the
 * rules are the WHATWG ones rather than hand-rolled string surgery:
 * - trailing slash — `https://civitai.com/` ≡ `https://civitai.com`
 * - scheme/host case — `HTTPS://CIVITAI.COM` ≡ `https://civitai.com`
 *   (RFC 3986 §3.1/§3.2.2; path/query case is NOT touched — an origin has
 *   neither, and an entry carrying one is rejected outright, below)
 * - default port — `https://civitai.com:443` ≡ `https://civitai.com`,
 *   `http://x:80` ≡ `http://x`
 * - IDN — `https://пример.com` ≡ `https://xn--e1afmkfd.com`, which is the
 *   form a browser puts on `event.origin`
 *
 * Distinctions deliberately KEPT (these are NOT equivalences — an entry and a
 * candidate differing this way must not match):
 * - a NON-default port stays significant: `https://civitai.com:8443` does not
 *   match `https://civitai.com`
 * - the scheme stays significant: `http://` never matches `https://`
 * - a trailing-dot (fully-qualified) host is a DIFFERENT origin to the browser,
 *   so `https://civitai.com.` and `https://civitai.com` stay distinct here too
 * - no suffix/prefix logic on exact entries: `https://civitai.com.evil.com`
 *   does not match `https://civitai.com`
 *
 * Spellings deliberately REJECTED — loudly, by throwing from the constructor.
 * A malformed entry that is silently dropped is this file's own bug one level
 * up: the allowlist then misses an origin the operator believes is on it, and
 * nothing says so. An entry must denote an ORIGIN and nothing more:
 * - no scheme (`civitai.com`) — unparseable
 * - userinfo (`https://user:pass@civitai.com`) — `.origin` would silently
 *   discard the credentials the author wrote
 * - a path, query or fragment (`https://civitai.com/embed`) — `.origin` would
 *   silently discard them, widening the entry to the whole origin
 * - a scheme with no origin of its own (`foo://bar`, `file:///x`), whose
 *   `.origin` serialises to the literal string `"null"` — the same string a
 *   sandboxed opaque origin puts on `event.origin`, so accepting it would
 *   allowlist every opaque frame at once
 *
 * Security: matching is scheme-pinned and suffix-anchored on a DOT boundary,
 * so `https://*.civitaic.com` does NOT match `https://civitaic.com.attacker.tld`
 * (different suffix) nor `https://evilcivitaic.com` (no dot boundary). A
 * bare `*` or empty wildcard is rejected at construction.
 */

interface WildcardEntry {
  /** Scheme + "://" prefix that the candidate origin must start with, e.g. `https://`. */
  scheme: string;
  /** Dot-anchored suffix the candidate's host must end with, e.g. `.civitaic.com`. */
  suffix: string;
}

/**
 * Stand-in label substituted for `*` so a wildcard entry can be canonicalised
 * by the SAME URL parse as an exact entry (see {@link parseWildcard}). It must
 * be a valid DNS label that the URL parser leaves untouched, and distinctive
 * enough that a real suffix cannot begin with it.
 */
const WILDCARD_PROBE_LABEL = 'civitai-wildcard-probe';

export class OriginMatcher {
  private readonly exact: ReadonlySet<string>;
  private readonly wildcards: readonly WildcardEntry[];

  /**
   * The normalised EXACT origins, in first-seen order and de-duplicated.
   *
   * Exposed because `IframeTransport.announceReady` needs concrete
   * `postMessage` targets and must derive them from the SAME normalisation as
   * matching — one rule, one place. A wildcard is not a concrete origin and is
   * absent here by construction.
   */
  readonly exactOrigins: readonly string[];

  constructor(allowedParentOrigins: readonly string[]) {
    const exact = new Set<string>();
    const wildcards: WildcardEntry[] = [];

    for (const raw of allowedParentOrigins) {
      const entry = raw.trim();
      if (!entry) continue;

      const wildcard = parseWildcard(entry);
      if (wildcard) {
        wildcards.push(wildcard);
      } else {
        exact.add(normaliseOrigin(entry, entry));
      }
    }

    this.exact = exact;
    this.exactOrigins = [...exact];
    this.wildcards = wildcards;
  }

  /**
   * True when `origin` is allowed by an exact or wildcard allowlist entry.
   *
   * 🔴 `origin` is compared AS GIVEN — see the normalisation note in the module
   * docblock for why it is never round-tripped through `new URL()` here.
   */
  matches(origin: string): boolean {
    if (this.exact.has(origin)) return true;

    for (const wc of this.wildcards) {
      if (!origin.startsWith(wc.scheme)) continue;
      const host = origin.slice(wc.scheme.length);
      // Reject anything with a path/query smuggled into the host span:
      // a real `event.origin` is scheme + host (+ optional :port). We require
      // an exact host-suffix match with at least one leading label, and no '/'.
      if (host.includes('/')) continue;
      // The host must END with the dot-anchored suffix AND have at least one
      // character of label before the leading dot (so the apex itself is excluded).
      if (host.length > wc.suffix.length && host.endsWith(wc.suffix)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Canonicalises an allowlist entry to an origin serialization.
 *
 * `candidate` is what gets parsed; `entry` is what the operator wrote and is
 * the only thing named in an error (for a wildcard the two differ — the probe
 * label stands in for `*`). Throws on anything that is not, exactly, an origin.
 */
function normaliseOrigin(candidate: string, entry: string): string {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      `IframeTransport: invalid allowed parent origin "${entry}". ` +
        'Entries must be absolute origins including a scheme, e.g. "https://civitai.com".',
    );
  }

  const extras: string[] = [];
  if (url.username || url.password) extras.push('credentials');
  // An absolute URL with a special scheme always has a pathname of at least
  // "/", so only a LONGER path is a real path. `""` covers non-special schemes,
  // which are rejected by the origin check below anyway.
  if (url.pathname !== '' && url.pathname !== '/') extras.push('a path');
  if (url.search) extras.push('a query string');
  if (url.hash) extras.push('a fragment');
  if (extras.length > 0) {
    throw new Error(
      `IframeTransport: invalid allowed parent origin "${entry}" — it carries ${extras.join(
        ', ',
      )}. An allowlist entry must be a bare origin (scheme + host + optional port), ` +
        'e.g. "https://civitai.com"; anything beyond that is not part of an origin and ' +
        'would be silently discarded.',
    );
  }

  if (url.origin === 'null') {
    throw new Error(
      `IframeTransport: invalid allowed parent origin "${entry}" — the "${url.protocol}" ` +
        'scheme has no origin of its own, so it serialises to the literal "null" that a ' +
        'sandboxed opaque frame also reports. Use an http(s) origin, e.g. "https://civitai.com".',
    );
  }

  return url.origin;
}

/**
 * Parses a `https://*.example.com`-style entry into `{scheme, suffix}`.
 * Returns `null` for non-wildcard (exact) entries.
 * Throws for malformed wildcards (`*` only, `https://*`, `https://*.`).
 *
 * Canonicalisation reuses {@link normaliseOrigin} by substituting a concrete
 * placeholder label for `*` and stripping it back off the parsed origin. That
 * is what makes a wildcard entry obey exactly the same case, default-port,
 * trailing-slash and rejection rules as an exact one instead of a second,
 * drifting copy of them — `https://*.CIVITAIC.COM:443/` and
 * `https://*.civitaic.com` describe the same set, and a wildcard carrying a
 * path is rejected rather than turning into an entry that can never match
 * (`matches` refuses any host span containing `/`).
 */
function parseWildcard(entry: string): WildcardEntry | null {
  const star = entry.indexOf('*');
  if (star === -1) return null;

  // Wildcard must be of the exact form `<scheme>://*.<suffix>`.
  const marker = '://*.';
  const markerAt = entry.indexOf(marker);
  if (markerAt === -1) {
    throw new Error(
      `IframeTransport: invalid wildcard origin "${entry}". ` +
        'Wildcard entries must look like "https://*.example.com".',
    );
  }

  const scheme = entry.slice(0, markerAt + 3); // include "://"
  const bareSuffix = entry.slice(markerAt + marker.length); // after "://*."
  if (!scheme || scheme === '://' || !bareSuffix || bareSuffix.includes('*')) {
    throw new Error(
      `IframeTransport: invalid wildcard origin "${entry}". ` +
        'A wildcard needs a scheme and a non-empty domain suffix with exactly one "*", ' +
        'e.g. "https://*.example.com".',
    );
  }

  const origin = normaliseOrigin(`${scheme}${WILDCARD_PROBE_LABEL}.${bareSuffix}`, entry);
  const sep = origin.indexOf('://');
  const normalisedScheme = origin.slice(0, sep + 3);
  const host = origin.slice(sep + 3);
  const probePrefix = `${WILDCARD_PROBE_LABEL}.`;
  const normalisedSuffix = host.startsWith(probePrefix) ? host.slice(probePrefix.length) : '';
  if (!normalisedSuffix) {
    throw new Error(
      `IframeTransport: invalid wildcard origin "${entry}". ` +
        'A wildcard needs a scheme and a non-empty domain suffix with exactly one "*", ' +
        'e.g. "https://*.example.com".',
    );
  }

  // Dot-anchor the suffix so `*.civitaic.com` only matches on a label boundary.
  return { scheme: normalisedScheme, suffix: `.${normalisedSuffix}` };
}
