# Fleet port scoping — 2026-09-24

Companion to `handoff-civitai-app-platform-migration.md`. That doc is already 9.3× its
`handoff-audit.py` target, so the per-app port plans live here instead of inflating it further.

Five read-only scoping agents were dispatched in parallel on 2026-09-24 to plan the migration of
the storage-blocked fleet apps off `@civitai/blocks-react` onto `@civitai/sdk`. Each was told to
**assume** the app-storage REST adapters (built concurrently on `feat/app-storage-rest` in
`civitai/civitai`) will mirror the tRPC `appsStorageRouter` contract —
`get`/`set`/`delete`/`list`/`getQuota` in `src/server/routers/apps.router.ts:462`.

🔴 **If `feat/app-storage-rest` shipped a different shape, every plan here needs re-reading against
what it actually merged.** That is the one coupling across the whole fan-out.

---

## `civitai-app-sensei` (branch `trunk`) — port LAST, in two stages

### 🔴 The premise I briefed this agent with was WRONG, and the correction is the headline
I told the agent sensei's suite was "dominated by bridge-transport e2e specs". **It is not.** I
inferred that from file NAMES (`*.e2e.test.tsx`) without reading their contents — the exact shape
of error this repo's rules warn about. Measured, and re-verified first-hand rather than taken from
the agent:

- `postMessage|MessageChannel|MessageEvent|window.parent` across all 30 test files → **3 hits, all
  three inside comments** (`citation-grounding.e2e.test.tsx:334`, `delete-session-scope.e2e.test.tsx:238`,
  `tool-calling.e2e.test.tsx:231`). **Zero test files drive the bridge.**
- ⚠ That is a ZERO, and my first control for it FAILED — the same sweep over the already-ported
  `civitai-app-requests` also returns nothing, because its tests were rewritten to a fake `fetch`.
  So the zero alone proves little. The load-bearing measurement is the POSITIVE one below.
- **23 of 30** test files use a `vi.mock('@civitai/blocks-react', …)` factory returning plain
  object stubs, and `App.tsx` already declares a dependency-injection seam —
  `interface AppDeps` (`:46`), `App({deps: depsOverride})` (`:301`), merged at `:320`. The suite
  tests the app's own logic through a stub boundary, not through the wire.

So the feared cost — rewriting a transport-coupled suite — does not exist. The real cost is bulk.

### Inventory
**47 files** import `@civitai/blocks-react` (17 source, 30 test), plus 10 importing
`@civitai/blocks-react/ui`. Concentrated, not spread: `App.tsx` is **3,240 LOC** and
`lib/orchestrator-bridge.ts` **1,025 LOC**. For scale, the whole `app-requests` port was 36 files,
+1745/−217, against a 1,300-line App.

### Blockers
1. **`useAppStorage`, 24 files** — chat session transcripts. Per-viewer, not derivable
   server-side, the only copy. Hard dependency on the app-storage REST work.
2. **The workflow surface, 28 files** — `/api/v1/blocks/workflows/*` is committed (`2a2eb0fe2f`)
   but dark in production. 🔴 **Do NOT substitute `AppClient.orchestration`**: that is the raw
   orchestrator, while the blocks route delegates to `blocks.estimateWorkflow`, which its own
   header documents as carrying *"the model-binding check, the page entitlement gate, the maturity
   clamp and the catalog rate-limit bucket"* (`estimate.ts:22-27`). Going direct drops buzz
   metering, entitlement and the maturity clamp — a policy regression, not a transport change.
   The error contract is load-bearing too: `WorkflowEstimateError`/`WorkflowSubmitError` are not
   exported by `@civitai/sdk` and `orchestrator-bridge.ts:452-500` derives which snapshot statuses
   count as refusals.
3. **Component gaps** — `BlockGate`, `injectBlocksStyles`, `Modal`, `ResourceCard`,
   `resourceDisplayName` all absent from `@civitai/components-react` (control: `Button`, `Stack`,
   `Group`, `Loader`, `Textarea`, `Slider`, `Alert` all resolve in its `src/index.ts:11-29`).
4. **No analytics** — `useBlockAnalytics` has no SDK equivalent (control: sweeping the SDK for
   `storage` hits `sign-in/` and `session/`, so the analytics zero is a real reading). Ship a
   documented no-op shim, as the reference app did.

