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

Deleting a number only helps if something holds the relationship, so this adds
that: `packages/civitai-app-sdk/test/blocks/scopes.test.ts` now asserts
`BLOCK_SCOPES` and the **vendored canonical schema**'s
`properties.scopes.items.enum` hold exactly the same strings, failing if either
side grows *or* shrinks.

🔴 That is a different claim from the test beside it, which cannot substitute
for it. The existing test compares `BLOCK_SCOPES` against
`CANONICAL_BLOCK_SCOPES`, a literal transcription of the server constant
maintained *in the same file* — both halves move in one edit. The new one
compares against the vendored schema, a separate artifact re-vendored from the
deployed `civitai.com/schemas/app-block/v1.json`, and the schema is what
actually validates a manifest. Proven distinct by mutation: removing a scope
from the schema alone fails **exactly one** test — the new one — while the
existing test stays green.

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
than a fresh characterisation. This docblock is the upstream source of a defect
already corrected downstream in the developer docs, so leaving it would let a
regenerate re-import the error.
