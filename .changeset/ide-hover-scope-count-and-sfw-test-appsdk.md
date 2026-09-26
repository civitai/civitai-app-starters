---
'@civitai/app-sdk': patch
---

Two stale JSDoc claims that ship to IDE hover. Both are comments on exported
symbols, so they reach every consumer through the emitted `.d.ts` — a reader
never navigates to them, they arrive unbidden at the call site.

Documentation only — no API, type or behaviour change. Verified mechanically:
running this repo's own `tests/guards/lib/strip-comments.mjs` over base and head
for both files leaves byte-identical output, so `tsc` is unaffected by
construction (and `pnpm typecheck` exits 0).

**(a) `src/blocks/scopes.ts` — `BLOCK_SCOPE_PATTERN` said "the 12 values in
{@link BLOCK_SCOPES}".** There are **13**, in the same file, fifty lines above.
This was flagged and deliberately deferred by the changeset that fixed the same
package's README count ("a third stale figure, in source").

The figure is **gone, not corrected** — the same remedy that README change
chose, and for the same reason: a count in prose is unguarded by every check in
this repo, and this vocabulary has both gained and lost members over time
(`catalog:read`, `media:read:owned` and `block:settings:*` were each declared
and then removed). The sentence now reads "exactly the values in
`BLOCK_SCOPES`", which stays true across any future change to the set.

Alongside it, `packages/civitai-app-sdk/test/manifest/canonical-derivation.test.ts`
gains an assertion that `BLOCK_SCOPES` and the **vendored canonical schema**'s
`properties.scopes.items.enum` hold exactly the same strings, failing if either
side grows *or* shrinks.

🔴 **That guard is NOT justified by the comment edit, and an earlier draft of
this changeset said it was.** It re-instates a guard a refactor dropped:
`test/blocks/schema-parity.test.ts` carried this claim — *"DRIFT GUARD: the
schema's scope enum is EXACTLY the SDK's BLOCK_SCOPES set. If either side
gains/loses a scope without the other, this fails"* — until `d41293d` (#352)
**deleted** that file, rewriting schema-parity as an Ajv-backed **differential**
which judges fixtures rather than constant sets. This assertion went as
collateral. (`BLOCK_CATEGORIES` ↔ the schema's `category` enum went the same way
and is not restored here.)

⚠ Not byte-for-byte the same assertion, and the difference is the one this
section argues about: the historic form compared two `Set`s, which structurally
cannot see a duplicate. The sorted-array form can — so the duplicate case is a
real addition, not something previously guarded and lost.

It earns its place independently of any docstring, because `BLOCK_SCOPES` is a
live enforcement surface in a second package: `civitai-blocks-react`'s
`src/internal/consent.ts` builds `isKnownBlockScope` from
`Object.values(BLOCK_SCOPES)`, while the server and `defineBlock` gate on the
schema enum. Divergence means a scope the server grants that blocks-react
rejects as unknown.

It is also a different claim from the `describe('BLOCK_SCOPES')` beside it,
which compares against `CANONICAL_BLOCK_SCOPES` — a literal transcription kept
in that same file, so both halves move in one edit. Proven distinct by
mutation: removing a **non-shipped** scope from the schema alone fails exactly
one test, the new one, with the other suite green. ⚠ "Exactly one" is a
property of *which* scope is dropped, not of the guard — dropping
`models:read:self`, which every fixture declares, reddens 68 tests as well.

**(b) `src/blocks/messages.ts` — the `maxBrowsingLevel` docblock said
`isSfwCeiling(maxBrowsingLevel)` "is the canonical test" for whether to surface
mature affordances.** The 🔴 warning **eight lines below it** says the opposite:
that field is a property of the DOMAIN, identical for every viewer on
`civitai.red` including one whose own NSFW setting is off, so it cannot answer
"may I show THIS viewer mature content".

The same conflation appeared in the sibling `domain` docblock, and in
`ColorDomain`'s own docblock in `browsingLevel.ts` — which matters because
`ColorDomain` **is** the declared type of `domain`, so the discredited sentence
was one hover away from the corrected one on the same line. All are swept, and
the fix now names the complete recipe rather than a half of it:

```ts
const eff = effectiveBrowsingCeiling(maxBrowsingLevel, effectiveBrowsingLevel);
// 🔴 OPPOSITE POLARITIES — do not copy these two lines as a uniform pair.
if (isSfwCeiling(eff)) hideMatureAffordances();     // true = SFW  ⇒ HIDE
if (isLevelAllowed(BrowsingLevel.R, eff)) showR();  // true = allowed ⇒ SHOW
```

⚠ Two retractions of this changeset's own earlier drafts, because both were
wrong in the direction that misleads. (1) It said the standalone
`isLevelAllowed` "takes the DOMAIN ceiling and answers a different question" —
false: both predicates are ceiling-GENERIC, and the hook implements its members
by calling exactly these two with the effective ceiling. The domain-ness is in
which ceiling you pass, never in the function. (2) It framed
`effectiveBrowsingCeiling` as something to "gate on" — it returns a BITMASK, and
an SFW ceiling is `3`, which is truthy, so branching on it directly shows mature
content to a viewer who may not see it.

This is the third documented instance in this arc of a replacement sentence
being the next defect, so the recipe above is written as code rather than prose.

⚠ **An earlier draft justified (b) by saying a regenerate would re-import the
error into the developer docs. That is FALSE and is retracted.** Measured:
`gen-appblocks-messages.mjs` parses this package's `dist/blocks/messages.d.ts`
with ts-morph for **payload shapes and directions only** — it has no
`getJsDocs`/documentation-comment extraction — and neither *"canonical test"*
nor *"property of the DOMAIN"* appears anywhere in the generated docs (control:
`maxBrowsingLevel` itself IS found in `apps/`, so the search works). The
docblock reaches consumers through **IDE hover on the emitted `.d.ts`**, which
is reason enough; it does not reach the generated pages.
