/**
 * Origin allowlist matching for {@link IframeTransport}.
 *
 * Each `allowedParentOrigins` entry is either:
 * - an EXACT origin (`https://civitai.com`) — matched by string equality, or
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

export class OriginMatcher {
  private readonly exact: ReadonlySet<string>;
  private readonly wildcards: readonly WildcardEntry[];

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
        exact.add(entry);
      }
    }

    this.exact = exact;
    this.wildcards = wildcards;
  }

  /** True when `origin` is allowed by an exact or wildcard allowlist entry. */
  matches(origin: string): boolean {
    if (this.exact.has(origin)) return true;

    for (const wc of this.wildcards) {
      if (!origin.startsWith(wc.scheme)) continue;
      const host = origin.slice(wc.scheme.length);
      // Reject anything with a path/port/query smuggled into the host span:
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
 * Parses a `https://*.example.com`-style entry into `{scheme, suffix}`.
 * Returns `null` for non-wildcard (exact) entries.
 * Throws for malformed wildcards (`*` only, `https://*`, `https://*.`).
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
  if (!scheme || scheme === '://' || !bareSuffix) {
    throw new Error(
      `IframeTransport: invalid wildcard origin "${entry}". ` +
        'A wildcard needs a scheme and a non-empty domain suffix, e.g. "https://*.example.com".',
    );
  }

  // Dot-anchor the suffix so `*.civitaic.com` only matches on a label boundary.
  return { scheme, suffix: `.${bareSuffix}` };
}
