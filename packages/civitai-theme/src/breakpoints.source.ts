/**
 * VENDORED civitai BREAKPOINT SCALE — the second generator input for
 * `@civitai/theme`, alongside `theme.source.ts`.
 *
 * 🔴 THERE ARE TWO BREAKPOINT SCALES IN CIVITAI AND THEY AGREE ON EXACTLY ONE
 * KEY. Getting this wrong produces a scale that *looks* right at a glance,
 * because one of the five values matches:
 *
 *   - the PX scale — civitai/civitai's `src/utils/breakpoints.json`, mirrored by
 *     its Tailwind config and by `mantineContainerSizes` in
 *     `src/utils/mantine-css-helpers.ts`:
 *         xs 480 · sm 768 · md 1024 · lg 1184 · xl 1440
 *     THIS IS THE ONE VENDORED BELOW.
 *
 *   - Mantine's stock EM scale, which civitai never overrides and which every
 *     Mantine responsive prop (`visibleFrom`, `hiddenFrom`, `Grid`) uses:
 *         xs 576 · sm 768 · md 992 · lg 1200 · xl 1408
 *
 * Only `sm` (768) is shared. A test that pins `sm` alone therefore passes
 * against the WRONG scale — `test/breakpoint-tokens.test.ts` pins the four
 * discriminating keys and explicitly asserts the em values are absent.
 *
 * WHY THIS IS NOT IN `theme.source.ts`. `theme.source.ts` is a byte-faithful
 * copy of the CSS-variable-relevant fields of civitai's `createTheme({...})`
 * override, and `test/theme-drift.test.ts` fails on any divergence from the live
 * `ThemeProvider.tsx`. That file defines NO `breakpoints` key at all (verified:
 * `grep -n breakpoint src/providers/ThemeProvider.tsx` matches nothing), so
 * adding one there would either break the drift guard or falsify the
 * byte-faithful claim. More importantly, routing the px scale through the
 * Mantine theme pipeline is exactly the mistake this module exists to prevent:
 * `mergeMantineTheme` would resolve `theme.breakpoints` against Mantine's EM
 * defaults for any key we failed to override.
 *
 * So the px scale is vendored here as its own literal, with its own drift guard
 * (`test/breakpoint-drift.test.ts`) reading civitai's `breakpoints.json`
 * directly, and it is emitted through `generate.ts` as a LITERAL token spec that
 * never touches Mantine.
 */

/** Scale keys, ascending. ORDER IS SIGNIFICANT — tier comparison relies on it. */
export const BREAKPOINT_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

export type BreakpointKey = (typeof BREAKPOINT_KEYS)[number];

/**
 * Byte-faithful copy of civitai/civitai's `src/utils/breakpoints.json`,
 * INCLUDING its `px` units. Drift-guarded against that file.
 */
export const civitaiBreakpointsSource: Record<BreakpointKey, string> = {
  xs: '480px',
  sm: '768px',
  md: '1024px',
  lg: '1184px',
  xl: '1440px',
};

/**
 * The same scale as plain numbers (CSS pixels), derived from
 * `civitaiBreakpointsSource` so the two can never disagree.
 *
 * This is the form a JS consumer actually needs: the `--civitai-bp-*` CSS
 * custom properties are `<length>` strings, and a custom property cannot be used
 * inside a `@media`/`@container` condition at all, so a numeric comparison in JS
 * (against a `ResizeObserver` measurement) is the real consumption path.
 */
export const breakpoints: Record<BreakpointKey, number> = Object.fromEntries(
  BREAKPOINT_KEYS.map((key) => [key, parseInt(civitaiBreakpointsSource[key], 10)])
) as Record<BreakpointKey, number>;
