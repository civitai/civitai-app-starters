/**
 * THE PX-NOT-EM GUARD. Self-contained (no civitai checkout needed), so it runs
 * in the REQUIRED CI job via `pnpm --filter @civitai/theme test:self`, not just
 * in the advisory drift job.
 *
 * 🔴 WHY THIS TEST IS SHAPED THE WAY IT IS. civitai has two breakpoint scales:
 *
 *     key   px scale (breakpoints.json — CORRECT)   Mantine stock em scale (WRONG)
 *     xs    480                                     576
 *     sm    768                                     768   <-- the only shared value
 *     md    1024                                    992
 *     lg    1184                                    1200
 *     xl    1440                                    1408
 *
 * `sm` PROVES NOTHING ON ITS OWN: a token set generated from the Mantine em
 * scale would satisfy an `sm === 768` assertion and fail nothing. So the
 * assertions below pin the FOUR DISCRIMINATING keys, and then separately assert
 * that each of the four em values is ABSENT from the emitted artifacts — a
 * positive statement about the wrong scale, not merely the absence of a check.
 */
import { describe, expect, it } from 'vitest';

import { BREAKPOINT_KEYS, breakpoints, civitaiBreakpointsSource } from '../src/breakpoints.source.js';
import { buildArtifacts, resolveTokens } from '../src/generate.js';

/** civitai's px scale — the one this package must emit. */
const PX_SCALE = { xs: 480, sm: 768, md: 1024, lg: 1184, xl: 1440 } as const;

/**
 * Mantine's stock em scale, in px. NEVER emitted. Listed as literals (not
 * imported from Mantine) on purpose: the point is to fail if the generator ever
 * starts producing these numbers, whatever their provenance.
 */
const MANTINE_EM_SCALE_PX = { xs: 576, sm: 768, md: 992, lg: 1200, xl: 1408 } as const;

/** The four keys on which the two scales DISAGREE — the only ones that discriminate. */
const DISCRIMINATING_KEYS = ['xs', 'md', 'lg', 'xl'] as const;

const artifacts = buildArtifacts();
const { root, dark } = resolveTokens();

describe('breakpoint tokens are the PX scale, not the Mantine em scale', () => {
  it('the discriminating keys carry the px values (sm is excluded — both scales share 768)', () => {
    for (const key of DISCRIMINATING_KEYS) {
      expect(
        breakpoints[key],
        `breakpoints.${key} must be the px-scale value ${PX_SCALE[key]}, not the Mantine em-scale ` +
          `value ${MANTINE_EM_SCALE_PX[key]}`
      ).toBe(PX_SCALE[key]);
    }
  });

  it('sm is 768 (shared by both scales — asserted for completeness, discriminates nothing)', () => {
    expect(breakpoints.sm).toBe(768);
    expect(PX_SCALE.sm).toBe(MANTINE_EM_SCALE_PX.sm);
  });

  it('emits --civitai-bp-* into :root with the px values and `px` units', () => {
    for (const key of BREAKPOINT_KEYS) {
      expect(root, `--civitai-bp-${key} must be present in :root`).toHaveProperty(
        `--civitai-bp-${key}`
      );
      expect(root[`--civitai-bp-${key}`]).toBe(`${PX_SCALE[key]}px`);
    }
    expect(Object.keys(root).filter((k) => /^--civitai-bp-/.test(k))).toHaveLength(5);
  });

  it('emits NO dark override (the scale is color-scheme independent)', () => {
    for (const key of BREAKPOINT_KEYS) {
      expect(dark).not.toHaveProperty(`--civitai-bp-${key}`);
    }
  });

  it('does NOT emit any Mantine em-scale value on a discriminating key', () => {
    const css = artifacts['tokens.css'];
    for (const key of DISCRIMINATING_KEYS) {
      const wrong = `--civitai-bp-${key}: ${MANTINE_EM_SCALE_PX[key]}px;`;
      expect(css, `tokens.css must not contain the Mantine em-scale value "${wrong}"`).not.toContain(
        wrong
      );
      const right = `--civitai-bp-${key}: ${PX_SCALE[key]}px;`;
      expect(css, `tokens.css must contain "${right}"`).toContain(right);
    }
  });

  it('exposes bpXs…bpXl in the generated typed JS module and DTCG export', () => {
    const ts = artifacts['tokens.generated.ts'];
    for (const key of BREAKPOINT_KEYS) {
      const camel = `bp${key[0]!.toUpperCase()}${key.slice(1)}`;
      expect(ts, `tokens.generated.ts must export ${camel}`).toContain(
        `"${camel}": "${PX_SCALE[key]}px"`
      );
    }
    const dtcg = JSON.parse(artifacts['tokens.dtcg.json']) as Record<
      string,
      Record<string, { $type: string; $value: unknown }>
    >;
    expect(dtcg).toHaveProperty('bp');
    for (const key of BREAKPOINT_KEYS) {
      expect(dtcg.bp![key]!.$type).toBe('dimension');
      expect(dtcg.bp![key]!.$value).toEqual({ value: PX_SCALE[key], unit: 'px' });
    }
  });

  it('the numeric map is derived from the vendored string source (they cannot disagree)', () => {
    for (const key of BREAKPOINT_KEYS) {
      expect(`${breakpoints[key]}px`).toBe(civitaiBreakpointsSource[key]);
    }
  });

  it('BREAKPOINT_KEYS is ascending — tier comparison depends on this order', () => {
    const values = BREAKPOINT_KEYS.map((k) => breakpoints[k]);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });
});
