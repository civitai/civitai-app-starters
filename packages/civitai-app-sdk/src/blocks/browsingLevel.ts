/**
 * Browsing-level bit constants + ceiling helpers for Civitai Apps.
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
 * The ceiling a block should actually render against: the DOMAIN ceiling
 * narrowed by the VIEWER's own browsing level.
 *
 * `maxBrowsingLevel` is a property of the domain — identical for every viewer
 * on `civitai.red`, including one whose own NSFW setting is off — so it cannot
 * answer "may I show THIS person mature content". `effectiveBrowsingLevel`
 * (added alongside it in `BLOCK_INIT`) is that ceiling intersected with the
 * viewer's own level, and this helper resolves the pair.
 *
 * **Never widens.** The result is always a subset of the domain ceiling:
 *   - Both present → their intersection. The host already intersected them
 *     server-side; doing it again here means a block gets the invariant even
 *     against a host that ships a wider value by mistake. That is the whole
 *     reason this is not just `effectiveBrowsingLevel ?? maxBrowsingLevel`.
 *   - Domain ceiling absent / non-finite → {@link SFW_LEVELS}, the same
 *     fail-closed default {@link isSfwCeiling} uses. A viewer level is never
 *     honoured without a domain ceiling to bound it.
 *
 * 🔴 ABSENT AND MALFORMED ARE DIFFERENT CASES AND RESOLVE DIFFERENTLY. Reading
 * them as one is what makes a "fail-closed" guard here vacuous:
 *   - `undefined` / `null` = a host that never had the field. Returns the
 *     domain ceiling untouched — EXACTLY the pre-field behaviour, so an older
 *     host keeps working and a block that upgrades can only ever end up with
 *     the same or a NARROWER permission than it had, never a wider one.
 *   - present-but-malformed (non-number, `NaN`, `Infinity`, NEGATIVE) = a host
 *     that tried to say something about this viewer and got it wrong. That is
 *     NOT a licence to fall back to the widest available answer, so it fails
 *     closed to `ceiling ∩ SFW`.
 * Collapsing the two — returning the ceiling for both — is how this guard was
 * originally written, and a mutation sweep caught it: with `ceiling & -1 ===
 * ceiling`, deleting the negative check changed NOTHING, i.e. the check was
 * documented as preventing an outcome it could not actually prevent.
 *
 * Negative is called out because it is the counter-intuitive one: two's
 * complement sets every high bit, so a masked `-1` resolves to the FULL domain
 * ceiling — junk reading as the widest possible viewer.
 *
 * @example
 * // civitai.red (all levels) + a viewer capped at PG13
 * effectiveBrowsingCeiling(31, 3); // 3
 * @example
 * // a host that predates the field
 * effectiveBrowsingCeiling(31, undefined); // 31 — unchanged behaviour
 * @example
 * // a host that sent junk — not the same thing, and not trusted
 * effectiveBrowsingCeiling(31, -1); // 3 (SFW)
 */
export function effectiveBrowsingCeiling(
  maxBrowsingLevel?: number | null,
  effectiveBrowsingLevel?: number | null
): number {
  const ceiling =
    typeof maxBrowsingLevel === 'number' && Number.isFinite(maxBrowsingLevel)
      ? maxBrowsingLevel
      : SFW_LEVELS; // fail-closed: unknown domain ceiling ⇒ SFW-only
  // ABSENT: the field does not exist on this host. Pre-field behaviour.
  if (effectiveBrowsingLevel === undefined || effectiveBrowsingLevel === null) {
    return ceiling;
  }
  // PRESENT BUT MALFORMED: fail closed rather than fall back to the ceiling.
  if (
    typeof effectiveBrowsingLevel !== 'number' ||
    !Number.isFinite(effectiveBrowsingLevel) ||
    effectiveBrowsingLevel < 0
  ) {
    return ceiling & SFW_LEVELS;
  }
  return ceiling & effectiveBrowsingLevel;
}

/**
 * The color-domain a block is rendered inside, as projected by the host. The
 * SFW policy is NOT derived from this — use {@link isSfwCeiling} on the
 * accompanying `maxBrowsingLevel` mask instead. `null` / absent means the host
 * did not project a domain (treat as unknown ⇒ fail-closed SFW).
 */
export type ColorDomain = 'green' | 'blue' | 'red';