### Three traps in the test retarget
1. **Retargeting `vi.mock('@civitai/blocks-react')` → `vi.mock('./platform/…')` preserves the
   suite's blindness.** The reference app deliberately moved its fake down to `fetch`
   (`platform/testing.ts:1-13`: *"a mock host would answer a conversation nobody is having any
   more, and the e2e tests would pass while exercising nothing"*). Doing that for 23 files is real
   work and is the only version that tests the new client.
2. **`staleReadAppStorage` may model a hazard that stops existing.** `test-helpers.tsx:64-80`
   documents it as modelling civitai's `QueryClient` `staleTime: Infinity` with no invalidation on
   set. A REST route does not go through that QueryClient — so those four tests must be
   **re-derived against the REST route's real caching**, neither deleted as obsolete nor carried
   over unchanged.
3. **`lib/maturity.ts:33-38` warns** that the `useDomainMaturity: () => ({isSfw: true,
   isLevelAllowed: () => false})` stub repeated across ~22 test files is a fixture value, not the
   contract. Retargeting 23 copies of that literal is where a fail-open regression would hide.

### Verdict
~57 files touched; a new `src/platform/` layer of ~1,800–2,200 LOC (the reference needed 9 files /
1,315 LOC and sensei needs two extra clients plus both error classes re-declared).

**Stage it, and do it last.** Stage 1 = everything except workflows (platform layer, storage,
maturity, UI, tests) — shippable the day the storage routes land, removes ~19 of the 47 importers.
Stage 2 = the workflow surface (28 files), held until `/api/v1/blocks/workflows/*` returns 200.
One 57-file PR cannot be verified against anything real.

**Decide before starting, not at the end:** `ResourceCard` / `resourceDisplayName` have no
replacement anywhere. Either they are added to `@civitai/components-react` upstream, or
`ResourceMention.tsx` (202 LOC) plus two component tests become a local fork.

---

## `civitai-app-model-benchmarking` (branch `main`) — 🔴 the money analysis, and a SECOND platform gap

### 🔴 Without per-viewer storage this app DOUBLE-CHARGES Buzz — it does not merely degrade
The chain, as reported by the scoping agent (app-side reading is theirs; re-check in `src/App.tsx`
before relying on it — the route-gap half below I verified first-hand):

- `src/App.tsx:1518` — the primary double-spend guard `inFlightRef` is an in-memory `Set`, empty
  after any reload.
- `:1587` — `confirmRun` writes a **phase-1 claim BEFORE the spend** into per-viewer KV under
  `inflight:v1:`. That write is what survives a reload.
- `:483-565` — on mount, the rehydrate pages `inflight:v1:` and re-renders running cells as
  in-flight rather than runnable.
- `:1539-1565` — the backstop: when the scan reports truncation, `confirmRun` does an O(1) `get`
  before spending and adopts the run on a hit. `:555` is the ONLY place it is stood down, and only
  on `scan.truncated === false`.

Three failure shapes, and **the safest-looking one is the worst**:

| storage state | outcome |
|---|---|
| writes unavailable | claim fails → run REFUSED (`CLAIM_FAILED_MESSAGE`). Fails safe, but no cell can ever run — the product's core loop is dead. |
| reads down, writes up | the backstop stays armed, but its own `get` throws and `:1560-1564` deliberately falls through and SPENDS. **Double-charge.** |
| 🔴 reads return 200 with `{keys: []}` | scan COMPLETES, reports `truncated: false`, **disarms the backstop at `:555`**, and `confirmRun` then does no store read at all. Every reload is a clean double-charge with the guard explicitly disabled. **An adapter that answers "no keys" is more dangerous than one that throws.** |

These were sent to the agent building `feat/app-storage-rest` as constraints on its routes:
`list` must **401 on auth failure, never 200-with-empty**; `nextCursor` must be absent exactly when
there are no more rows (the tRPC procedure already does this — `apps.router.ts:1060-1063`); `set`
must **reject** on failure rather than resolve `{ok:false}`; keep the
`{keys:[{key,updatedAt}], nextCursor}` envelope and honour `limit`.

### 🔴 NEW — a SECOND platform gap: `usePublishGenerationOutputs` has no REST twin
**Verified first-hand, with a positive control.** `find src/pages/api/v1/blocks -type f -print0 |
xargs -0 grep -l 'publishGenerationOutputs'` → **0**; the same command for `submitWorkflow` →
`workflows/submit.ts`. It exists only as tRPC (`blocks.router.ts`), and `@civitai/sdk`'s
`HostRequests` is only four ops — `SAVE_IMAGE`, `OPEN_RESOURCE_PICKER`, `OPEN_BUZZ_PURCHASE`,
`REQUEST_TOKEN` — so there is no bridge channel either.

Publish is what turns a run's outputs into the `Image` ids on the shared board, i.e. the entire
results grid. It is also consent-gated with a 10-minute human timeout and re-uploads + full-scans
server-side. **So this app cannot fully leave the bridge today, even after app-storage lands.**
This is a gap Track B missed: the fleet needs app-storage *and* a publish surface.

### Other findings
- **44 files mention `@civitai/blocks-react`, 41 actually import it** (3 are comment-only). Of the
  24 non-test importers, **17 import only `/ui`** — a pure UI swap with no transport change, which
  should be its own commit so a visual regression stays separable from a transport one.
- `POST blocks/workflows/submit` **requires** `idempotencyKey` (`submit.ts:18-22`) where the bridge
  minted it host-side. The app must now mint and persist it — a money-path addition, not a rename.
- `useGatedImages` **loses the `hidden` status**: the REST route reports over-ceiling images by
  omission (`images.ts:114-115`), so a withheld image becomes indistinguishable from a deleted one
  and `GatedCell`'s "Hidden — rated mature" tile can no longer render correctly. UX loss, not a
  leak.
- `token.scopes` is not on `AppClient` — it lives on the transport snapshot. `hasGenerateScope` is
  the consent gate ahead of the spend, so a permissive `token?.scopes ?? []` adaptation fails OPEN.

---

## `civitai-app-playable-collections` (branch `main`) — 33 files, one product decision

### Inventory
**33 files** import `@civitai/blocks-react`. A bare `grep -rl` says 35 — the delta is two CSS files
mentioning it only in comments, not gitignore blindness (`git check-ignore` over `src/**` returns
nothing). 57 test files, ~742 cases.

### The one thing that is a decision, not a refactor: collection follow
`CollectionViewer.tsx:523` renders `<FollowButton>`, driving the bridge op `SET_COLLECTION_FOLLOW`.
`@civitai/sdk` has no such host request, and `@civitai/components-react` has no `FollowButton`. The
REST route **does** exist (`blocks/collections/[id]/follow.ts:19`) but requires
`collections:write:self`, which this app's manifest **deliberately does not declare** (dropped in
0.2.10; reasoning written out at `lib/api.ts:73-80`). Three options, all product calls:
re-declare the scope and hand-roll the per-action consent confirm the host used to own; drop follow;
or add `SET_COLLECTION_FOLLOW` to the SDK host protocol upstream.

