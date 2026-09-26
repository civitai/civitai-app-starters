---
'@civitai/app-sdk': patch
---

JSDoc corrections that ship to IDE hover, plus a restored drift guard.

Documentation only — no API, type or behaviour change. Verified by compiling
base and head with `tsc --removeComments` and diffing the emitted trees:
identical, with a one-line code mutation confirmed to make that comparison go
red. `pnpm typecheck` exits 0.

⚠ Note for anyone re-running this: comparing the ORDINARY build output does not
work and an earlier draft of this note said it did. `tsconfig.json` sets no
`removeComments`, so `tsc` emits the JSDoc into both `.js` and `.d.ts` — which
is exactly how these corrections reach IDE hover in the first place, so the
artifacts differ by construction. The comment-stripping comparison is the one
that reproduces.

**(a) `BLOCK_SCOPE_PATTERN` said "the 12 values in {@link BLOCK_SCOPES}".** There
are 13, in the same file fifty lines above. The figure is **removed, not
corrected**: a count in prose is unguarded by every check in this repo, and this
vocabulary has both gained and lost members (`media:read:owned` and
`block:settings:*` were each declared here and then removed; `catalog:read` is
recorded as never having been a scope). The
sentence now reads "exactly the values in `BLOCK_SCOPES`", which stays true
across any future change to the set.

**(b) The maturity docblocks conflated the DOMAIN ceiling with the VIEWER's.**
`maxBrowsingLevel`'s docblock called `isSfwCeiling(maxBrowsingLevel)` "the
canonical test" for surfacing mature affordances, eight lines above a warning
saying that field *cannot* answer that question. The same conflation was in the
sibling `domain` docblock and in `ColorDomain`'s own — which matters, because
`ColorDomain` is the declared type of `domain`, so the wrong advice was one
hover away from the right one on the same line.

All three now carry the same recipe:

```ts
const eff = effectiveBrowsingCeiling(maxBrowsingLevel, effectiveBrowsingLevel);
// 🔴 OPPOSITE POLARITIES — do not copy these two lines as a uniform pair.
if (isSfwCeiling(eff)) hideMatureAffordances();     // true = SFW  ⇒ HIDE
if (isLevelAllowed(BrowsingLevel.R, eff)) showR();  // true = allowed ⇒ SHOW
```

Two things worth knowing if you gate on these:

- `effectiveBrowsingCeiling` returns a **bitmask, not a boolean**. An SFW
  ceiling is `3`, which is truthy — branching on it directly shows mature
  content to a viewer who may not see it. It needs one of the two predicates.
- Both predicates are **ceiling-generic**: they test whatever ceiling you pass.
  The domain-ness is in the argument, never in the function. Their `@param`
  docs previously described the parameter as the domain mask, which is how the
  wrong call site looks right; they now say to pass the effective ceiling when
  gating for a viewer.

⚠ The fail-closed enumeration on both predicates covers missing / null /
non-finite ceilings. A **negative** ceiling is none of those and fails OPEN
(`isSfwCeiling(-1)` is `false`; `isLevelAllowed(XXX, -1)` is `true`), and
`effectiveBrowsingCeiling` guards a negative *viewer* level but not a negative
*domain* ceiling. That behaviour is unchanged here and is now stated rather than
implied; tightening it is a behaviour change and belongs in its own release.

**(c) A drift guard a refactor dropped is restored.**
`test/manifest/canonical-derivation.test.ts` again asserts that `BLOCK_SCOPES`
and the vendored canonical schema's `properties.scopes.items.enum` hold exactly
the same strings, failing if either side grows or shrinks, plus a duplicate
check.

`test/blocks/schema-parity.test.ts` carried this claim until `d41293d` (#352)
deleted that file, rewriting schema-parity as an Ajv-backed differential which
judges fixtures rather than constant sets. ⚠ Not byte-for-byte the same
assertion: the historic form compared two `Set`s, which structurally cannot see
a duplicate.

It earns its place independently of the docs: `BLOCK_SCOPES` is a live
enforcement surface in a second package — `civitai-blocks-react`'s
`src/internal/consent.ts` builds `isKnownBlockScope` from
`Object.values(BLOCK_SCOPES)` — while the server and `defineBlock` gate on the
schema enum. Divergence means a scope the server grants that blocks-react
rejects as unknown.
