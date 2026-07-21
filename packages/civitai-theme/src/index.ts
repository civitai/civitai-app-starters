/**
 * `@civitai/theme` — framework-agnostic design tokens.
 *
 * Public surface:
 *   - `tokens` / `darkTokens` / `tokenVars` — typed token values (generated).
 *   - `tokensCss` — the full `--civitai-*` stylesheet string.
 *   - `injectTokens(doc?)` — inject the stylesheet at runtime (JS consumers).
 *
 * Non-JS consumers link the stylesheet directly:
 *   `<link rel="stylesheet" href="@civitai/theme/styles.css">`
 * or fetch the DTCG export at `@civitai/theme/tokens.json`.
 */
export { tokens, darkTokens, tokenVars, tokensCss, type TokenName } from './tokens.generated.js';
export { injectTokens } from './inject.js';
