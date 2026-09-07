import { describe, expect, it } from 'vitest';

import {
  BrowsingLevel,
  SFW_LEVELS,
  NSFW_LEVELS,
  isSfwCeiling,
  isLevelAllowed,
  effectiveBrowsingCeiling,
} from '../../src/blocks/index.js';

describe('BrowsingLevel constants', () => {
  it('mirror the server NsfwLevel bit values', () => {
    expect(BrowsingLevel.PG).toBe(1);
    expect(BrowsingLevel.PG13).toBe(2);
    expect(BrowsingLevel.R).toBe(4);
    expect(BrowsingLevel.X).toBe(8);
    expect(BrowsingLevel.XXX).toBe(16);
    expect(BrowsingLevel.Blocked).toBe(32);
  });

  it('SFW_LEVELS = PG|PG13, NSFW_LEVELS = R|X|XXX (Blocked excluded)', () => {
    expect(SFW_LEVELS).toBe(BrowsingLevel.PG | BrowsingLevel.PG13);
    expect(NSFW_LEVELS).toBe(BrowsingLevel.R | BrowsingLevel.X | BrowsingLevel.XXX);
    expect(NSFW_LEVELS & BrowsingLevel.Blocked).toBe(0);
    expect(SFW_LEVELS & NSFW_LEVELS).toBe(0);
  });
});

describe('isSfwCeiling', () => {
  it('true for an SFW-only ceiling (PG|PG13)', () => {
    expect(isSfwCeiling(SFW_LEVELS)).toBe(true);
    expect(isSfwCeiling(BrowsingLevel.PG)).toBe(true);
  });

  it('false when the ceiling contains any NSFW bit', () => {
    expect(isSfwCeiling(SFW_LEVELS | BrowsingLevel.R)).toBe(false);
    expect(isSfwCeiling(BrowsingLevel.X)).toBe(false);
    expect(isSfwCeiling(BrowsingLevel.XXX)).toBe(false);
    // an all-levels (red) ceiling is mature
    expect(
      isSfwCeiling(
        BrowsingLevel.PG |
          BrowsingLevel.PG13 |
          BrowsingLevel.R |
          BrowsingLevel.X |
          BrowsingLevel.XXX,
      ),
    ).toBe(false);
  });

  it('fail-closed SFW (true) for undefined / null / non-finite / NaN', () => {
    expect(isSfwCeiling(undefined)).toBe(true);
    expect(isSfwCeiling(null)).toBe(true);
    expect(isSfwCeiling(NaN)).toBe(true);
    expect(isSfwCeiling(Infinity)).toBe(true);
    expect(isSfwCeiling('4' as unknown as number)).toBe(true);
  });

  it('a 0 ceiling (no levels) is SFW', () => {
    expect(isSfwCeiling(0)).toBe(true);
  });
});

describe('isLevelAllowed', () => {
  const sfw = SFW_LEVELS;
  const all = sfw | NSFW_LEVELS;

  it('permits a level present in the ceiling', () => {
    expect(isLevelAllowed(BrowsingLevel.PG13, sfw)).toBe(true);
    expect(isLevelAllowed(BrowsingLevel.R, all)).toBe(true);
  });

  it('denies a level absent from the ceiling', () => {
    expect(isLevelAllowed(BrowsingLevel.R, sfw)).toBe(false);
    expect(isLevelAllowed(BrowsingLevel.X, sfw)).toBe(false);
  });

  it('fail-closed to SFW-only when ceiling is absent', () => {
    expect(isLevelAllowed(BrowsingLevel.PG13, undefined)).toBe(true);
    expect(isLevelAllowed(BrowsingLevel.PG, null)).toBe(true);
    expect(isLevelAllowed(BrowsingLevel.R, undefined)).toBe(false);
    expect(isLevelAllowed(BrowsingLevel.X, NaN)).toBe(false);
  });

  it('rejects a non-finite / non-positive level', () => {
    expect(isLevelAllowed(0, all)).toBe(false);
    expect(isLevelAllowed(-4, all)).toBe(false);
    expect(isLevelAllowed(NaN, all)).toBe(false);
  });
});