### The app-storage dependency here is SOFT — unlike the other four
`browse-prefs.ts` needs only `get`/`set`, and its `restoredRef` invariant means it never writes over
a record it did not read. So a rejecting stub degrades cleanly to session-local prefs with **no data
loss**. This app can therefore port BEFORE the storage routes land, shipping with prefs-don't-persist
as a gated, documented regression. It is the only one of the five where that is true.

### 🔴 Correction to my own earlier correction about `browse-prefs.ts`
I wrote earlier that the file's claim (*"the manifest validator BANS `allow-same-origin`"*) was
"too strong". The agent found the sharper truth, and it is worth stating exactly:
1. `allow-same-origin` is **not manifest-declarable at all** — absent from `ALLOWED_SANDBOX_TOKENS`
   (`sandbox.ts:9-16`), so `intersectSandbox` strips it from any declared string, at any tier.
2. The validator's combination ban is tier-conditional (`block-manifest-validator.service.ts:320-322`,
   fires only when `trustTier !== 'internal'`).
3. The host **injects** it client-side for both trusted tiers (`sandbox.ts:44`,
   `TRUSTED_TIERS = {internal, verified}`), pinned by `sandbox.test.ts:27-31`.
4. This app is `unverified` (manifest declares `allow-scripts allow-forms`; DB default is
   `unverified`, `schema.prisma:2271`).

So the docblock's **conclusion holds but its stated reason is wrong**, and the conclusion is a
property of the app's TRUST TIER, not of the platform — it silently flips the day the block is
promoted to `verified`. Keep app-storage as the mechanism regardless: a substrate that appears and
disappears with a moderation decision is not one to build persistence on.

### Stale claim worth fixing while there
`lib/api.ts:81-83` calls `shared-storage/increment` and `/top` "never-real guessed routes". Both
now exist (`increment.ts:18`, `top.ts:14`). The comment is stale.

---

## `civitai-app-custom-generators` (branch `main`) — 30 files, and the image-upload wall

**30 of 67 `src/*.ts*` files** import `@civitai/blocks-react` (18 root, 10 `/testing`, 9 `/ui`).

**The biggest scope reducer:** 16 files import `@civitai/app-sdk/blocks` for TYPES ONLY, and the
reference port **kept** `@civitai/app-sdk` as a dependency (`git show 52b7e1b -- package.json`
removes only `@civitai/blocks-react`). Those 16 files stay untouched.

