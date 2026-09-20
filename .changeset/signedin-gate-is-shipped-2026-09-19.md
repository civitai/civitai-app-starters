---
'@civitai/app-sdk': patch
'@civitai/blocks-react': patch
---

`viewer?.signedIn === true` is now the documented sign-in gate — the host ships it

`civitai/civitai#3707` **merged 2026-08-07**. Seventeen sites across both
packages and two reference starters still asserted it was "OPEN and unmerged",
including four occurrences inside `@civitai/app-sdk`'s published
`dist/blocks/types.d.ts` — i.e. in the editor tooltip an author hovers while
deciding which gate to write.

Re-verified against `civitai/civitai` `main` (via `gh api`, not a local
checkout):

- `src/components/AppBlocks/projectBlockInit.ts` exports `withSignedInFlag()`,
  which returns `null` for an anonymous viewer and `{ id, username, signedIn:
  true }` otherwise. **Both** host surfaces funnel through it — `IframeHost`
  (model slot) and `PageBlockHost` (full page) — so there is no half-covered
  fleet.
- That repo's contract test (`__tests__/projectBlockInit.test.ts`) pins
  `Object.keys(viewer).sort()` as exactly `['id', 'signedIn', 'username']` and
  asserts the value is literally `true`, not a computed boolean.

**What changed, beyond prose.** The two reference block apps
(`civitai-block-starter`, `examples/hello-world`) gated on `viewer !== null` and
carried a prominent, well-argued warning AGAINST `viewer.signedIn` — resting
entirely on the now-false premise that production did not send it. Both now gate
on `viewer?.signedIn === true`, and so does the `useBlockContext` quickstart in
the `@civitai/blocks-react` README.

**And the defect that made that switch unshippable.** All seven starter dev
harnesses hand-build their `BlockInitPayload` (they do not go through
`createMockHost`, so the existing `DEFAULT_VIEWER` fence could not see them) and
every one posted `viewer: { id: 2, username: 'dev-viewer', status: 'active' }`.
That is wrong in both directions at once: it OMITS `signedIn`, which production
always sends — so a block using the documented gate would have rendered
"anonymous" against its own `dev:harness` — and it ADDS `status`, which the
platform deliberately withholds from third-party iframes (civitai #2521), so a
block reading it would pass every local run and get `undefined` in production.
All seven now post `{ id, username, signedIn }`.

`viewer !== null` remains correct and is still documented as the fallback: the
wire shape is frozen at object-or-null, so the two gates agree. `signedIn` is
preferred because it is the field that outlives the `@deprecated`
`id`/`username`.

Three sites were not stale comments but standing **instructions to delete
now-correct code** — "IF #3707 IS ABANDONED: drop `signedIn` from…", "IF #3707
NEVER LANDS, this assertion is what has to change first", "what to unwind if
#3707 is abandoned". Their precondition resolved the other way; a maintainer
following one would have removed working support for a shipped contract. They
are deleted, and what each was protecting is restated pointing the right way.

Two new repo guards (not shipped in either package) stop the class rather than
this instance: `tests/guards/civitai-pr-status-claims.test.mjs` fails on any
source comment asserting a `civitai/civitai#NNNN` is open, unmerged or
abandoned, and `tests/guards/starter-signin-gate.test.mjs` pins every starter
harness's viewer key set against `createMockHost`'s `DEFAULT_VIEWER` — a
relationship, so neither side can move alone.
