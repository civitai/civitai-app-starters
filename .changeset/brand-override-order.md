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

- `@civitai/components` `src/components.css`: 🔴 **the sheet's own header
  carried the unqualified promise this release retracts** — *"ALL rules live in
  `@layer civitai.components` so a consumer's own unlayered CSS always wins the
  cascade WITHOUT specificity fights"* — and it is single-sourced into **16**
  generated artifacts by `pnpm --filter @civitai/components generate`, so it was
  the most-published copy of the wrong claim and the last one anyone would look
  at. Now scoped to *this sheet* with the token exception stated. One edit,
  sixteen artifacts.
- `@civitai/components` `MARKUP.md`: *Cascade / overriding* now separates the
  layered rules from the unlayered tokens, says **scope a token override, never
  declare one at `:root`**, and gives the routes measured to win in either order
  (inline `style`, or a class on the block root). It also records that a scoped
  value crosses into component shadow roots. This is the CANONICAL copy; the
  others below point at it rather than restating it.
- `@civitai/components` `README.md`: the correction on the npm page, where the
  unqualified "your own unlayered CSS always wins" sentence lived — cut to the
  one-clause rule plus the `MARKUP.md` link it already carried. The utilities
  section's "override the custom properties to retune every utility at once" now
  says *on a scope, not `:root`*, noting that those tokens live in a **different**
  unlayered sheet (`utilities.css`) of identical structure — the same shape by
  construction, not separately measured.
- `@civitai/theme` `README.md`: a *Recolouring a token (brand overrides)*
  section, because this is the sheet with no layer and its own page never
  mentioned the interaction. It also states plainly what is **not** supported:
  the package exports token values and `injectTokens(doc?)`, the generator is
  internal, and only the literal strings `light`/`dark` select a token block, so
  `data-theme="mybrand"` selects none and inherits dark. You recolour the token
  set; there is no named-theme API.
- `@civitai/blocks-react` `src/ui/styles.ts`: the JSDoc that documents the
  injection now owns its consequence — it ships inside the published `.d.ts`,
  and this is the function whose effect-time injection creates the losing order.
  Kept to the ownership sentence plus a pointer: a JSDoc paraphrase of another
  package's README, on another release cadence, is a desync nothing in CI can
  see, and this repo has already measured that exact failure once.
- `@civitai/theme` `test/generation-parity.test.ts`: a one-line node-tier
  assertion that the emitted sheet contains no `@layer`. That is the **defining**
  property consumers depend on, and until now it was asserted nowhere — the
  parity test stays green if you layer, because both sides of the comparison
  move together.

Prose and JSDoc only — no behaviour change in any of the three. A patch release
is needed because the published artifacts *are* these documents.

Backed by tests rather than by reasoning, at two levels:
`@civitai/components`' `test/token-override-order.browser.test.ts` asserts every
documented route in **both** stylesheet orders, with fixture controls naming the
real civitai value the trap resolves to; and the theme-package line above pins
the property those cases are a consequence of. It deliberately records the trap
as well as the happy paths — but as EVIDENCE, not as the tripwire: any cascade
change that lets an unlayered app `:root` win falsifies the order-dependent
cases, including `:where(:root)` and not only `@layer`, so the one-line
theme-package assertion is what a cascade change actually trips first.

Not documented, deliberately: `:root:root`. The specificity notch does beat the
theme's blocks in both orders, but nobody asked for it, it has no named
consumer, it teaches a specificity hack, and it buys nothing a scoped override
does not already buy unconditionally.
