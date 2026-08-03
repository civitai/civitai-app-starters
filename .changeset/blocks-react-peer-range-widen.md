---
'@civitai/blocks-react': patch
---

Widen the `@civitai/app-sdk` peer range to `>=0.29.0 <1.0.0` (was `^0.28.0`).

`^0.28.0` on a **0.x** package means `>=0.28.0 <0.29.0`, so every SDK *minor* put the
peer out of range. With `onlyUpdatePeerDependentsWhenOutOfRange: true` in
`.changeset/config.json`, changesets then promotes the peer-dependent to a **major** —
which is why the first release after the Batch-D SDK minor computed
`@civitai/blocks-react` **1.0.0** out of four changesets that all declared `minor`.

That was mechanical, not a stability declaration, and it recurred: the regenerated
range would have been `^0.29.0`, taking the next SDK minor to `2.0.0`, then `3.0.0` —
one major burned per SDK minor.

With the range spanning the whole 0.x line, an SDK minor stays in range and
`blocks-react` versions on its own changesets again (verified: this release now
computes `0.38.0` / `0.29.0`, and the range is not rewritten).

The floor is `0.29.0`, not `0.28.0`: this package's `useSaveImage` /
`useSharedStorage` hooks depend on message types that ship in the same release, so
`0.28.0` is not a compatibility claim that can be substantiated.