/**
 * `effectiveBrowsingCeiling` — resolve the DOMAIN ceiling against the VIEWER's
 * own level into the one number a block should gate on.
 *
 * 🔴 EVERY FIXTURE HERE MAKES THE TWO OPERANDS DISAGREE, in both directions.
 * They disagree in production both ways round — on `blue` the viewer's saved
 * level is wider than the App-Blocks domain ceiling, on `red` the domain
 * ceiling is wider than a PG-only viewer — and an agreeing fixture cannot tell
 * an intersection apart from "returns the first argument" or "returns the
 * second".
 */
describe('effectiveBrowsingCeiling', () => {
  it('🔴 narrows a wide DOMAIN by a narrow viewer: all(31) + PG13-capped(3) → 3', () => {
    expect(effectiveBrowsingCeiling(31, SFW_LEVELS)).toBe(SFW_LEVELS);
    // The point of the field: on red, this is what stops a block showing X to a
    // viewer who never turned NSFW on.
    expect(effectiveBrowsingCeiling(31, BrowsingLevel.PG)).toBe(BrowsingLevel.PG);
  });

  it('🔴 a viewer WIDER than the domain cannot widen it: SFW(3) + R/X viewer(15) → 3', () => {
    // The blue-domain case. Returning the viewer level here would hand a block
    // the R and X bits on a domain that forbids them.
    expect(effectiveBrowsingCeiling(SFW_LEVELS, 15)).toBe(SFW_LEVELS);
    expect(effectiveBrowsingCeiling(SFW_LEVELS, 15) & NSFW_LEVELS).toBe(0);
  });

  it('returns NEITHER operand when each carries bits the other lacks: 11 ∩ 22 → 2', () => {
    // 11 = PG|PG13|X, 22 = PG13|R|XXX. An implementation returning either
    // argument, a min (11), or an OR (31) all give a different answer.
    expect(effectiveBrowsingCeiling(11, 22)).toBe(2);
  });

  it('is a subset of the domain ceiling over the whole 5-bit lattice', () => {
    for (let ceiling = 0; ceiling < 32; ceiling++) {
      for (let viewer = 0; viewer < 32; viewer++) {
        expect(effectiveBrowsingCeiling(ceiling, viewer) & ~ceiling).toBe(0);
      }
    }
  });

  it('an ABSENT viewer level yields the domain ceiling unchanged (older host)', () => {
    // The compatibility contract: a host that does not send the per-viewer
    // field must behave exactly as it did before the field existed.
    expect(effectiveBrowsingCeiling(31, undefined)).toBe(31);
    expect(effectiveBrowsingCeiling(31, null)).toBe(31);
    expect(effectiveBrowsingCeiling(SFW_LEVELS, undefined)).toBe(SFW_LEVELS);
  });

  /**
   * 🔴 PRESENT-BUT-MALFORMED IS NOT THE SAME CASE AS ABSENT, and the difference
   * is the whole content of these guards.
   *
   * Absent means "this host never had the field" and resolves to the domain
   * ceiling for compatibility (the case above). Malformed means "this host
   * tried to say something about this viewer and got it wrong", which is not a
   * licence to fall back to the WIDEST available answer — so it fails closed to
   * `ceiling ∩ SFW`.
   *
   * These assertions are deliberately written against a WIDE (mature) ceiling.
   * Against a SFW ceiling the two rules produce the same number, so a SFW-only
   * fixture cannot tell them apart — and an earlier draft of this suite had
   * exactly that blind spot: a mutation sweep deleting the negative check
   * changed nothing, because `ceiling & -1 === ceiling` and the fallback WAS
   * the ceiling. The guard read as protection and provided none.
   */
  it('🔴 a malformed viewer level fails closed to SFW — NOT to the wide domain ceiling', () => {
    expect(effectiveBrowsingCeiling(31, NaN)).toBe(SFW_LEVELS);
    expect(effectiveBrowsingCeiling(31, Infinity)).toBe(SFW_LEVELS);
    expect(effectiveBrowsingCeiling(31, '15' as unknown as number)).toBe(SFW_LEVELS);
    // Against a ceiling that is ALREADY SFW the answer is unchanged — the rule
    // only ever narrows.
    expect(effectiveBrowsingCeiling(SFW_LEVELS, NaN)).toBe(SFW_LEVELS);
  });

  it('🔴 a NEGATIVE viewer level is REJECTED, not masked (−1 & 31 === 31 — the widest viewer)', () => {
    // Two's complement sets every bit, so a masked −1 resolves to the FULL
    // domain ceiling: junk reading as the most permissive possible viewer.
    expect(effectiveBrowsingCeiling(31, -1)).toBe(SFW_LEVELS);
    expect(effectiveBrowsingCeiling(31, -1)).not.toBe(31);
    expect(effectiveBrowsingCeiling(31, -31)).toBe(SFW_LEVELS);
    // A FRACTIONAL negative is the other half: `31 & -0.5` is 0, so masking is
    // wrong in the opposite direction too. Neither masked answer is correct.
    expect(effectiveBrowsingCeiling(31, -0.5)).toBe(SFW_LEVELS);
    // Whatever the rule, no mature bit may ever appear from junk.
    expect(effectiveBrowsingCeiling(SFW_LEVELS, -1) & NSFW_LEVELS).toBe(0);
    expect(effectiveBrowsingCeiling(31, -1) & NSFW_LEVELS).toBe(0);
  });

  it('fail-closes to SFW when the DOMAIN ceiling is absent/malformed, even with a wide viewer', () => {
    // Same fallback isSfwCeiling uses. A wide viewer level must not be honoured
    // without a ceiling to bound it — 31 here would be a block seeing XXX off a
    // host that projected no ceiling at all.
    expect(effectiveBrowsingCeiling(undefined, 31)).toBe(SFW_LEVELS);
    expect(effectiveBrowsingCeiling(null, 31)).toBe(SFW_LEVELS);
    expect(effectiveBrowsingCeiling(NaN, 31)).toBe(SFW_LEVELS);
    expect(isSfwCeiling(effectiveBrowsingCeiling(undefined, 31))).toBe(true);
  });

  it('an EMPTY viewer level (0) yields 0 — a real answer, not a fallback', () => {
    // 0 is falsy, so a `viewer || ceiling` implementation would return the WIDE
    // ceiling here. That is the difference between "show this viewer nothing"
    // and "show this viewer everything".
    expect(effectiveBrowsingCeiling(31, 0)).toBe(0);
    expect(isSfwCeiling(effectiveBrowsingCeiling(31, 0))).toBe(true);
    expect(isLevelAllowed(BrowsingLevel.PG, effectiveBrowsingCeiling(31, 0))).toBe(false);
  });

  it('composes with isSfwCeiling / isLevelAllowed the way a block gates', () => {
    // A PG-only viewer on the widest domain: SFW by the effective ceiling, NOT
    // by the domain ceiling. Both assertions are needed — the first alone would
    // pass against an implementation that ignored the domain entirely.
    const eff = effectiveBrowsingCeiling(31, BrowsingLevel.PG);
    expect(isSfwCeiling(31)).toBe(false); // the domain says mature is fine
    expect(isSfwCeiling(eff)).toBe(true); // this viewer says otherwise
    expect(isLevelAllowed(BrowsingLevel.X, eff)).toBe(false);
    expect(isLevelAllowed(BrowsingLevel.PG, eff)).toBe(true);
  });
});
