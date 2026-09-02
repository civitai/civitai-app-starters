# @civitai/theme

Framework-agnostic **design tokens**, derived at build time from civitai's real
Mantine theme. Ships three forms of the same `--civitai-*` token contract:

- `dist/tokens.css` — a `:root` + `[data-theme='light'|'dark']` stylesheet
  (`--civitai-*` custom properties; `<color>` tokens registered via `@property`).
- typed JS — `import { tokens, darkTokens, tokenVars, tokensCss } from '@civitai/theme'`.
- `dist/tokens.dtcg.json` — a W3C **Design Tokens Community Group** export
  (`$value`/`$type`/`$description`) for interop with token tooling.

## Why generated (not hand-authored)

The tokens are produced by feeding a vendored copy of civitai's `createTheme`
override (`src/theme.source.ts`) through Mantine's **public** pipeline —
`mergeMantineTheme` → `defaultCssVariablesResolver` → transitive `var()`
resolution → re-namespaced `--civitai-*`. This is the same primitive civitai
uses in `mantine-css-variables.ts`. `--mantine-*` is fully resolved away, so the
`--civitai-*` contract is self-contained.

The one exception is the **breakpoint scale**, which deliberately bypasses the
Mantine pipeline — see below.

Four guards keep it honest (`pnpm --filter @civitai/theme test`):

- **drift guard** — reads civitai/civitai's live `ThemeProvider.tsx` and fails
  if the vendored palette/`white`/`black` diverge (set `CIVITAI_REPO`; skips
  with a clear message when the checkout is absent).
- **breakpoint drift guard** — same, against civitai's
  `src/utils/breakpoints.json`.
- **generation parity** — the committed generated source + built artifacts must
  byte-match a fresh generation, so a stale hand-edit can't slip through.
- **px-not-em guard** — self-contained; pins the breakpoint tokens to the px
  scale and asserts the em values are absent.

## Breakpoints — 🔴 the px scale, not Mantine's em scale

civitai has **two** breakpoint scales and they agree on exactly one key:

| scale | xs | sm | md | lg | xl |
|---|---|---|---|---|---|
| **px** — `src/utils/breakpoints.json`, mirrored by Tailwind and `mantineContainerSizes`. **This package emits this one.** | 480 | 768 | 1024 | 1184 | 1440 |
| Mantine's stock **em** scale — never overridden in civitai; what every Mantine responsive prop uses | 576 | 768 | 992 | 1200 | 1408 |

Only `sm` matches, so a wrong implementation *looks* correct at a glance and a
test that pins `sm` alone passes against the wrong scale. The px scale is
therefore vendored in its own module (`src/breakpoints.source.ts`), guarded
directly against `breakpoints.json`, and emitted as a **literal** token spec that
never touches `mergeMantineTheme` — routing it through the Mantine resolver is
exactly how an un-overridden key would silently come back as the em value.

```ts
import { breakpoints, BREAKPOINT_KEYS, tokens } from '@civitai/theme';
breakpoints.md;          // 1024   ← use this for a JS width comparison
tokens.bpMd;             // "1024px"
// CSS: var(--civitai-bp-md)
```

Use the **numeric** `breakpoints` for width comparisons: a CSS custom property
cannot appear inside a `@media`/`@container` condition, so `--civitai-bp-*` is
for lengths (`max-width`, `grid-template-columns`), not for conditions. React
blocks should use `useBlockBreakpoint()` from `@civitai/blocks-react`, which
resolves the block's own measured width against this scale.

## Usage

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme@0.2.0/styles.css" />
```

```ts
import { injectTokens, tokens } from '@civitai/theme';
injectTokens();          // inject the stylesheet at runtime (JS consumers)
tokens.colorPrimary;     // "#228BE6"
```

Theme by setting `data-theme="light" | "dark"` on any ancestor.

## Build

`pnpm --filter @civitai/theme build` regenerates `src/tokens.generated.ts`,
`dist/tokens.css`, and `dist/tokens.dtcg.json`, then compiles with `tsc`.
