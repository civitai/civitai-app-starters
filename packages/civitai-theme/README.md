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

Two kinds of token depart from that. The **breakpoint scale** bypasses the
Mantine pipeline entirely (see below), and a few tokens declare an explicit
**light/dark pair** — see next section.

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

## Scheme-paired tokens

A custom property inherits across a shadow boundary; an ancestor selector does
not cross one. So a component that wanted "gray in light, surface in dark" could
only say it as `[data-theme='dark'] <descendant>` in `@civitai/components`, which
a shadow root can never match (`:host-context()` has never shipped in Firefox).

Those decisions are tokens now — `--civitai-card-border-width`,
`--civitai-color-track`, `--civitai-color-segmented-bg` and
`--civitai-color-media-placeholder`. Mantine has no variable that carries either
side of these pairs, so `TokenSpec.source` and `.literal` each accept a
`{ light, dark }` pair, resolved against its own scheme's variable map.

`--civitai-card-border-width` is a **width**, not a color: dark drops the default
hairline's box, and a transparent color would still occupy 1px on every card.

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
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme/styles.css" />
```

Unversioned on purpose: it tracks the `latest` dist-tag, so the tokens you load
always include the ones documented above. A pinned URL keeps returning **200
with an old stylesheet** — `@0.2.0`, the version this README shipped until now,
carries **zero** `--civitai-bp-*` tokens, so every `var(--civitai-bp-md)` on
this page resolved to nothing. Pin only if you need a reproducible build, and
re-check the pin when you upgrade.

```ts
import { injectTokens, tokens } from '@civitai/theme';
injectTokens();          // inject the stylesheet at runtime (JS consumers)
tokens.colorPrimary;     // "#228BE6"
```

Theme by setting `data-theme="light" | "dark"` on any ancestor.

**Dark is the base, and nothing here consults the OS.** `:root` carries the dark
palette plus `color-scheme: dark`, so an element with no `data-theme` above it is
dark — on any machine, under any OS preference. `[data-theme='light']` is a full
mirror of the light palette and is the only thing that puts light back;
`[data-theme='dark']` restores dark inside a light subtree. The attribute is the
override and it wins wherever it sits, because a nearer ancestor's tokens inherit
over a farther one's.

### Recolouring a token (brand overrides)

🔴 **Put a token override on a SCOPE, never on `:root`.** This sheet carries no
cascade layer, and its `:root` / `[data-theme='…']` blocks sit at specificity
`0-1-0` — so a consumer's `:root { --civitai-color-primary: … }` does not
outrank them, it **ties**, and the last stylesheet in the document wins.

```css
.my-block { --civitai-color-primary: #a259ff; }   /* ✅ wins in either order */
:root     { --civitai-color-primary: #a259ff; }   /* ⚠️ wins only if this sheet loaded FIRST */
```

The same goes for an inline `style="--civitai-color-primary: …"`, and a scoped
value reaches **inside** component shadow roots, because custom properties cross
the boundary.

⚠️ **The `:root` form fails silently in the order the framework produces.**
`@civitai/blocks-react`'s `useBlocksStyles()` calls `injectTokens()` from a
`useEffect`, so these tokens are appended **after** a bundler-injected app
stylesheet. Measured in Chromium: a `:root` override in that order resolves to
this theme's own value with no error — with or without `data-theme` present, so
the theme attribute is not the cause. The full order × route matrix is pinned in
`@civitai/components`' `test/token-override-order.browser.test.ts`.

**What you cannot do:** define a theme of your own. This package exports token
*values* and `injectTokens(doc?)`; the generator is internal, and only the
literal strings `light` and `dark` select a token block — `data-theme="mybrand"`
selects none and inherits the dark base. Recolour the token set; there is no
named-theme API.

There is deliberately **no** `@media (prefers-color-scheme: …)` block, in either
direction. The browser must not decide a Civitai surface's theme: civitai.com is
dark, and an App Block boots dark and takes light only from its host. ⚠️ Until
`0.5.0` the opposite was true — `:root` was light and dark arrived via
`@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` — so every
surface that must not follow the OS had to set `data-theme` explicitly just to
defeat it. If you added such an attribute for that reason alone, you can drop it.

Note on the JS exports, which did **not** change: `tokens` is still the LIGHT
map and `darkTokens` the dark one. So `tokens` no longer describes what `:root`
emits — read it as "the `[data-theme='light']` values". That naming is kept
deliberately, so this release breaks one thing (the CSS default) rather than two.

## Build

`pnpm --filter @civitai/theme build` regenerates `src/tokens.generated.ts`,
`dist/tokens.css`, and `dist/tokens.dtcg.json`, then compiles with `tsc`.
