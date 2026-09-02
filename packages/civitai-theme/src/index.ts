/**
 * `@civitai/theme` — framework-agnostic design tokens.
 *
 * Public surface:
 *   - `tokens` / `darkTokens` / `tokenVars` — typed token values (generated).
 *   - `tokensCss` — the full `--civitai-*` stylesheet string.
 *   - `injectTokens(doc?)` — inject the stylesheet at runtime (JS consumers).
 *   - `breakpoints` / `BREAKPOINT_KEYS` — civitai's PX breakpoint scale as
 *     numbers, for JS width comparisons. (The matching `--civitai-bp-*` CSS
 *     tokens are in `tokens`/`tokensCss` as `<length>` strings; a custom
 *     property cannot appear in a `@media`/`@container` condition, so the
 *     numeric form is what a responsive branch actually consumes.)
 *
 * Non-JS consumers link the stylesheet directly:
 *   `<link rel="stylesheet" href="@civitai/theme/styles.css">`
 * or fetch the DTCG export at `@civitai/theme/tokens.json`.
 */
export { tokens, darkTokens, tokenVars, tokensCss, type TokenName } from './tokens.generated.js';
export { injectTokens } from './inject.js';
export {
  BREAKPOINT_KEYS,
  breakpoints,
  civitaiBreakpointsSource,
  type BreakpointKey,
} from './breakpoints.source.js';
