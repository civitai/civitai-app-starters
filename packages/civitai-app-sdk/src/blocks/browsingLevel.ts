/**
 * Browsing-level bit constants + ceiling helpers for App Blocks.
 *
 * The host (civitai/civitai) projects an authoritative `maxBrowsingLevel`
 * BITMASK into `BLOCK_INIT` — the max NSFW levels the surrounding color-domain
 * allows (computed server-side from `domainBrowsingCeiling(color)`). A block
 * reads it via `useDomainMaturity()` to decide whether to surface mature
 * affordances.
 *
 * The per-level bit VALUES below mirror civitai/civitai's server `NsfwLevel`
 * enum. They are STABLE wire values (a level's bit never changes), so it is
 * safe to hardcode them in the SDK. What is NOT encoded here is the green/blue/
 * red → ceiling POLICY: that lives server-side (the host computes the mask and
 * sends it), so the SDK derives "is this domain SFW?" from the BITMASK, never
 * from the `domain` string. If the platform ever flips blue's policy, this SDK
 * keeps working with no change.
 *
 * @see civitai/civitai `src/shared/constants/browsingLevel.constants.ts`
 *      (`NsfwLevel`) and `domainBrowsingCeiling`.
 */

/**
 * Per-level NSFW bit values. Mirrors the server `NsfwLevel` enum — stable wire
 * values, not the green/blue/red policy.
 */
export const BrowsingLevel = {
  PG: 1,
  PG13: 2,
  R: 4,
  X: 8,
  XXX: 16,
  Blocked: 32,
} as const;

export type BrowsingLevelKey = keyof typeof BrowsingLevel;
export type BrowsingLevelBit = (typeof BrowsingLevel)[BrowsingLevelKey];

/**
 * The levels considered "safe for work" — PG + PG13. A ceiling that contains
 * ONLY these bits (or none) is an SFW domain.
 */
export const SFW_LEVELS = BrowsingLevel.PG | BrowsingLevel.PG13;

/**
 * The NSFW levels — R + X + XXX. (`Blocked` is excluded: it is never an
 * "allowed" browsing level, it marks content removed from view.) A ceiling
 * that contains ANY of these bits is a mature domain.
 */
export const NSFW_LEVELS = BrowsingLevel.R | BrowsingLevel.X | BrowsingLevel.XXX;

/**
 * True when the domain's browsing-level ceiling permits NO NSFW content.
 *
 * Derived purely from the BITMASK: SFW ⇔ the ceiling has no NSFW bits set.
 *
 * **Fail-closed SFW.** A missing / null / non-finite mask (e.g. before
 * `BLOCK_INIT` lands, or a host that predates PR #2670 and doesn't send the
 * field) returns `true` — matching the server's fail-closed-SFW default. A
 * block must therefore treat "unknown" as SFW and hide mature affordances
 * until proven otherwise.
 *
 * @param maxBrowsingLevel the domain ceiling bitmask from `BLOCK_INIT`.
 * @example
 * isSfwCeiling(BrowsingLevel.PG | BrowsingLevel.PG13); // true  (green/blue)
 * isSfwCeiling(BrowsingLevel.PG | BrowsingLevel.X);     // false (mature)
 * isSfwCeiling(undefined);                               // true  (fail-closed)
 */
export function isSfwCeiling(maxBrowsingLevel?: number | null): boolean {
  if (typeof maxBrowsingLevel !== 'number' || !Number.isFinite(maxBrowsingLevel)) {
    return true; // fail-closed: unknown ceiling ⇒ SFW
  }
  return (maxBrowsingLevel & NSFW_LEVELS) === 0;
}

/**
 * True when a specific browsing `level` bit is permitted by the domain ceiling.
 *
 * **Fail-closed.** A missing / null / non-finite ceiling permits ONLY SFW
 * levels (PG / PG13) — same fail-closed posture as {@link isSfwCeiling}. A
 * non-finite / non-positive `level` returns `false`.
 *
 * @param level a single `BrowsingLevel` bit (e.g. `BrowsingLevel.R`).
 * @param maxBrowsingLevel the domain ceiling bitmask from `BLOCK_INIT`.
 * @example
 * isLevelAllowed(BrowsingLevel.R, BrowsingLevel.PG | BrowsingLevel.PG13); // false
 * isLevelAllowed(BrowsingLevel.PG13, undefined);                          // true
 * isLevelAllowed(BrowsingLevel.X, undefined);                             // false
 */
export function isLevelAllowed(level: number, maxBrowsingLevel?: number | null): boolean {
  if (typeof level !== 'number' || !Number.isFinite(level) || level <= 0) {
    return false;
  }
  const ceiling =
    typeof maxBrowsingLevel === 'number' && Number.isFinite(maxBrowsingLevel)
      ? maxBrowsingLevel
      : SFW_LEVELS; // fail-closed: unknown ceiling ⇒ SFW-only
  return (ceiling & level) === level;
}

/**
 * The color-domain a block is rendered inside, as projected by the host. The
 * SFW policy is NOT derived from this — use {@link isSfwCeiling} on the
 * accompanying `maxBrowsingLevel` mask instead. `null` / absent means the host
 * did not project a domain (treat as unknown ⇒ fail-closed SFW).
 */
export type ColorDomain = 'green' | 'blue' | 'red';