### 🔴 `useImageUpload` is a harder blocker than app storage
Two call sites (`App.tsx:172-173`): a moderated `display` upload with `asyncScan` for the public
cover, and a `generationSource` upload for img2img. The bridge op is `OPEN_IMAGE_UPLOAD`; the SDK's
`HostRequests` has no upload op, and there is no REST twin under `/api/v1/blocks` — the real upload
routes are `/api/v1/image-upload/*`, which are **session-cookie** routes, not block-token routes.
The async-scan half (`scanStatus(handle)` → `'scanned' | 'blocked'`) has no surface on either
transport. Options: add `OPEN_IMAGE_UPLOAD` + `IMAGE_SCAN_RESULT` to the SDK protocol (the host
already implements both), or ship with both affordances disabled — `deps.uploadImage`,
`deps.uploadSourceImage`, `deps.scanBackground` are already injectable seams (`App.tsx:84-103`), so
a disabled default is one line each.

### The app-storage dependency here is SMALL
Only 2 files (`App.tsx`, `lib/drafts.ts`), and `DraftStore` (`lib/drafts.ts:29-38`) is already a
narrow structural interface over `get/set/delete/list` with an in-memory fake in tests. The adapter
is ~1 new file plus one line in `App.tsx`.

### Other notes
- `useRequestConsent` gets **better**: `requestGrants` returns an awaited `boolean`, so the
  `ai:write:budgeted` retry loop becomes `if (await requestGrants([...])) retry()`.
- `useBuzzPurchase` is **lossy**: the protocol result carries `newBalance?` but `createHost`
  destructures only `purchased`. Follow with a balance refetch, or patch the SDK.
- Missing from `@civitai/components-react`: `Modal`, `Collapse`, `ReportButton`, `BlockGate`.
- One reference-port change that does **not** carry over: `app-requests` inverted a tablist →
  radiogroup a11y assertion. This app's `Browse.tsx:10` genuinely has `role="tabpanel"` per tab —
  keep the tablist.

---

## `civitai-app-gen-matrix` (branch `main`) — only 10 importers, but it CANNOT reach zero

**10 files** import `@civitai/blocks-react`. The stale second checkout
(`civitai-block-gen-matrix`, `feat/production-hardening`) reports **5** and 23 source files against
`main`'s 10 and 44 — it under-reports by 2×. Any number sourced from it is half the real surface.

Small file count, large app: `App.tsx` is **3,550 lines** with **15 hooks**, and the test suite is
641 tests across 25 files of which only **2** touch the bridge at all (the rest use hand-rolled
structural stubs — `history.test.ts:20` says so explicitly). So the test cost is genuinely low.

### 🔴 Three surfaces with no REST twin and no bridge channel — this app cannot close
Beyond app storage, `gen-matrix` needs `useAppWorkflows`, `useGatedImages` and
`usePublishGenerationOutputs`. All three: **0 matching route files of 30** (shared positive control:
`submitWorkflow` → 1), and none is in `HostRequests`.

- **`useAppWorkflows`** — `app.orchestration.queryWorkflows({tags})` is the only candidate and is
  **not equivalent**: the bridge's host FORCES the per-app tag filter server-side ("the block can
  never widen the filter"), whereas the orchestrator client takes tags from the caller. Substituting
  it **moves a trust boundary into the iframe**. This is the sharpest finding in the whole fan-out —
  it would look like a working port.
- **`usePublishGenerationOutputs`** — fail-closed by design (the block sends `workflowId` +
  `imageIndexes`, never urls). Cannot be re-implemented client-side without breaking that property.
- **`useGatedImages`** — `images.ts` is catalog SEARCH with a browsing-level clamp, not per-viewer
  gated display of a given id list, and it has no `visible`/`hidden` discriminator.

**Consequence: `0 blocks-react importers` is not reachable for this app today.** Its PR must state a
reduced count (10 → N) with the three retained surfaces named, rather than pretend at the closing
condition.

### Also
- `ResourceCard` and `ReportButton` re-verified absent from `@civitai/components-react` (48-line
  index; controls `Button:11`, `Badge:28`, `Card:23`, `Image:48` all present). Both exist in
  `blocks-react/src/ui/` and must be re-implemented locally.
- `POST blocks/workflows/submit` **requires** `idempotencyKey`; its docblock says that without it an
  HTTP retry double-charges Buzz.
- `useBuzzPurchase` needs an explicit long timeout or a mid-checkout close reads as "failed".

---

# 🔴 THE FAN-OUT'S HEADLINE: app-storage is NECESSARY BUT NOT SUFFICIENT

Track B concluded "the fleet needs the app-storage platform PR". That was **materially
incomplete**. Five agents reading five apps independently surfaced **five** missing platform
surfaces. All verified first-hand with one shared positive control — `submitWorkflow` → **1** of
**30** route files under `src/pages/api/v1/blocks`:

