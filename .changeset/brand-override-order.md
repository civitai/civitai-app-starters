---
"@civitai/components": patch
"@civitai/theme": patch
"@civitai/blocks-react": patch
---

docs: a `:root` token override loses silently, and all three packages told authors otherwise

`@civitai/components`' cascade promise — "every rule lives in
`@layer civitai.components`, so your own unlayered CSS always wins with no
`!important`" — is true of **this package's rules** and false of the **tokens**.
`@civitai/theme`'s sheet carries no cascade layer and declares its tokens at
`:root` / `[data-theme='…']`, specificity `0-1-0`. So an app's own
`:root { --civitai-color-primary: … }` does not outrank them, it **ties**, and
stylesheet order decides.

🔴 **The order that loses is the one the framework itself produces.**
`useBlocksStyles()` injects from a `useEffect`, so the token sheet lands *after*
a bundler-injected app stylesheet. Measured in Chromium: in that order a `:root`
brand override resolves to civitai's own `#1971C2` with no error and no warning
— and it does so with or without `data-theme` present, so the host theme stamp
is not the cause. An author branding a block the obvious way gets civitai blue
and nothing to debug.

Nothing in the three packages said so. The one piece of correct advice that did
exist — `MARKUP.md`'s inline-`style` example — happens to be order-immune, but
read as one option among equals rather than as the route that works.

- `@civitai/components` `MARKUP.md`: *Cascade / overriding* now separates the
  layered rules from the unlayered tokens, says **scope a token override, never
  declare one at `:root`**, and gives the three routes measured to win in either
  order (inline `style`, a class on the block root, and `:root:root` as the
  escape hatch for a document-wide rebrand that genuinely cannot be scoped). It
  also records that a scoped value crosses into component shadow roots.
- `@civitai/components` `README.md`: the same correction on the npm page, where
  the unqualified "your own unlayered CSS always wins" sentence lived; and the
  utilities section's "override the custom properties to retune every utility at
  once" now says *on a scope, not `:root`* — it is the identical trap in the
  spacing scale.
- `@civitai/theme` `README.md`: a *Recolouring a token (brand overrides)*
  section, because this is the sheet with no layer and its own page never
  mentioned the interaction. It also states plainly what is **not** supported:
  the package exports token values and `injectTokens(doc?)`, the generator is
  internal, and only the literal strings `light`/`dark` select a token block, so
  `data-theme="mybrand"` selects none and inherits dark. You recolour the token
  set; there is no named-theme API.
- `@civitai/blocks-react` `src/ui/styles.ts`: the JSDoc that documents the
  injection now owns its consequence. It ships inside the published `.d.ts`, and
  it is the function whose effect-time injection creates the losing order.

Prose and JSDoc only — no behaviour change in any of the three. A patch release
is needed because the published artifacts *are* these documents.

Backed by a new test rather than by reasoning:
`@civitai/components`' `test/token-override-order.browser.test.ts` asserts every
documented route in **both** stylesheet orders (12 cases, two fixture controls
naming the real civitai value the trap resolves to). It deliberately pins the
trap as well as the happy paths, so if the token sheet is ever wrapped in a
cascade layer the file goes red and the cascade change cannot land without
revisiting this prose.
