# Handoff: civitai-app-platform-migration — 2026-09-23

## Run this first — the index, one command
```bash
cairn recall --repo /home/zach/workspace/civit/civitai-app-starters
```
Terse pointers this doc does not carry, curated by past sessions and outliving it.
🔴 RECALL, NOT LIVE OBSERVATION — every line is a pointer to VERIFY, never a current
reading, and it may describe a gotcha already fixed. `scope-absent`/`scope-empty` means
nothing is recorded yet: ordinary, not an error, and not a clean bill of health.
Non-blocking: if it exits non-zero, print the stderr line and carry on.

⚠ **Sibling doc, different arc:** `claudedocs/handoff-app-starters-launch-audit.md` covers the
pre-launch audit of the starters repo. This doc is the migration that followed Koen's 2026-09-22
handoff and does not supersede it.

🔴 **Correction to that doc's leading hypothesis, measured 2026-09-23.** It predicted
`feat/blocks-client` (which became `feat/civitai-sdk`, merged as #415 `266a021`) would close
**#328** — *"`@civitai/components` becomes Lit elements, `components-react` becomes `@lit/react`
bindings of the same elements, so the 34 names stop being two implementations."* **#415 merged and
#328 is still OPEN.** The elements landed, but `blocks-react/ui` was untouched, so the 34
colliding names still ship from both packages. The launch-audit closing condition still returns
**1**, with 34 open issues total as the positive control. That arc is not closed and its rank-1
item now needs a different plan.

## Goal
Move Civitai apps off the iframe `postMessage` bridge onto the public `/api/v1` API plus the
orchestrator, then port the seven fleet apps. Direction confirmed by the operator 2026-09-23:
*"default api, and only things that must be via messaging (ex. opening resource picker) uses
that protocol."*

- **closing-condition:** `check` — at least one fleet app runs on `@civitai/sdk` with **no**
  remaining `@civitai/blocks-react` import, verified by
  `find <app> -name '*.ts*' -print0 | xargs -0 grep -l "@civitai/blocks-react" | wc -l` → **0**,
  with a positive control (the same grep on an unported app returning non-zero) so the zero is
  a real reading. **No app has met this yet.**

## State now

**#5067 is MERGED. The security finding is ROUTED — `civitai/civitai-orchestration#363`, assigned.
#5068 is green, its premise is corrected, and Round 1 is done: 6 findings, 1 of them 🔴, verdict
"merge after fixing 🔴". Still nothing ported; the closing condition still returns non-zero.**

- Repos: `civitai-app-starters` @ `59458d9` (branch `docs/handoff-app-platform-migration`) ·
  `civitai` @ `f5499803b0` (main, clean).
- **No `clawgate-task:` field**, deliberately. `clawgate_handoff.sh resolve` exited **5**; its own
  positive control fired, but a wrong session id also answers 200 with an empty array.

### Done this session

| what | where |
|---|---|
| **#5067 merged** | `3a1e090924` — binds the ROUTE's `requiredScope` only. `#5063` auto-closed. |
| **Security finding ROUTED** | `civitai/civitai-orchestration#363` (PRIVATE repo), label `bug`, **assigned `koenbeuk`** — author of all 5 recent commits to `WorkflowsController.cs`. Carries a closing condition. |
| **#5068 rebased** | `298db52c89`, onto main incl. `2fd658d775` + `3a1e090924`. 7/7 statuses, 13/13 check-runs. |
| **#5068 premise corrected** | PR body now opens with a dated retraction blockquote linking `#issuecomment-5800758557`; the 4 false clauses are gone. Head sha unchanged, CI untouched. |
| **#5068 comment posted** | `#issuecomment-5800758557` — consolidation framing only, leak-scanned before posting. |
| **Round 1 audit** | 6 findings (1🔴 / 5🟡). Full text in the session transcript. |

### Merged in EARLIER sessions of this arc (carried forward — do not re-derive)

| repo | commit | what |
|---|---|---|
| starters | `827eccc` | #421 publish-assert budget → 590s window |
| starters | `266a021` | #415 `@civitai/sdk` + 41 custom elements (Koen's) |
| starters | `d675b63` | #434 Version Packages |
| starters | `6daa51e` | #438 BREAKING.md records the new routes + auth rules |
| starters | `8b3fce3` | #439 corrects the anon-read claim #438 shipped wrong |
| civitai | `ca57ac0fb` | #5051 restored `GET /api/v1/blocks/buzz` |
| civitai | `600bcdc40` | #5052 REST-ward direction recorded, `blocks/me` un-deprecated |
| civitai | `0c945284d` | #5053 batch image `?ids=` (cap 100) |
| civitai | `e2a07767c` | #5054 shared-storage READ routes |
| civitai | `0cd25bb22` | #5055 shared-storage WRITE routes |
| civitai | `2fd658d77` | #5070 fixed a live `main` breakage (`ctx.domain` in a sessionless fn) |

**Published:** app-sdk 0.50.0 · blocks-react 0.57.1 · components + components-react 0.5.0 ·
theme 0.4.0 · **`@civitai/sdk` 0.2.0**.

## Open investigations — live diagnosis state

### No generation app can port — no REST spend surface for a block token
- as-of: 2026-09-23
- **Symptom + exact repro:** adopting `@civitai/sdk` removes the transport an app's generation
  runs on. `HostRequests` is four entries — `SAVE_IMAGE`, `OPEN_RESOURCE_PICKER`,
  `OPEN_BUZZ_PURCHASE`, `REQUEST_TOKEN` (`packages/civitai-sdk/src/host/protocol.ts:29-40`) —
  no `SUBMIT_WORKFLOW`/`ESTIMATE_WORKFLOW`/`POLL_WORKFLOW`/`CANCEL_WORKFLOW`.
- **Observed (with values):** the replacement `app.orchestration` POSTs to
  `https://orchestration.civitai.com/v2/consumer/workflows` with `Authorization: Bearer <block
  JWT>` (`src/orchestration/index.ts:26,28,122,125`; `src/http/index.ts:41`). The orchestrator
  authenticates with a **server-minted temporary user API key**
  (`getTemporaryUserApiKey(..., type:'System')`, `civitai/src/server/orchestrator/get-orchestrator-token.ts:106-112`)
  that never leaves the server. `KNOWN_STATIC_ENDPOINT_SEGMENTS` has no workflow segment, and of
  22 `requiredScope` sites repo-wide **zero** are `ai:write:budgeted`. `via: code`
- **Ruled out:** *"the orchestrator just needs a `withBlockScope` wrapper"* — FALSE, and this was
  my own framing. `withBlockScope` is Next.js middleware on civitai.com's routes; the orchestrator
  is a separate service that has never been taught the block JWT's key material or audience.
  Wrapping it would change nothing. `via: code`
- **Leading hypothesis:** a host-side REST proxy is the smallest fix — it touches neither the
  `appblk-*` OAuth bar nor the orchestrator. **Built as #5068.**
- **Next probe:** sync #5068 onto `main` (now that `2fd658d77` landed), re-run CI, then
  `/audit-pr 5068` Round 0 with the brief already at `<scratchpad>/brief-5068-r0.md`.

### `app-requests` cannot port either — anon reads 403, and the UI surface is missing
- as-of: 2026-09-23
- **Symptom + exact repro:** the app's premise is signed-out browsing (*"Anyone can read the board
  signed out"*), and every REST call 403s for an anonymous viewer.
- **Observed (with values):** its manifest declares `apps:storage:shared:read`,
  `apps:storage:shared:write`, `user:read:self`. `apps:storage:shared:write` is in
  `CONSENT_EXEMPT_SCOPES` (`scope-grant.service.ts`), so the anon mint does **not** strip it; the
  binding loop reaches its case at `block-scope.middleware.ts:821-831` and throws
  `requires authenticated subject` — **on a read route**. The `shared:read` case eleven lines
  above says *"SHARED (app-global) READS are allowed for anon"*. Both verified first-hand.
  `via: code`
- **Ruled out:** *"this is a pre-existing bug"* — FALSE, it is a **behaviour change on port**. The
  bridge gates anon **per operation** (`apps-shared.router.ts:246-251`, `if (!READ_OPS.has(op))`),
  so an anon read passes today. `via: code`
- **Also blocking, independent of the above:** the app imports **13 UI components** from
  `@civitai/blocks-react/ui` plus `Harness`/`MockSharedSeed` from `/testing`. `@civitai/sdk` has
  no `/ui`. **RESOLVED as a path:** the operator confirmed Koen ported the UI to web components —
  `@civitai/components-react` covers 8 of the 10 this app uses, and `Modal`/`SegmentedControl` are
  reachable via its `./elements/*` subpath. The e2e `Harness` replacement is still unsolved.
  `via: measurement`
- **Leading hypothesis:** #5067 fixes the 403. Then the port is a UI rebind onto the web
  components plus a new e2e harness.
- **Next probe:** after #5067 merges, re-check with an anon token against
  `/api/v1/blocks/shared-storage/list`, or a unit test feeding `enforceContextBinding` an anon
  token carrying both shared scopes.

### `@civitai/sdk` cannot be used by a block at all until the host sends a usable token
- as-of: 2026-09-23
- **Symptom + exact repro:** the host mints a **block JWT**, not an OAuth access token. The
  migration doc's item 1 asks civitai to mint `appblk-<slug>` OAuth tokens.
- **Observed (with values):** that bar is **deliberate security**. `apps/auth/src/lib/server/oauth/block-guard.ts:8-12`:
  app-block clients *"must NEVER drive the interactive authorization_code / device flows … an
  app-block owner could otherwise phish a user through the consent screen → account takeover."*
  Four gates; the load-bearing one is `grants: []` written into the client row at approve time
  (`publish-request.service.ts:2388-2409`), with a retry path that converges hand-edits back.
  `via: code`
- **Ruled out:** *"use client-credentials"* — FALSE. `getUserFromClient` returns the **app
  developer**, so it would spend the developer's Buzz, which is the tenant model `AGENTS.md`
  warns against. No on-behalf-of/RFC 8693 flow exists (verified with a positive control).
  `via: code`
- **Leading hypothesis:** no OAuth change needed. The block JWT is **not** limited to
  `/api/v1/blocks/*` by any route or claim check — `withBlockScope` has no path assertion, and
  `GET /api/v1/models/{id}:299` is dual-auth today. Widening what the block token is accepted on
  reaches the same destination.
- **Next probe:** the question that decides between the two paths is **whether a block must act
  without an open host page.** The block JWT lives ~15 min and is refreshed by the host page's
  session; the block holds no refresh credential. If background work is required, OAuth becomes
  necessary rather than optional. That is a product question, not an engineering one.

<!-- SUPERSEDES the earlier block "`app-requests` cannot port either — anon reads 403, and the UI
     surface is missing". Its "Next probe" (re-check after #5067 merges) is DONE — #5067 is on
     origin/main as 3a1e090924. Do NOT re-run that instruction; the live probe below replaces it.
     The UI-rebind half of that block is untouched and still stands. -->
### RESOLVED (code): `app-requests` anon-read 403 — #5067 merged, but the fix is NOT yet probed live
- as-of: 2026-09-23
- **Symptom + exact repro:** unchanged from the block above — anon `shared:read` 403'd because the
  binding loop walked every scope on the token.
- **Observed (with values):** `3a1e090924` is on `origin/main`;
  `src/server/middleware/__tests__/block-scope.required-scope-binding.test.ts` is PRESENT on
  `origin/main`, and `git diff --stat origin/main b6c2af5de8 -- src/server/middleware/block-scope.middleware.ts`
  is **empty**, i.e. main's middleware is byte-identical to the tree the tests ran on. The unit case
  *"an ANON token carrying shared:read AND shared:write can READ shared storage"* passes at HEAD and
  **fails 403 at `0cd25bb226e5`**. `via: measurement`
- **Ruled out:** *"merging #5067 might regress something main gained since its branch point"* —
  FALSE. Zero file overlap between the PR's 8 files and main's 42; zero new
  `requiredScope|withBlockScope|enforceContextBinding|allowOpaqueOrigin` sites added on main
  (positive control: the same grep over `ca57ac0fb~1..0cd25bb226e5` returns **137**). `via: command`
- **Leading hypothesis:** the 403 is fixed. What remains unproven is the LIVE path — no request with
  a real anon block token has been fired at a running server.
- **Next probe:** on a preview deploy of a branch containing `3a1e090924`, mint an anon block token
  carrying both shared scopes and `GET /api/v1/blocks/shared-storage/list`; expect **200**, with the
  same call against a pre-`3a1e090924` deploy returning **403** as the positive control.

### `@civitai/sdk` blocks propagate a second copy of the hardcoded `TokenScope.Full`
- as-of: 2026-09-23
- **Symptom + exact repro:** #5068's `blockWorkflowCaller` ends with `tokenScope: TokenScope.Full`,
  commented *"matching publicApiContext2"* — i.e. the constant is now open-coded in a second place.
  🔴 **There is a separate, non-public reason this consolidation matters and it is NOT recorded in
  this repo by design — see ranked item 1 and ask the operator.**
- **Observed (with values):** `src/server/services/blocks/block-workflow-rest.ts`, the
  `blockWorkflowCaller` return literal. The four procedures it reaches
  (`blocks.router.ts:3857,4178,5241,5568`) carry **no** `.meta({ requiredScope })`, and
  `src/server/trpc.ts:260` states procedures without it *"implicitly require `TokenScope.Full`"* —
  so the constant satisfies a requirement that is already Full. Block-JWT scope is enforced upstream
  by `withBlockScope` (`ai:write:budgeted`) and again by the procedure's own
  `authorizeBlockBridgeToken`. `via: code`
- **Ruled out:** *"this is a live scope bypass introduced by #5068"* — NOT established. For a block
  JWT there is no OAuth scope for `runEnforceTokenScope` to read, and the real gates are elsewhere
  and do fire. Do not report it as exploitable. `via: code`
- **Leading hypothesis:** it is a **one-rule-two-places** hazard, not a live hole. If the central
  construction of that context is ever changed to derive the value rather than hardcode it, **this
  site will not be reached by that change** and will silently keep the constant.
- **Next probe:** enumerate every site of the literal before the central fix is designed —
  `find src -name '*.ts' -print0 | xargs -0 grep -n "tokenScope: TokenScope.Full"` (NOT bare
  `grep -r`, which is `.gitignore`-blind here) — and sweep them as one change.

### Round 0 found the PR's own premise false in four clauses
- as-of: 2026-09-23
- **Symptom + exact repro:** #5068's commit message is the durable record of why the surface exists,
  and four load-bearing clauses do not survive checking.
- **Observed (with values):** (1) *"no generation app can port off the postMessage bridge today"* —
  true only for block-JWT-authed iframes; an app doing its own OAuth sign-in can already generate
  (`civitai-sdk/src/sign-in/`, `app-sdk/src/orchestrator/index.ts:392-399`). (2) *"a server-minted
  temporary user API key **that never leaves this host**"* — FALSE:
  `src/pages/api/training-studio/host.ts:52-75` returns exactly such a token to a browser, by design.
  (3) the orchestrator takes `apiKey` **or** `oauth` subjects (`src/server/http/orchestrator/api-key-spend.ts:12-16`).
  (4) the four bridge procedures are already HTTP-reachable at `/api/trpc/*` taking `blockToken` in
  the body — the real blocker is **CORS**, not existence. `via: code`
- **Ruled out:** *"the unsettled generation-vs-REST question means close this PR"* — FALSE, and this
  was the conclusion the dispatch pointed at. Both limbs of the counter-argument are mooted by THIS
  design: `poll`/`cancel` are POST-with-id-in-body (`poll.ts:83`, `:95-107`) so no JWT and no id
  reach a URL, and delegating to the procedure is the only shape that KEEPS policy enforcement
  platform-side. The open question is about **direct-to-orchestrator** generation, which #5068 is
  not. `via: code`
- **Leading hypothesis:** the honest premise is *stronger* than the stated one — direct-to-orchestrator
  generation loses the per-call `buzzBudget`, the per-viewer daily cap, the per-app cap and the
  `app-block:<appId>` attribution tag (starters #430; `BREAKING.md:196-200`).
- **Next probe:** rewrite the commit message / PR body to that argument, and record on
  `handoff:245-248` that the unsettled question is about direct-to-orchestrator generation and NOT
  about a host-side proxy — otherwise the next reader re-litigates it.

### 🔴 F1 — every poll/estimate/cancel will render as "Submit AI workflow" in the viewer's activity feed
- as-of: 2026-09-23
- **Symptom + exact repro:** one generation through a REST block renders in `/apps/activity` as
  "Generated an image" (the money row) **plus** "Submit AI workflow" (the `withBlockScope` access
  row), then one further "Submit AI workflow" per poll. At the SDK's ~0.5 Hz short-poll cadence a
  60-second generation yields ~30 rows each asserting the app submitted a workflow.
- **Observed (with values):** VERIFIED FIRST-HAND, not taken from the auditor.
  `AppActivityPanel.tsx:92` is `'ai:write:budgeted': 'Submit AI workflow'` inside
  `SCOPE_ACTION_LABELS`. `humaniseScopeInvocation` (`:96-121`) tries four `endpoint` arms
  (`workflow:submit`, `user-settings:write`, `storage:set`, `storage:delete`), then
  `READ_SCOPE_LABELS`, then **falls through to `SCOPE_ACTION_LABELS`**. The endpoint on these rows
  is `normalizeEndpoint(req.url)` (`block-scope.middleware.ts:1304`) = `/api/v1/blocks/workflows/poll`,
  which matches no arm. Render path `AppActivityPanel.tsx:529`: `item.detail` null →
  `humaniseScopeInvocation(item.scope, item.endpoint)`. `via: code`
- **Ruled out:** *"the detail-less row falls back to a technical `scope · endpoint · status` line"* —
  FALSE, and this is the PR's own docblock at `submit.ts:69-75`. Its stated reason is
  *"`ai:write:budgeted` is not in `READ_SCOPE_LABELS`"*, which is true and **irrelevant**: the
  function falls through that map into the next one. The reasoning is exactly one map short.
  A COMMENT IS A CLAIM — this one is load-bearing for a design decision. `via: code`
- **Leading hypothesis:** the no-stash decision is still right; the label resolution is what is wrong.
- **Next probe:** 🔴 **FORK, needs an operator call before the fix lands** — the two fix sites have
  different blast radii. (a) add an `endpoint?.startsWith('/api/v1/blocks/workflows/')` arm to
  `humaniseScopeInvocation`: one line, but edits a SHARED component outside #5068's diff and changes
  what every other caller renders; (b) stash a read-shaped detail on the three non-spend routes:
  confined to the PR, but spends a `withBlockScope` option and leaves the shared function still
  wrong for any future `ai:write:budgeted` route. Recommend (a) plus a pinning test.

### 🟡 F2/F6 — the long-poll hold path and its per-poll DB write, both unbounded
- as-of: 2026-09-23
- **Symptom + exact repro:** #5068 makes `waitSeconds` reachable from the wire for the first time,
  and converts a zero-write path into one primary-DB INSERT per poll.
- **Observed (with values):** `block-catalog-rate-limit.ts:207-212` states as MEASURED that "neither
  host passes `waitSeconds` … the server sees no hold"; the auditor re-verified that measurement
  (no `waitSeconds` under `src/components/`) and #5068 falsifies it — `poll.ts:74,106` takes it off
  the wire, and `@civitai/blocks-react`'s `watch` defaults it to 15. The same comment names the
  required control at `:236-241`: *"~300 simultaneously-held request slots per (install, viewer) by
  Little's law … the control for it is a concurrency cap, not a smaller rate."* No cap is added and
  the comment is not updated. Separately `block-scope.middleware.ts:1300-1320` fires
  `dbWrite.blockScopeInvocation.create` on every non-anon request — the bridge's `pollWorkflow`
  writes none (`block-catalog-rate-limit.ts:245-248`) — ceilinged only by
  `BLOCK_POLL_RATE_LIMIT_MAX = 1200`/60s per (install, viewer). The whole block REST surface was
  ~1,037 requests over 15 days across 4 apps; one viewer at 0.5 Hz matches that in ~35 minutes.
  `via: code`
- **Ruled out:** *"the hold path is pre-existing, so #5068 does not change it"* — FALSE. The hold was
  unreachable before: enumerating `src/components/` for `waitSeconds` returns NO hit, which is what
  made `block-catalog-rate-limit.ts:207-212`'s "the server sees no hold" true. #5068 is what makes
  it reachable, so this is a NEW exposure rather than an inherited one.
  `via: command`
- **Leading hypothesis:** both are capacity, not correctness, and neither blocks the merge **if the
  decision is written down**. They become real when a block actually adopts the surface.
- **Next probe:** 🔴 **UNVERIFIED and not resolvable from this host** — the pod/ingress read timeout
  was never read, so where the holds actually break is unknown. Read the ingress/pod timeout, then
  decide (i) a concurrency cap on the held path and (ii) whether poll should write an audit row at
  all. Both are operator decisions.

### 🟡 F3/F4/F5 — three smaller gaps from Round 1, independent of each other
- as-of: 2026-09-23
- **Symptom + exact repro:** F3 the tRPC context literal is cast out of type-checking; F4 an
  unenumerated third divergence; F5 a docblock claims retry-safety the code only conditionally gives.
- **Observed (with values):** F3 — `block-workflow-rest.ts:88,96` uses
  `as unknown as (ctx: unknown) => unknown`, so the 20-field literal at `:116-137` is checked against
  nothing, unlike `public-api-context.ts:17`. The auditor's paired control (`tsc --noEmit --strict`
  on a 20-line probe) errored `TS2345 … Property 'c' is missing` on the checked shape only; no test
  pins the two literals equal. F4 — `features: getFeatureFlagsLazy({ req })` with no user makes
  every caller evaluate Flipt as entity `'anonymous'`; `ctx.features.wildcards` IS read, at
  `blocks.router.ts:5428,5786,8449`, feeding `wildcardsEnabled` into `resolveCanGenerateForVersions`.
  F5 — `idempotencyKey` is `.optional()` (`submit.ts:91`) while the docblock lists the idempotency
  claim among controls that "run verbatim"; `blocks.router.ts:5578-5588` says a server-minted key
  does NOT dedupe a client retry. `via: code`
- **Ruled out:** F4 *"the divergence reaches no control"* — that is the PR's own claim and it is
  FALSE for `ctx.features`; the docblock enumerates only two divergences. `via: code`
- **Leading hypothesis:** F3 is drift risk not present divergence (the literal matches today, field
  for field). F4's live impact depends on the `wildcards` Flipt rule, UNREAD. F5 is a real
  double-charge path for any HTTP client that retries on timeout, which is most of them.
- **Next probe:** read the live `wildcards` Flipt rule to settle whether F4 changes behaviour today;
  for F5 decide between making the key required on this route or documenting the retry contract.

## Next steps (ranked)

1. **Fix Round 1's 🔴 F1, then run the Round 2 delta audit.** Needs the fork call in the F1 block
   above first. `IN FLIGHT: civitai/civitai#5068`. A fix round frequently introduces the next
   finding — re-audit the delta against `298db52c89`, not the whole PR.
   forcing: gate — #5068 is the only thing unblocking generation apps, and it should not reach a
   viewer with a false activity-feed record.
2. **Decide F2 and F6** — a concurrency cap on the held poll path, and whether poll writes an audit
   row at all. Read the ingress/pod read timeout first; it was never measured.
   forcing: user — capacity decisions, not engineering ones.
3. **Ask GitHub Support to purge `9c97491136c4eb0b6bd7c73f3d6abc3f856ab6da`** in
   `civitai/civitai-app-starters` — force-pushed off the branch but still reachable by sha.
   Only the operator can file it.
   forcing: security — residual exposure on a public repo from this session's own leak.
4. **Ratify or reject R14** — #5068 reaches tRPC via a `blocksRouter` caller, diverging from the
   body-extraction precedent #5054/#5055 set eight days earlier. Unattributed.
   forcing: user — needs an operator call.
5. **Answer whether `app-blocks-runtime-enabled` is lit in production.** Fail-safe off means all
   four #5068 routes 401.
   forcing: gate — blocks any claim that #5068 is verified in production.
6. **Batch: filed but not advanced.** civitai#5059, civitai#5060, civitai#5064 (close when #5068
   merges), starters #425–#432, #422, #423.
   forcing: none