| surface | REST routes | in `HostRequests`? | blocks |
|---|---|---|---|
| `useAppStorage` | 0 | no | 5 apps — **being built** (`feat/app-storage-rest`) |
| `usePublishGenerationOutputs` | 0 | no | gen-matrix, model-benchmarking |
| `useGatedImages` | 0 | no | gen-matrix, custom-generators, model-benchmarking (partial) |
| `useAppWorkflows` | 0 | no | gen-matrix |
| `useImageUpload` / `OPEN_IMAGE_UPLOAD` | 0 | no | custom-generators |

`@civitai/sdk`'s `HostRequests` is four ops — `SAVE_IMAGE`, `OPEN_RESOURCE_PICKER`,
`OPEN_BUZZ_PURCHASE`, `REQUEST_TOKEN` — so the bridge is not an escape hatch for any of them.

**Two apps cannot reach 0 blocks-react importers even after app-storage lands**: `gen-matrix`
(three surfaces) and `model-benchmarking` (publish). Their PRs must state a reduced count with the
retained surfaces named — not claim the closing condition.

🔴 **The single most dangerous item is `useAppWorkflows`**, because a plausible substitute exists
and it is wrong in a way that type-checks and passes tests: swapping the host-forced tag filter for
a client-supplied one relocates a server-side trust boundary into the iframe.

---

# 🔴 SEAM DEFECT between PR #5085 and `gen-matrix` — nobody owns it, and it fails GREEN

