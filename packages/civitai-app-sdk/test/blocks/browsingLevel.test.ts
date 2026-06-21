import { describe, expect, it } from 'vitest';

import {
  BrowsingLevel,
  SFW_LEVELS,
  NSFW_LEVELS,
  isSfwCeiling,
  isLevelAllowed,
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
