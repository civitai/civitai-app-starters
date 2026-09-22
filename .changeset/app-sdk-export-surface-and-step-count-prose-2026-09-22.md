---
'@civitai/app-sdk': minor
---

State the root-barrel/subpath relationship and assert it, and derive the workflow step-type counts instead of typing them (#377, #382).

**`minor`, and the only reason it is not `patch`: three types gain a second
import path.** `@civitai/app-sdk/oauth` now re-exports `OAuthTokens`,
`OAuthTokenResponse` and `OAuthClientConfig`. Nothing is removed, nothing is
renamed, and the root specifier's surface is unchanged — byte for byte, the same
68 symbols — so no existing import can break. Everything else here is
documentation and tests.

## #377 — the root barrel was a half-barrel

Measured at `f913811`, through the TypeScript API over the built `.d.ts` of every
`exports` key: the root exposed **68 symbols, 65 of them also reachable from a
subpath**, and 3 — the `types.ts` trio above — reachable from the **root only**,
because `src/index.ts` re-exported `src/types.ts` directly and no subpath did.
That was nobody's decision; it fell out of which file happened to be re-exported
where. The practical cost landed on the subpath: `exchangeCode` and
`refreshToken` live on `./oauth` and **return** `OAuthTokens`, so a consumer of
that subpath could not name their own return type.

The fix is additive on purpose — removing a published export costs a major under
semver, and this package is pre-1.0, where a minor breaks too. `./oauth`
re-exports `types.ts`; the root reaches the trio through that barrel instead of
directly. The root is now **exactly** the union of `./oauth` + `./scopes` +
`./cookies` + `./orchestrator`, and `src/index.ts` says so, along with why each
of the other five subpaths is deliberately *not* on it (module side effects,
node-only APIs, an optional peer that the root would make mandatory).

The README gains an "Entry points, and what the root barrel is" section, and the
three subpaths that had no published-specifier mention anywhere in it — `/oauth`,
`/scopes`, `/cookies` — now appear in the subpath-import example.

`test/export-surface.test.ts` pins all of it: the `exports` key set against a
ledger that carries a reason per key (failing when the set grows *or* shrinks),
root-vs-subpath set equality in both directions, the one deliberate name
collision (`BuzzAccountType` is a different, narrower type on `./blocks`), and
the root's 68 symbols enumerated so a future removal cannot be silent.

## #382 — sixteen prose sites said 47; there are 50

`44a79dc` (#315) synced `WORKFLOW_STEP_TYPES` to the live orchestrator spec and
left every prose "47" behind. The stale number was the visible symptom; the real
defect was the argument built on it. The docs claimed a `$type`-keyed lookup "is
only sound as a lookup if it is total over `WorkflowStepType`" — and the same
commit made the map partial, so `WorkflowStepTemplateFor<'imageScanning'>` has
been a live `TS2344` for three documented step types, undocumented. The
compile-time ledger said "Empty (`never`) today" eleven lines above its own
populated gap list.

The gap cannot be closed here: `@civitai/client@0.2.0-beta.98` generates no
template for `imageScanning`, `preprocessVideo` or `yuE2`. So the totality claim
is **removed** and replaced with the measured state, stated identically in
`src/orchestrator/steps.ts` and the README, and the three `TS2344`s are pinned as
`@ts-expect-error` aliases so the consequence is demonstrated rather than
asserted.

No count is typed by hand any more. `test/orchestrator/step-count-prose.test.ts`
derives the catalog size from `WORKFLOW_STEP_TYPES`, the map size from
`StepTemplateMap`'s own AST, and the gap from the difference, then pins each
prose claim **as a whole normalised sentence** with the derived values
substituted — a guard on the digits alone is walkable by rewording. A coverage
sweep then fails on any remaining integer in `[30, 199]` that no claim or
allowlist entry accounts for, so a seventeenth site cannot arrive unpinned.