The app-storage REST PR (#5085) flagged one wire difference and explicitly said it did **not**
verify the app side: `updatedAt` crosses REST as an **ISO string**, where the bridge's superjson
revives a **`Date`**. Traced to consumers 2026-09-24:

- 🔴 **`civitai-app-gen-matrix` is a live consumer.** `src/history.ts:96` declares the app-storage
  `list` envelope as `keys: { key: string; updatedAt: Date }[]`, `:68` declares `updatedAt: Date` on
  its entry type, and `:201` maps `k.updatedAt` straight through. `history.test.ts:105` and `:162`
  call **`.getTime()`** on it — which a string does not have.
- ⚠ **It will not necessarily crash, and that is the problem.** The render path is already tolerant:
  `historyAgeLabel(updatedAt: Date | string | number, …)` (`:386`) routes through `timeOf`, which
  handles a string. So production degrades quietly while the declared interface becomes a lie.
- 🔴 **The vacuous-green trap:** if the port's fake server keeps returning a `Date`, the `.getTime()`
  tests stay green and the only place the mismatch appears is production. **The fake MUST return an
  ISO string, matching the wire.** This is the "verified in isolation, defect lives in the seam"
  shape exactly — #5085 tested its side, `gen-matrix` was written against the other side, and no
  test loads both.

**NOT affected — checked before raising it:** `civitai-app-sensei`'s `s.updatedAt` (`lib/sessions.ts:52,295-297`)
is a **number** stored inside the session VALUE, not the storage envelope's field. Different thing;
no action. The other three apps' `updatedAt` hits are shared-storage item fields or test fixtures.

**Fix options:** have #5085 serialise `updatedAt` as the bridge does; or change `gen-matrix`'s
declared type to `string` and its tests with it. Either is fine — but pick one deliberately and pin
it with a test that loads BOTH sides, not one that mocks the boundary away.

---

# 🔴 PR #5085 CI IS RED, and the author's "pre-existing" defence does not cover it

Read 2026-09-24 on head `d97753136a`, both CI surfaces, because neither is a superset of the other:

- **Commit statuses:** 3 of the repo's expected 7 posted — `tekton/typecheck` success,
  `tekton/fixture-bootstrap` success, `preview/deploy` **pending**. NOT settled.
- **Check-runs:** 13 total, and **`ESLint + Prettier (changed files)` = completed/FAILURE**.

🔴 **The red lives ONLY in check-runs** — the statuses surface shows nothing wrong. This is the
inverse-blindness case exactly: a reader checking `mergeStateStatus` or the statuses rollup sees
`MERGEABLE` with no failure and concludes green.

## What actually fails
The failing step is **`ESLint (added files)`** — `.github/workflows/lint.yml:206`. Its log (fetched
with `gh run view <run> --job <job> --log-failed`; ⚠ the skill's
`gh api …/logs --allow-escape-sequences` does NOT exist in `gh 2.96.0` and returns **0 bytes**, so
assert the byte count or you grep an empty file and read it as clean) reports **35 problems**,
`Process completed with exit code 123` (that is `xargs`, not eslint):

- **7 Errors** — `no-empty-function`, all in `src/server/services/apps/app-storage.service.ts`
  (`:828, :929, :952, :974, :1027, :1046, :1052`). **These are the failure.**
- **28 Warnings** — `no-explicit-any` in `src/tests/api/v1/blocks/app-storage-endpoints.test.ts`.
  They annotate and do NOT fail; the step's comment ("Errors only, no `--max-warnings`") is
  **accurate**, checked rather than assumed.

## Why the author's defence misses
PR #5085's report states: *"`eslint --quiet`: 0 errors. The 7 `no-empty-function` errors in the
service file are pre-existing — proven by linting `origin/main:apps.router.ts`, which reports the
identical 7."*

That is **true about the CONTENT and irrelevant to the GATE.** The step is
**`ESLint (added files)`**, and `app-storage.service.ts` is a NEW file. The workflow says why in its
own comment at `lint.yml:202-205`: *"New files start clean, so holding them to the rules costs
nothing."* Moving code out of `apps.router.ts` converted errors that were tolerated in an old file
into **blocking** errors in a new one. The check that was run locally asked "is this code new?"; the
gate asks "is this FILE new?" — different populations, and only the second one gates.

Also note `--quiet` **suppresses warnings**, so a local `eslint --quiet` cannot see the 28 either —
it happens not to matter here, but it means the local command was not the gate's command.

**Fix:** 7 empty arrow functions in one new file. Trivial, and it is the only thing between this PR
and a settled CI — with the caveat that `preview/*` had not posted yet, so a green lint is
necessary, not sufficient.

---

# ROUND 0 on PR #5085 — verdict: `requirement questioned — R6`

Ledger: `round 0 · requirements: 9 (unattributed: 2) · deletion candidates: 4`. Trial-record pair:
`ran: 1 · changed the outcome: 1` — it ran BEFORE the merge decision and surfaced a red gate plus a
refuted central premise, neither of which the nine correctness axes ask about.

## 🔴 The PR's headline justification is refuted by its own tree — all three limbs re-verified here

PR #5085 rejected #5068's tRPC-caller shape on the claim that *"on **any** REST transport
`ctx.user` is undefined"*, so a caller would **degrade** the app-blocks gate.

1. **FALSE, and the counter-example is in a file this PR edits.** `block-workflow-rest.ts:154`
   defines `blockFliptUser(req)` — it reads `claims.sub`, resolves the user, and `:188` passes
   `user: fliptUser` into the caller context with `:190` feeding `getFeatureFlagsLazy`. #5068 already
   solved exactly this. **Verified first-hand.**
2. **The failure direction is stated backwards.** With `ctx.user === undefined` the flag is
   base-`false` with a `moderators` segment, so a global eval matches nothing and resolves `false` →
   `UNAUTHORIZED`. That is fail-**closed** — the surface would be **dead**, a wiring bug. "Degrades a
   gate" reads as a security loosening, which is what made rejecting the caller feel mandatory.
3. **The repo already decided this for the sibling procedures.** `pollWorkflow:3857`,
   `cancelWorkflow:4178`, `estimateWorkflow:5241`, `submitWorkflow:5568` are each `publicProcedure`
   carrying the comment *"Block-JWT-authed (no session for dev:live) — flag evaluated against the
   TOKEN subject below, not the `enforceAppBlocksFlag` middleware's ctx.user."* Yet all five
   `appsStorageRouter` procedures still `.use(enforceAppBlocksFlag)`
   (`apps.router.ts:71,83,88,99,131`), redundantly with `assertAppBlocksEnabledForTokenUser`.
   **Verified first-hand.**

⚠ **My own verification of limb 3 was WRONG on the first pass and the error is worth keeping.** I
grepped for `enforceAppBlocksFlag` within 12 lines of each proc, got a hit on all four, and was about
to report the auditor refuted. The hit was the symbol appearing **inside the comment that explains
its absence**. Reading the lines verbatim showed `publicProcedure` with no `.use(...)`.
**Grepping for a symbol finds the prose that says the symbol is not used.** Read the construct, not
the token.

**The one-line fix that dissolves the whole question:** drop `.use(enforceAppBlocksFlag)` from the
five storage procedures, matching the four workflow procedures. Then extraction-vs-caller is an
ordinary taste call on the #5054/#5055 grounds — which are sound on their own. ⚠ That deletion is a
live behaviour change on the bridge path: operator's call.

## 🔴 The `13 → 12` bearer-consolidation claim does not reproduce
Measured on both trees with one command shape, in both units:
**files 19 → 19; occurrences 20 → 20.** Net zero. The PR's own docblock enumerates
*"thirteen call sites (`blockWorkflowBearer` plus a private `bearer()` in each of the eleven
shared-storage routes)"* — which sums to **12**, contradicting its own total. Eleven open-coded
copies remain by design and a pass-through wrapper was added, so "One rule, one place" is invoked
for a net movement of one copy. Either finish the consolidation or drop the justification.

