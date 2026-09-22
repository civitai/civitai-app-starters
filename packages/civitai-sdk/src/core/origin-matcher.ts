/**
 * Matches exact origins and `https://*.example.com` wildcards. Scheme-pinned and
 * anchored on a dot boundary, so `*.civitaic.com` rejects both
 * `civitaic.com.attacker.tld` and `evilcivitaic.com`.
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
      if (host.includes('/')) continue;
      // Dot-anchored against the END of the host, so a port never matches a
      // wildcard — list a ported parent as an exact entry. The length test
      // requires a leading label, excluding the apex itself.
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
