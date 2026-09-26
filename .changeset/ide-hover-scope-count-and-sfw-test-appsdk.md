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
`test/blocks/schema-parity.test.ts` carried exactly this assertion — *"DRIFT
GUARD: the schema's scope enum is EXACTLY the SDK's BLOCK_SCOPES set. If either
side gains/loses a scope without the other, this fails"* — until `d41293d`
(#352) rewrote that file as an Ajv-backed **differential**, which judges
fixtures rather than constant sets, taking this assertion as collateral.
(`BLOCK_CATEGORIES` ↔ the schema's `category` enum went the same way and is not
restored here.)

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

The same conflation appeared in the sibling `domain` docblock, which told
readers to derive "is this SFW?" from `maxBrowsingLevel`. Both now defer to
`useDomainMaturity()` / {@link effectiveBrowsingLevel}, which is what the
`effectiveBrowsingLevel` field's own docblock in this file — and
`browsingLevel.ts`'s `isSfwCeiling` and `effectiveBrowsingCeiling` docblocks —
have said all along. `isSfwCeiling` is still named for the question it does
answer ("is this DOMAIN SFW?"), because that function is correct and correctly
documented where it is defined.

No new explanation was written for (b): the wording is taken from the sibling
field's existing docblock, so this is the package agreeing with itself rather
than a fresh characterisation.

⚠ **An earlier draft justified (b) by saying a regenerate would re-import the
error into the developer docs. That is FALSE and is retracted.** Measured:
`gen-appblocks-messages.mjs` parses this package's `dist/blocks/messages.d.ts`
with ts-morph for **payload shapes and directions only** — it has no
`getJsDocs`/documentation-comment extraction — and neither *"canonical test"*
nor *"property of the DOMAIN"* appears anywhere in the generated docs (control:
`maxBrowsingLevel` itself IS found in `apps/`, so the search works). The
docblock reaches consumers through **IDE hover on the emitted `.d.ts`**, which
is reason enough; it does not reach the generated pages.