## Deletion candidates (4)
- 🔴 `enforceAppBlocksFlag` on the five storage procedures — wrong identity, redundant with
  `assertAppBlocksEnabledForTokenUser`. Dissolves R6.
- 🔴 `blockWorkflowBearer` — a pure pass-through whose own docblock says *"it adds no behaviour of
  its own"*; four call sites can import `blockBearerToken` directly.
- `enforceAppBlocksFlag`'s `type === 'query'` branch — both arms throw the byte-identical error.
- The second activity row per REST write **and the new access row per REST read** (unattributed).
  Reads are the sharper half: `get`/`list`/`quota` are polled, and each now writes into the viewer's
  Activity feed where the bridge wrote none.

## Requirements that SURVIVED scrutiny
- **The PR should exist** — five apps genuinely blocked, none of it server-derivable. Not a
  145 KB-listener case.
- **`quota.ts`** — suspected deletable, checked, **real consumer**:
  `model-benchmarking/src/drafts.test.tsx:20,397,406,444` makes "the quota line comes from
  `getQuota()`, never a hard-coded 50 MB" an explicit test criterion.
- **Anon → 403** — kept, but the *"an audit installed it"* framing does not survive: until this PR
  the guard had **zero callers**, so it carries no measured incident. Keep it, stop treating it as
  immovable; bridge-parity nulls for the three reads override no evidence.

## ⚠ The sharpest strategic note
*"Five fleet apps are blocked on this"* is true. *"Merging this unblocks them"* is **not** —
`@civitai/sdk` still has **no storage client at all**, so these five routes unblock nobody until the
SDK grows one or five apps hand-roll adapters.

---

# ROUND 0 on PR #11 — verdict: `requirement questioned — R4`

Ledger: `round 0 · requirements: 9 (unattributed: 7) · deletion candidates: 5`. **7 of 9
requirements unattributed** is the headline number: this port made most of its own rules.

## The questioned requirement — R4, and it is not the one it looks like
Not *"remove the `persist` no-op"* — removing it only restores the hang its docblock correctly
rejects. The requirement to drop is: **"the port may silently degrade a viewer-visible behaviour,
provided it is written down in the README."** A README is not a UI. The viewer swaps a checkpoint,
sees the label change, and gets no signal that the choice dies on remount.

Its author of record is **the PR, not the operator**. The nearest operator precedent covers a
strictly weaker case — the analytics no-op, i.e. telemetry nobody sees — not a viewer-visible
persistence feature. The handoff line recording this as *"already shipped degraded in PR #11"* is a
**status line written after the fact, not an authorisation**, and the merge decision is still open.
Either hold it behind a platform surface, or make the degradation visible **at the seam it
degrades** — the call site knows `persist` is a no-op and shows nothing.

## 🟡 The concrete half: `App.tsx:1143-1150` is unreachable
`useCheckpointPicker().persist` (`platform/hooks.ts:429-437`) is an `async` arrow whose only body is
a DEV `console.debug`. It **cannot reject**. So the `catch` — rollback plus
`setCheckpointError('could not save checkpoint')` — is dead in production, and no test exercises it
(`checkpointPersist` appears at 4 sites, all in `test/test-utils.ts`, always
`mockResolvedValue(undefined)`). It reads as *"persistence failure is handled"* while persistence
does not happen at all: **a guard that stops anyone looking.**

## Requirements that survived, and one that earns its keep
`src/platform-seam.test.ts` was examined for deletion and **KEPT**, measured not assumed: it matches
vitest's include and CI runs it; extracted into a `.git`-less copy of base `b110a214` it goes
**4/4 RED**, and **4/4 GREEN** at `bba558b`; nothing else checks the property; both zero-valued
assertions carry positive controls; and `importsPackage()` matches the module specifier rather than a
substring, so the file's own prose naming the forbidden package does not self-trip.

🔴 **Forward-looking caveat before that guard is rolled to the fleet:** `gen-matrix` and
`model-benchmarking` **cannot reach 0 blocks-react importers** even after the app-storage PR lands
(three and one missing platform surfaces respectively). Copying this file to those repos installs a
**permanently-red gate** — which `RULES.md` says is worse than no gate.

## 🟡 `src/dev/harnessServer.ts` — the leak it prevents is real; 110 of its 140 lines are a feature
The leak is verified: `@civitai/sdk@0.2.0`'s `dist/site/index.js:1` sets
`DEFAULT_SITE_URL = 'https://civitai.com/api/v1'` and nothing else redirects it, so after the port
`dev:harness` would fire money-shaped POSTs at production from localhost. **But preventing that costs
~1 line** — `__configurePlatform({ siteUrl: 'http://localhost:5173/api/v1' })`, the same override the
tests already use. The other ~110 lines implement *demonstrate a full generation locally* (R7), which
nobody asked for and which **nobody has yet run** — the PR body says so plainly. Not a recommended
cut; recorded so the operator knows 140 lines of payload rest on an unattributed requirement.

