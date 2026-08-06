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

Two guards keep it honest (`pnpm --filter @civitai/theme test`):

- **drift guard** — reads civitai/civitai's live `ThemeProvider.tsx` and fails
  if the vendored palette/`white`/`black` diverge (set `CIVITAI_REPO`; skips
  with a clear message when the checkout is absent).
- **generation parity** — the committed generated source + built artifacts must
  byte-match a fresh generation, so a stale hand-edit can't slip through.

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