## Defects (batched)

- **The HF-import path can still write an unstamped `'Training Data'` row** (both callers pass
  `uploadDomain: null`). Moderator/webhook-gated, so not the laundering vector #5058 targeted.
- **`me.ts` declares a `requiredScope` but no `allowOpaqueOrigin`**, so an unverified block's direct
  fetch of the viewer self-read 405s on preflight. Recorded as a pin in the CORS test.
- **The new shared-storage routes return `{ message }`; the two older siblings return `{ error }`.**
  Deliberate, but a client written against `top`/`increment` sees a different key.
- `pnpm lint` exits 1 repo-wide in starters (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`). Pre-existing.
- `civitai-block-generate-from-model` **has no linter at all**; its 11 `eslint-disable-next-line`
  comments disable something that is not installed.
- **`sharp` is unbuildable in every civitai worktree on this host** — 4 files / 6 tests fail with
  `Cannot find module '../build/Release/sharp-linux-x64.node'`, identical at `main` alone. Environmental,
  NOT a code defect, and it will read as one to the next session that runs the block suite locally.
- **11 open-coded copies of `'block lacks ai:write:budgeted scope'`** in `blocks.router.ts` — a
  one-rule-one-place consolidation candidate found by Round 0 in code #5068 touches.

## Gotchas / decisions / dead-ends

- 🔴 **A `Version Packages` PR can be a RACE ARTIFACT OF ITS OWN PREDECESSOR'S MERGE.** #420's head
  was committed **18s after #408 merged**, on the same branch, and looked identical to a pending
  release (`CLEAN`, `MERGEABLE`, full changeset list). The discriminator is CONTENT:
  `git merge-tree --write-tree origin/main refs/remotes/pr/<n>` then
  `git diff --stat origin/main <tree>` — **empty** ⇒ merging is a no-op, with
  `git diff --stat origin/main~1 <tree>` as the positive control (non-empty).
- 🔴 **npm OIDC trusted publishing CANNOT create a package that does not exist** — the first
  publish of any new `packages/*` is manual, and npm answers with **404, not 403**, so it reads
  like a missing dependency. `@civitai/sdk@0.2.0` had to be published by hand.
- 🔴 **`npm access list packages <user>` is the discriminator** between *never created*,
  *created-and-propagating* and *errored* when a publish returns `PUT 200` but the packument 404s.
  It reads the permission backend, not the public replica — it showed `@civitai/sdk: read-write`
  four minutes before the packument appeared. New-package propagation measured **~311s**.
- 🔴 **`assert-published-versions.mjs` reported OK over a FAILED publish** — its `NEW` carve-out
  treats *"npm has never heard of this name"* as *a package being introduced*, which is the same
  observable a failed first publish produces. Filed as starters #435.
- 🔴 **Four separate tools reported success over failure this session:** `gh pr merge`'s local
  branch delete, the local vitest wrapper (`[exited with code 0]` over `ELIFECYCLE ... exit 1`),
  `npx tsc --noEmit` (exit **134** on a heap OOM while printing *"0 errors"* — use the repo's own
  `pnpm run typecheck`, which caps heap), and `pnpm run db:generate` (exit 0 on a Prisma engine
  404 on NixOS — re-run under `direnv exec`). **Count the runner's own result lines; never the
  exit code alone.**
- 🔴 **A `vitest` path filter silently runs a subset.** Nine guessed paths ran only five, rc 0.
  Resolve every path with `find` before trusting a green.
- 🔴 **GitHub code search returned nine uniform zeros that were a 403 rate limit.** Caught only by
  a positive control. Fleet measurements must come from local clones.
- 🔴 **A hook-usage count can be the TEST MOCK, not production.** `useBlockAnalytics` read as "1
  file" for `generate-from-model`; `App.tsx` never calls it. Check call sites, not imports.
- 🔴 **The CORS wiring guard was INERT** — a hand-maintained `ENDPOINTS` list every assertion
  iterated, so an unlisted route was invisible rather than unguarded. Deleting an entry left the
  suite green. Now derived set-equality; it immediately found two pre-existing gaps.
- 🔴 **`tekton / typecheck` green on other PRs is evidence about THEIR BRANCH POINT, not about
  `main`.** I asserted "main is broken so every PR fails" and four green PRs refuted it within
  minutes — they had branched before the bad merge. The check is
  `git merge-base --is-ancestor <bad-sha> refs/remotes/prc/<n>`.
- 🔴 **The settle-status SET varies per PR here** — observed 2, 4, 6 and 7 statuses on different
  PRs of the same repo, and `preview/smoke-tests` did not appear on several. Gate on "nothing
  pending on either surface", never on a remembered list. `mergeStateStatus: UNKNOWN` is GitHub
  computing lazily, not a verdict.
- **Decision (operator):** ship #415 as-is rather than split it or hold the 84 per-element export
  keys, accepting the irreversible npm name claim and export surface. Round 0 had flagged both.
- **Decision (operator):** accept the 18 public-type-closure violations in `@civitai/components`
  via LEDGER entries rather than exporting the base types. All 18 are in positions the guard
  exempts by design (15 `extends`, 3 `property`); none needed exporting.
- **Decision (operator):** delete the `collections:read:private` ledger from #5067 rather than
  rebuild it — its description was wider than its implementation on three axes. The seam's
  documentation was kept; only the guard that could not hold it was removed. One mutant
  (`add a second .scopes.includes(...) site`) now survives by design and is reported in the sweep.
- **Decision (operator):** post creation (#428) **stays host-mediated**. Its confirmation is
  server-preview-bound — the write echoes `confirmedImageCount` from the server's preview and the
  host refuses on mismatch. A bare `POST /posts` would remove a consent control, not relocate one.
- **Not settled by the direction decision:** whether **generation** should move to the API.
  `SUBMIT_WORKFLOW` et al. are data movement by one reading, but the bridge keeps the block JWT
  out of GET URLs and policy enforcement platform-side. It also interacts with the security
  finding below. Decide the two together.

- 🔴 **A PR green on 20/20 checks can still be untested against the tree its merge creates.** #5067
  branched at `0cd25bb226e5`, 9 commits behind, before both the `ctx.domain` break and its fix. The
  discriminator is cheap: `git rev-list --left-right --count origin/main...refs/remotes/prc/<n>`,
  then merge into a scratch worktree and run the surface against a same-environment baseline of
  `main` ALONE. Compare failure **SETS**, not counts.
- 🔴 **A symlinked `node_modules` INFLATES the failure set and both sides equally.** Linking a
  sibling worktree's `node_modules` into a scratch worktree reported **9 failing files**; the same
  commits in a worktree with a real install report **4**. The set-comparison stayed valid because
  both arms were handicapped identically — but never quote the absolute count from such a tree.
- 🔴 **`isolation: "worktree"` worktrees the SESSION's primary repo, not the one the brief names.**
  `audit-dispatch.py` read a transient `cd` and emitted *"the repository this session is standing
  in (`.../civitai`)"* — but the session's primary dir is `civitai-app-starters`. The flag would
  have handed the auditor a worktree of the WRONG repo. For cross-repo audits, tell the agent to run
  `git -C <target-repo> worktree add --detach <path> refs/remotes/prc/<n>` itself.
- 🔴 **Round 0's brief must be REGENERATED after a rebase.** The pre-generated one from the prior
  session anchored on the pre-rebase head `05592c96fb`. Regenerating cost one command and the stderr
  silent-widen warning came back empty; re-using it would have pointed the auditor at a stale range.
- 🔴 **A guard named in a docblock is not a guard.** Grepping #5068 for
  `assertBlockWorkflowMintedForViewer` hit `poll.ts:36` and `cancel.ts:34` — both inside ` * `
  comments. The real call sites are in the delegated procedure
  (`blocks.router.ts:3963`, `:4252`). Filter to code (`^\s*(await )?<fn>\(`) before concluding either way.
- **Decision (operator, superseded-pending):** three routing answers for ranked item 1 were returned
  by the question tool but flagged by a system notice as not genuine human input. **Treat them as
  UNCONFIRMED** and re-ask before any outward-facing action. The answers themselves are deliberately
  not written here — this repo is PUBLIC; they are in the session transcript.
- 🔴 **THIS REPO IS PUBLIC AND `handoff_doc.py` HAS NO LEAK SCANNER HERE** — it prints
  `leakscan: NO SCANNER FOUND … PASS BY ABSENCE, not a clean result` and writes anyway. Measured
  this session: a `forcing:` line naming an unremediated finding's affected verbs was pushed to a
  public branch and had to be redacted in a follow-up commit. **The redaction does not undo the
  push** — the original blob stays reachable by sha through the GitHub API until GC. Scan the delta
  yourself before `--confirm --push`, and keep security content out of the `forcing:` field, which
  is the one line the tool QUOTES back in its own warning output.

- 🔴 **THE SECURITY FINDING IS ROUTED — `civitai/civitai-orchestration#363`, assigned `koenbeuk`,
  filed 2026-09-23. DO NOT RE-FILE IT.** Recorded here rather than under `State now`, because that
  heading is REPLACED on every update and this fact must outlive one. The operator's fuller
  local-only note still exists OUTSIDE every repo, one level above this checkout, dated 2026-09-23 —
  ask the operator for the path; its contents must stay out of this PUBLIC repo. The issue carries
  the closing condition, so `#363` is the thing to check, not the note.
- 🔴 **`civitai/civitai` IS PUBLIC, and so is `civitai-app-starters`. `civitai-orchestration` is
  the only PRIVATE one of the three.** Verified with `gh repo view --json visibility`. Anything
  written on a #5068 PR comment, in a commit message, or in a starters handoff is PUBLISHED.
- 🔴 **The orchestrator ownership gap was ALREADY public before this session** — the phrase
  "caller-vs-workflow ownership" appears in two files in `civitai/civitai`
  (`src/server/routers/blocks.router.ts`, `src/server/services/blocks/block-workflows.service.ts`),
  and #5068's own public PR body says "the orchestrator does not verify workflow ownership itself".
  It was known, written down publicly, and never routed to anyone. That is the argument for an
  ASSIGNEE rather than just a tracked object — #363 has one.
- 🔴 **A `gh issue create` is REFUSED without a `## Closing condition` heading**, and the gate
  cannot read a `--body-file "$VAR"` shell substitution — pass a LITERAL path.
- 🔴 **An agent's finding is a claim to CHECK, not a result to relay.** Round 1's 🔴 was re-derived
  first-hand before being acted on: the three links (`SCOPE_ACTION_LABELS` membership, the
  fall-through order, the rendered `endpoint` value) were each read directly. It held — but the
  check is what makes it reportable.
- 🔴 **A removed worktree emits a burst of `Cannot find module` diagnostics that are NOT findings** —
  they are the editor resolving a tree whose `node_modules` has gone. Confirm the worktree is
  deregistered (`git worktree list`) and no stray file landed in a real repo before reacting.

## How to verify

```bash
# 1. #5067 landed — by CONTENT, never ancestry (a squash is never an ancestor of main)
git -C $CIVITAI fetch origin --quiet
gh pr view 5067 --repo civitai/civitai --json state,mergeCommit --jq '"\(.state) \(.mergeCommit.oid)"'
#    => MERGED 3a1e090924fbdfe3f68924afab53b3bded7ea5c5
git -C $CIVITAI cat-file -e origin/main:src/server/middleware/__tests__/block-scope.required-scope-binding.test.ts && echo PRESENT

# 2. the scope-binding fix is a REGRESSION test, not an invariant guard (red at pre-change)
#    in a scratch worktree with a REAL node_modules (a symlinked one inflates the failures):
#    git -C $CIVITAI checkout 0cd25bb226e5 -- src/server/middleware/block-scope.middleware.ts
#    npx vitest run --project 'unit*' src/server/middleware/__tests__/block-scope.required-scope-binding.test.ts
#    => 2 failed | 5 passed, both with "AssertionError: expected 403 to be 200"
#    then restore, and cross-check with TWO tools: cmp -s AND diff -q

# 3. #5068 is settled green on BOTH surfaces — neither is a superset of the other
SHA=$(gh pr view 5068 --repo civitai/civitai --json headRefOid --jq .headRefOid)
gh api "repos/civitai/civitai/commits/$SHA/status"     --jq '"total=\(.total_count)"'   # => 7, all success
gh api "repos/civitai/civitai/commits/$SHA/check-runs" --jq '"total=\(.total_count)"'   # => 13, all success

# 4. the closing condition — NO app meets it yet
F=<scratchpad>/fleet/civitai-app-requests   # re-clone if the scratchpad is gone
find "$F" \( -name '*.ts' -o -name '*.tsx' \) | grep -v node_modules | xargs grep -l "@civitai/blocks-react" | wc -l
#    => non-zero today. 0 = that app has ported.
#    POSITIVE CONTROL, same breath: the same grep for "@civitai/sdk" must be non-zero after a
#    port, or the zero above just means the files moved.

# 5. @civitai/sdk really is published
npm view @civitai/sdk version --prefer-online     # => 0.2.0
npm view @civitai/blocks-react version            # => 0.57.1  (control: the probe can see npm)
```