## Other deletion candidates
- 🟢 `@civitai/app-sdk` should move to `devDependencies` — all 7 files that name it use `import type`
  only, so it contributes zero runtime bytes while being declared a runtime dependency.
- 🟢 `__tests__/harness-server.test.ts` (108 lines) falls with `harnessServer.ts`; independently
  justified while it stands, since it pins the join neither half tests alone.

## Corrections to the PR's own numbers — neither changes a decision
The red-matrix claims **26** bridge importers at base; two independent methods count **25**. And
*"4/4 RED"* is true, but one of the four reds is the file's own positive control failing because
`platform/workflows.ts` does not exist yet — so the matrix names three causes for four reds.

## On holding the PR for the `/workflows/*` deploy — round 0 says NO
Re-probed 2026-09-24T04:18Z: all four → **404 `text/html`**; controls `/blocks/buzz` and
`/blocks/shared-storage/list` → **405 `application/json`**. Holding the branch does not deploy the
routes — it only lets it rot behind `main` while five sibling ports queue behind the same platform
work. Merge with the "not verified" statement intact (it is in the PR body, the README and
`workflows.ts:19-24`) and keep the re-probe as the closing condition. **Operator's call.**

---

# 🔴 RULES-CLASS FINDING: a CACHED verdict replays a PASS computed before the condition changed

Surfaced while removing the now-inert `minimumReleaseAge` exemption from `civitai-app-requests`
(PR #22). The deletion is trivial; **the instrument nearly lied three different ways**, and every one
of them produces a confident green.

**1. `direnv exec <dir> <cmd>` does not cd — and pnpm SELF-SWITCHES on the cwd's pin.**
`direnv exec $W pnpm --version` reported **10.28.1**, not the flake's 11.25.0, because pnpm read the
*cwd's* `package.json` (the starters repo, pinning `"packageManager": "pnpm@10.28.1"`) and switched
itself. 🔴 **On pnpm 10 the `minimumReleaseAge` policy does not exist at all**, so the whole check
passes for the wrong reason. `pnpm -C $W` gives 11.25.0. This is the second independent hit on the
`direnv exec` trap today.

**2. With `node_modules` present, pnpm prints `Already up to date` and never runs the policy.**
The first install "passed" having verified nothing.

**3. 🔴 `~/.cache/pnpm/lockfile-verified.jsonl` replays a STORED verdict** as
`✓ … (verified 2h ago)`. The cached entry here was written at **02:00Z — before the 24h window
closed at 03:49:30Z**. A replayed pass is a fact about a computation run under *different
conditions*.

**The tell, and it is in the CONTENT not the exit code:** a real run prints
`(185 entries in 637ms)`; a replay prints `(verified Xh ago)`. Same rc 0. **Read the line, never the
status.**

**How it was done correctly** — four readings, one of them cache-free:

| # | config | result |
|---|---|---|
| 1 | exclude deleted | `✓ passes (185 entries in 637ms)` rc 0 |
| 2 | **negative control** — deleted + `minimumReleaseAge: 100000` | `✗ failed`, rc 1, 8 violations, naming `@civitai/sdk@0.2.0 … published at 2026-09-23T03:49:30.004Z` |
| 3 | restored final state, **re-read from disk** | `✓ passes (185 entries in 767ms)` |
| 4 | **CI's cold runner** — no local cache at all | `✓ passes (185 entries in 1.9s)` |

The negative control fired and named the exact package, so 1/3/4 are real verdicts rather than a
policy that is simply switched off. And pnpm's own violation message in (2) printed the identical
publish timestamp `npm view` gave — the window arithmetic confirmed twice, independently.

⚠ The agent backed up the cache before clearing and confirmed **0 of 19 other repos' entries** were
lost. Clearing a shared cache is a write to something other sessions use.

**Generalise past pnpm:** any tool that memoises a verdict — a lockfile checker, a scanner, a test
runner with a result cache — can replay a PASS from before the thing you changed. Ask what the tool
CACHES before believing its green, and prefer an output line that proves work was done over an exit
code that proves only that nothing crashed.

⚠ **Also recorded: `git grep -c <symbol>` counts lines CONTAINING the symbol, including the comment
that explains the symbol's removal.** It reported `1` on both the fix branch and `main` here, reading
as "the deletion did not land". The discriminating query is the ACTIVE construct —
`grep -cE "^minimumReleaseAgeExclude:"` → branch **0**, main **1**. Second hit on this shape today
(the first was `enforceAppBlocksFlag` appearing inside the comment explaining its absence).
**Grep for the construct, not the token.**
