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
