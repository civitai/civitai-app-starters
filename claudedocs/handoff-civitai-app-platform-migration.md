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
  a real reading.
- 🔴 **VERDICT 2026-09-23: ADDRESSED — the arc is CLOSED.** `civitai-app-requests` runs on
  `@civitai/sdk`. Measured against the **committed** tree, not the working tree: **0** importers,
  control `@civitai/sdk` **12**, the same command on unported `civitai-block-gen-matrix` **5**,
  and `@civitai/blocks-react` absent from `package.json`. Commit `f422773`.
  ⚠ The condition is about IMPORTS and says nothing about the app working against the real
  platform — that is unverified and is ranked item 2, not part of this verdict.

## State now

✅ **THE PORT IS VERIFIED AGAINST THE REAL PLATFORM, READS AND WRITES (2026-09-24).** Driven end to
end through `civitai app dev-tunnel` → `civitai.com/apps/dev/app-requests`, with a validated
instrument (the same route unauthenticated → 401) and an equivalence check against the
still-deployed bridge build: `list` **200**, `append` **200**, `vote` **200**, `withdraw` **200**,
and `items[].viewerVoted` proven from the wire by a full page reload rather than from optimistic
UI state. The test row was withdrawn and its removal re-confirmed from the deployed build.
🔴 **One path remains unmeasured: the ANON read** — no signed-in session can produce it. Details in
the two `✅ RESOLVED` blocks at the end of "Open investigations".

Other results from the same session, in the `TRACK … RESULT` blocks: the dev-token mint can never
carry `apps:storage:shared:*` (the doc's original probe plan was impossible as written), the four
`/workflows/*` routes **404** in production because the #5068 deploy has not landed, and
`useAppStorage` **cannot** be dropped — the fleet needs a platform PR. Claims
`civitai-app-platform-migration-1` and `-2` were taken and released.

- **PR #21 MERGED** — squash `52b7e1b1` on `ZacxDev/civitai-app-requests` main. Closing condition
  re-measured ON `origin/main`: blocks-react importers **0** · control `@civitai/sdk` **13** ·
  unported control **10** · dependency absent from `package.json`. Claim released; base clone at
  `52b7e1b`; no worktrees left.
- **`innovation-upstream/devrc` PR #1862** (cairn route) — OPEN, `MERGEABLE`, rebased onto current
  main as `fd3aaed9`. 🔴 **Its 4 Tekton statuses have been `pending` since 02:16:04Z with
  `created == updated` and no movement for ~25 min, where the PRE-rebase run reached terminal
  state in ~2.5 min.** That asymmetry is the only evidence; it may be queued or stuck. Read the
  statuses before assuming it merely needs more time.
- The subsystem-index entry is still NOT landed — needs #1862 merged AND a `home-manager switch`.
  It survives at `/home/zach/workspace/civit/cairn-entry-civitai-app-requests-platform.md`, updated
  this session with the merge sha and the direnv finding.
  ⚠ **`cairn-validate --validate` on that path reports MALFORMED, and that is an artifact of the
  ASIDE FILENAME, not a defect in the content**: the validator requires the filename stem to equal
  `service:` (`platform`). Copied to `platform.md` it validates `OK — 1 of 1 entry file(s) parse`,
  and `cairn create --ref platform` names it correctly on the pod. Do not "fix" the entry.
- **No `clawgate-task:` field** — `clawgate_handoff.sh resolve` exited **5** again.
- Still NOT verified: the app against real civitai.com. Track A is exactly this.

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
- ~~**Next probe:** sync #5068 onto `main`, re-run CI, then `/audit-pr 5068` Round 0.~~
  ✅ **ALL THREE DONE 2026-09-23 — do NOT re-run this instruction.** #5068 was rebased onto main
  (head `298db52c89`, now containing `2fd658d775` and `3a1e090924`), CI re-ran and settled fully
  green on both surfaces, and Round 0 AND Round 1 have both completed. The pre-generated
  `brief-5068-r0.md` referenced here was **stale on arrival** — it anchored on the pre-rebase head
  `05592c96fb`; a rebase re-points the anchor and nothing in the tooling notices. Regenerate with
  `audit-dispatch.py <pr> --round N` rather than reusing a brief across a rebase.
  The live state for this arc is now the two Round-1 blocks lower in this section.

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

### 🟡 F4 — the REST transport evaluates Flipt as entity `'anonymous'`, and it DOES reach a control
- as-of: 2026-09-23
- **Symptom + exact repro:** `ctx.user` is `undefined` on this transport, so
  `features: getFeatureFlagsLazy({ req })` builds with no user and every caller evaluates Flipt as
  the literal entity `'anonymous'` with an empty attribute bag, while the bridge evaluates as the
  viewer.
- **Observed (with values):** `hasFeature` calls
  `isFliptSync(feature.fliptKey, user ? String(user.id) : 'anonymous', fliptContext)` with
  `buildFliptContext(undefined)` (`feature-flags.service.ts:825,883-886`). `ctx.features.wildcards`
  IS read — `blocks.router.ts:5428` (estimate), `:5786` (submit), `:8449` (customComfy) — and feeds
  `wildcardsEnabled` into `resolveCanGenerateForVersions` (`generation.service.ts:1152`), where
  `false` empties `wildcardVersionIds` so every `Wildcards`-type version returns
  `canGenerate: false` and `assertViewerCanGeneratePageResources` refuses. The static
  `availability: ['public']` half is identical on both paths
  (`feature-flags.service.ts:546,910`), so the divergence is confined to the Flipt layer.
  `via: code`
- **Ruled out:** *"the two divergences reach no control above"* — that is the PR's own docblock and
  it is FALSE as written. It enumerates TWO divergences (`ctx.user`, the `browsingLevel` write) and
  there are THREE; the third is this one, and unlike the other two it is read on the money path.
  `via: code`
- **Leading hypothesis:** harmless if the `wildcards` rule is a plain on/off, a real behaviour split
  between the two transports if it is a percentage rollout or carries any user-attribute segment.
  🔴 **The INPUT provably differs; the OUTPUT is UNVERIFIED and must not be reported either way.**
- **Next probe:** read the live `wildcards` Flipt rule — needs Flipt access this host does not have.
  If it segments on anything user-shaped, either thread a real subject into the context or refuse
  wildcard resources on this transport deliberately. Then fix the docblock's "two divergences" count.

### 🔴 CONFIRMED: the REST transport evaluates Flipt as an empty context, and it refuses real users
- as-of: 2026-09-23
- **Symptom + exact repro:** a **moderator, or one of the enumerated testers**, generating through
  `/api/v1/blocks/workflows/*` with a **Wildcards-type resource** is refused by
  `assertViewerCanGeneratePageResources`. The identical generation over the postMessage bridge
  succeeds. Every other viewer gets the same answer on both paths, so the blast radius is exactly
  that population — **which is also who would exercise a new REST surface first**, so it presents as
  "the REST routes are broken for the people testing them".
- **Observed (with values):** every link read first-hand.
  (a) `blockWorkflowCaller` sets `user: undefined` and `features: getFeatureFlagsLazy({ req })`.
  (b) `buildFliptContext(undefined)` returns **`{ isLoggedIn: 'false' }`** — no `userId`, no
  `isModerator` (`packages/civitai-flipt/src/context.ts:21-33`).
  (c) `wildcards` is declared `{ availability: ['public'], fliptKey: 'wildcards' }`
  (`feature-flags.service.ts:546`); the flag itself is `enabled: false` with rollouts ONLY for the
  `moderators` and `testers` segments, and BOTH match on `STRING_COMPARISON_TYPE` **context**
  properties (`isModerator`, `userId`) — read from `flipt-state` at **origin**, `civitai-app/default/features.yaml`.
  (d) empty context ⇒ neither segment matches ⇒ falls to `enabled: false` ⇒ **`wildcards = false`**.
  (e) `hasFeature` returns the Flipt answer and **never reaches static evaluation** — *"Flipt
  overrides role checks (both enable AND disable)"* (`feature-flags.service.ts:880-896`), so
  `availability: ['public']` is NOT a backstop.
  (f) `ctx.features.wildcards` → `wildcardsEnabled` → `resolveCanGenerateForVersions`
  (`generation.service.ts:1152`) → `false` empties `wildcardVersionIds`. `via: code`
- **Ruled out:** *"a `FEATURE_FLAG_WILDCARDS` env override makes Flipt irrelevant here"* — FALSE, no
  such override is set; and *"the flag has no context-reading segments"* — FALSE, it has two.
  Both checked before the finding was reported. `via: command`
- **Leading hypothesis:** the REST path already HAS the viewer — `parseSubjectUserId(claims.sub)` off
  the verified token, which every other viewer binding on this path uses. It simply is not passed to
  the flag evaluator.
- **Next probe:** 🔴 **NOT REPRODUCED LIVE — this is "the definitions say so".** Flipt state can be
  pushed through its UI without going through `flipt-state`, so one live evaluation
  (`svc/flipt-v2` in ns `flipt`, `POST /evaluate/v1/boolean`, both context arms) should confirm the
  blast radius before it is treated as final. ⚠ My local `flipt-state` clone was **behind origin**
  when I first read it; re-read from `origin` and the definition was identical. Do the same.

### 🔴 `preview / component-tests` red on the F4 commit — cause unknown
- as-of: 2026-09-23
- **Symptom + exact repro:** the status is `success` on `298db52c89`, `850bf03f65`, `1e36c8b983`,
  `447cafbc58`, `b72e008f24` and **`failure` on `ecdf81ae74`**. Not reproducible locally.
- **Observed (with values):** `gh api repos/civitai/civitai/commits/<sha>/status` per head gives the
  sequence above. The status is a COMMIT STATUS from the preview pipeline, not a check-run, and its
  `target_url` is `https://pr-5068.civitaic.com` — a host, **not a log**, so there is no log to grep
  from the GitHub side. Description: `Component suite failed (report-only, not blocking)`. Locally
  `npx vitest run --project component` dies at
  `browserType.launch: Executable doesn't exist at …chrome-headless-shell` — environmental.
  `via: command`
- **Ruled out:** *"inherited from the base branch"* — NOT supported: three other open PRs (5069,
  5066, 5043) carry **no** `preview / component-tests` status at all, so there is no cross-PR signal,
  and this PR's own five earlier heads were green. *"the new guard file is in the component
  project"* — FALSE: `vitest.config.mts:529` includes only `src/**/*.browser.test.tsx`.
  `via: command`
- **Leading hypothesis:** a flake, because no mechanism connects an `import type` plus two
  in-function dynamic imports in a server module to a browser component suite. **Held loosely** —
  five greens then one red is weak evidence either way.
- **Next probe:** read `preview / component-tests` on `f02e3ef8c8`. **Green ⇒ flake, proceed to
  merge.** Red again ⇒ it is real: get the preview pipeline's own log (it is Tekton-side, not
  GitHub Actions, so `gh run view` will not have it), or install the Playwright browser
  (`npx playwright install chromium-headless-shell`) and reproduce locally against both heads.

### RESOLVED: `preview / component-tests` red on the F4 commit was a FLAKE
- as-of: 2026-09-23
- **Symptom + exact repro:** the status read `failure` on `ecdf81ae74` after five consecutive
  `success` readings on this PR's earlier heads — the sequence that made it look caused.
- **Observed (with values):** on the very next head `f02e3ef8c8`, which changed **only** prettier
  formatting inside one test file, the status returned **`success`**, and the commit settled
  7/7 statuses plus 12 success + 1 skipped of 13 check-runs, zero non-success on either surface.
  `via: measurement`
- **Ruled out:** *"the F4 change broke a browser suite"* — no mechanism, and now no symptom: the
  `component` project includes only `src/**/*.browser.test.tsx` (`vitest.config.mts:529`) so the new
  `.test.ts` guard is not in it, and the only module-scope change to `block-workflow-rest.ts` was an
  `import type` (erased), with the new imports dynamic and inside a function. `via: code`
- **Leading hypothesis:** resolved — flake.
- **Next probe:** none. 🔴 **The reusable half is the METHOD, not the verdict:** a check's own
  description (`"report-only, not blocking"`) is not authority on whether to ignore it; the
  discriminator was the PER-HEAD HISTORY of that status on the same PR, and the re-run came free
  because a fix was needed anyway. Do not merge past a red on the strength of its adjective.

<!-- SUPERSEDES the earlier block "`app-requests` cannot port either — anon reads 403, and the UI
     surface is missing". BOTH halves are now closed: the 403 by #5067, and the UI/Harness half by
     commit f422773. Do NOT re-run its "Next probe" or re-derive its UI-surface inventory. Its
     live remnant — that no request with a real block token has been fired — is the block below. -->
### The ported app has never run against the REAL platform
- as-of: 2026-09-23
- **Symptom + exact repro:** not a failure — an UNMEASURED path. Everything green so far is
  green against a **fake server** (`src/platform/testing.ts`), which I wrote. A fake passing is
  evidence about the fake.
- **Observed (with values):** typecheck 0 errors; 414/414 tests; `pnpm run build` emits
  `dist/assets/index-DFoHZN0l.js 292.74 kB`; dev server serves `/src/platform/*` as JS. The
  REST contract was read first-hand rather than assumed: all 7 routes the app calls exist under
  `src/pages/api/v1/blocks/shared-storage/`, each carries `allowOpaqueOrigin` (count 3), and each
  is *"a thin adapter over the SAME function"* its bridge op called. `via: measurement`
- **Ruled out:** *"CORS will block the direct fetch"* — FALSE for these 7 routes; all carry
  `allowOpaqueOrigin`, with `me.ts` returning **0** as the control that proves the probe
  discriminates (that gap is this doc's own recorded defect). `via: command`
- **Ruled out:** *"the error copy will break because the REST routes return `{ message }` where
  the older siblings return `{ error }`"* — FALSE. `@civitai/sdk`'s http client normalises BOTH
  into `ApiError.message` (`src/http/index.ts`, `messageOf`), which is what `classifyWriteError`
  matches on, so that recorded defect is absorbed by the SDK. `via: code`
- **Leading hypothesis:** it works. Every link was read rather than assumed, and the routes
  delegate to the same server functions. The untested half is the live token + preflight.
- **Next probe:** deploy the branch to a preview origin and load it in a real civitai.com page
  slot; watch the network tab for `GET /api/v1/blocks/shared-storage/list` returning **200** with
  `items[].viewerVoted` present, then cast one vote and confirm `POST .../vote` returns the new
  count. Anonymous first (proves #5067's fix live, the probe this doc has wanted since #5067
  merged), then signed in.

### PR #21's `build` check is red on a SUPPLY-CHAIN TIME GATE, not on the code
- as-of: 2026-09-23
- **Symptom + exact repro:** `gh pr view 21 --repo ZacxDev/civitai-app-requests` reports
  `mergeable=MERGEABLE mergeStateStatus=UNSTABLE`; the single check-run `build` is
  `COMPLETED FAILURE`. It fails at `pnpm install --frozen-lockfile`, before a single test runs.
- **Observed (with values):** run `35943955997`. The log's own numbers:
  `✗ Lockfile failed supply-chain policy check (185 entries in 2.2s)` then
  `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:`
  `@civitai/sdk@0.2.0 was published at 2026-09-23T03:49:30.004Z, within the minimumReleaseAge
  cutoff (2026-09-23T01:40:35.444Z)`. The run started `2026-09-24T01:40:35Z`, so the window is
  exactly **24h**. `via: command`
- **Ruled out:** *"the port broke the build"* — FALSE. The failure is at INSTALL, before
  `pnpm test`/`pnpm build` execute; the lockfile itself is accepted
  (*"Lockfile is up to date, resolution step is skipped"*). Only ONE entry is rejected and it is
  the newly-added `@civitai/sdk@0.2.0`. `via: command`
- **Ruled out:** *"the repo configures this policy and I can find it"* — no `minimumReleaseAge`
  anywhere in the repo or in `.github/workflows/`; there is no `.npmrc` and no
  `pnpm-workspace.yaml`. It comes from pnpm 11's own defaults, not from this repo. `via: command`
- **Leading hypothesis:** it clears itself at **2026-09-24T03:49:30Z** (24h after the package was
  published) and a re-run then goes green with **no code change**.
- **Next probe:** after that timestamp, `gh run rerun <id> --repo ZacxDev/civitai-app-requests`
  (or push any commit) and read the `build` check. 🔴 **DO NOT relax or disable the policy to go
  green** — it is a supply-chain control doing exactly its job on a package published yesterday,
  and this doc already carries the rule that a gate merged through is a gate nobody reads again.

<!-- SUPERSEDES the block "PR #21's `build` check is red on a SUPPLY-CHAIN TIME GATE, not on the
     code". 🔴 ITS "Next probe" INSTRUCTION IS NOW WRONG AND MUST NOT BE FOLLOWED: it said to wait
     for 2026-09-24T03:49:30Z and "DO NOT relax or disable the policy to go green". The operator
     decided otherwise, and the resolution below is what actually happened. The diagnosis in that
     block was correct and is kept; only its instruction is retired. -->
### RESOLVED (`203328a`): the supply-chain gate was pushed through, narrowly and deliberately
- as-of: 2026-09-23
- **Symptom + exact repro:** unchanged from the superseded block — `pnpm install --frozen-lockfile`
  refused `@civitai/sdk@0.2.0` as published inside pnpm 11's 24h `minimumReleaseAge` window.
- **Observed (with values):** the fix is `pnpm-workspace.yaml` carrying
  `minimumReleaseAgeExclude: ["@civitai/sdk@0.2.0"]`. Verified in a clean room under the REAL
  pnpm **11.27.0** (the host's is 10.28.1, which has no such policy): **no exclusion** →
  `✗ Lockfile failed supply-chain policy check (185 entries)` with CI's exact error;
  **`@civitai/sdk@0.2.0`** → `✓ Lockfile passes supply-chain policies (185 entries)`;
  **`@civitai/sdk@0.2.1`** → still fails on 0.2.0. CI then went from `build FAILURE` on `122c60d`
  to `build SUCCESS` on `203328a`. `via: measurement`
- **Ruled out:** *"CI went green because the 24h window simply elapsed"* — FALSE, and this was the
  confound worth excluding before claiming any fix. The passing run started **2026-09-24T02:01:35Z**
  and the window does not close until **2026-09-24T03:49:30Z** — **1h48m later**. The two runs
  differ only by the exemption commit. `via: command`
- **Ruled out:** *"the policy is now off"* — FALSE. It still runs and still verified all **185**
  lockfile entries in the passing run; exactly one is exempt, pinned to an exact version. `via: measurement`
- **Leading hypothesis:** resolved.
- **Next probe:** none. **Delete the `minimumReleaseAgeExclude` entry once `@civitai/sdk` moves
  past 0.2.0** — it is then dead config that silently weakens the next reader's assumptions.

<!-- SUPERSEDES the ranked item "Reconcile the pnpm major: local is 10.28.1, the flake pins 11"
     AND the Gotcha claiming "This repo has no `.envrc`". 🔴 THAT GOTCHA IS FALSE — the repo has
     a TRACKED `.envrc` and has since #18. Do not act on its stated mechanism; the corrected one
     is below. The rest of that entry (a local green blind to CI's install policy) still holds. -->
### RESOLVED: the pnpm-major split was an UNAUTHORIZED `.envrc`, not a missing one
- as-of: 2026-09-23
- **Symptom + exact repro:** every local `pnpm` ran **10.28.1** while `flake.nix` pins
  `pnpmMajor = "11"` and CI runs 11, so `minimumReleaseAge` — a pnpm 11 policy — was invisible
  locally and CI caught it.
- **Observed (with values):** `direnv status` in the repo prints
  `Found RC path /home/zach/workspace/civit/civitai-app-requests/.envrc` **and**
  `Loaded RC allowed 0`; `direnv exec` answered
  *"is blocked. Run `direnv allow` to approve its content"*. The file is **TRACKED** on
  `origin/main` (`git cat-file -e origin/main:.envrc` succeeds; added in `9366021`, the same
  commit that pinned the flake) and contains `use flake`. After `direnv allow`, inside the shell:
  **node v24.19.0, pnpm 11.25.0**, and `pnpm install --frozen-lockfile` →
  `✓ Lockfile passes supply-chain policies`. `via: measurement`
- **Ruled out:** *"this repo has no `.envrc`, so nothing puts the flake on PATH"* — **FALSE, and
  it was my own claim, now retracted.** Two compounding reasons I believed it: I `ls`'d the BASE
  CLONE while it was **19 commits stale**, and `.envrc` arrived in #18 which that clone lacked;
  and the worktree I actually worked in DID carry the file, so the file was never the problem.
  `via: command`
- **Ruled out:** *"the flake does not actually provide pnpm 11"* — FALSE.
  `direnv exec <repo> bash -c 'readlink -f $(command -v pnpm)'` resolves to
  `/nix/store/…pnpm-11.25.0/…`. `via: command`
- **Leading hypothesis:** resolved on this host by `direnv allow`. The durable hazard is the
  AUTHORIZATION, not the file.
- **Next probe:** none for this host. 🔴 **A new worktree or a second host starts BLOCKED again** —
  `direnv allow` is per-path, so the same silent-wrong-toolchain state returns on the next
  `git worktree add`. Run `direnv allow <path>` at worktree creation, and check
  `pnpm --version` before quoting any result that depends on the toolchain.

### TRACK A — the REST surface has never been exercised with a real block token
- as-of: 2026-09-24
- **Symptom + exact repro:** not a failure — an UNMEASURED path. Every green reading in this arc
  came from `src/platform/testing.ts`, a fake server written in the same PR as the code it tests.
- **Observed (with values):** a way in exists and needs **no preview deploy**.
  `POST /api/v1/blocks/dev-token` (`civitai/src/pages/api/v1/blocks/dev-token.ts`) mints a
  short-lived scoped **page token** so a logged-in developer can drive local code against the
  REAL backend. Request schema (`:287`): `{ appBlockId?, slug? }`, slug `min(3).max(40)` +
  `SLUG_REGEX`. Success (`:1003`) returns
  `{ token, expiresAt, scopes, buzzBudget, maxBrowsingLevel, blockInstanceId }`. Mode 1
  ("existing-app") applies because `app-requests` is an approved, published app. Refusals to
  expect: 401 `Missing or malformed Bearer token`, 403 `Apps are restricted to the Civitai team`,
  503 `Apps are not enabled`. `via: code`
- **Ruled out:** *"this needs a preview deploy of the app"* — FALSE for the surface itself. The
  question is whether the REST routes answer a real block token; the app is just one client of
  them, and `dev-token` + `curl` answers it directly. `via: code`
- **Ruled out:** *"one probe covers the anon read too"* — **FALSE, and this is the trap.**
  `dev-token` requires a logged-in developer and mints a token bound to that user, so it exercises
  the SIGNED-IN path only. The anon read that **#5067** fixed is mint-by-the-host-for-a-signed-out
  viewer and is NOT reachable this way. It still has only unit-level evidence. `via: code`
- **Leading hypothesis:** the signed-in path works — every link was read first-hand and the routes
  delegate to the same server functions the bridge ops used.
- **Next probe:** run it, in this order.
  ```bash
  # 1. mint (needs the operator's civitai API key; 403 if the account lacks team access)
  curl -s -X POST https://civitai.com/api/v1/blocks/dev-token \
    -H "Authorization: Bearer $CIVITAI_API_KEY" -H 'Content-Type: application/json' \
    -d '{"slug":"app-requests"}'
  # => 200 { token, expiresAt, scopes, buzzBudget, maxBrowsingLevel, blockInstanceId }

  # 2. the read the whole port rests on
  curl -s -i -X GET 'https://civitai.com/api/v1/blocks/shared-storage/list?limit=25' \
    -H "Authorization: Bearer <token from step 1>"
  # => 200, body { items: [...], metadata: { nextCursor } }, and items[].viewerVoted PRESENT
  ```
  🔴 **Also probe `/api/v1/blocks/workflows/estimate`** in the same session even though
  `app-requests` never calls it — see Track B: it is the untested dependency of FIVE of the six
  remaining apps, and this is the cheapest moment anyone will ever have to find out it is broken.

### TRACK B — gen-matrix is NOT the cheap next port, and file count is the wrong metric
- as-of: 2026-09-24
- **Symptom + exact repro:** I recommended `gen-matrix` as next-cheapest on a file count of 10.
  Measuring the PLATFORM SURFACE instead refutes that.
- **Observed (with values):** `civitai-app-gen-matrix` on `origin/main` imports **14 platform
  hooks** — `useAppStorage useAppWorkflows useBlockContext useBlockResize useBlockToken
  useBuzzPurchase useBuzzWorkflow useDomainMaturity useGatedImages usePublishGenerationOutputs
  useRequestConsent useRequestSignIn useResourcePicker useSharedStorage` — against
  `app-requests`'s six. Two hard blockers, both measured with controls:
  **(1) `useAppStorage` has NO REST twin** — `0` route files match `appStorage|app-storage` under
  `civitai/src/pages/api`, control `sharedStorage|shared-storage` = **12**. 8 gen-matrix files use
  it. **(2) `ResourceCard` and `ReportButton` are absent from `@civitai/components-react`** —
  control `export { Button` hits `src/index.ts`. `via: measurement`
- **Ruled out:** *"gen-matrix does not generate"* — FALSE, and it was my own reading. A narrow grep
  for `submitWorkflow|SUBMIT_WORKFLOW|pollWorkflow` returned nothing; the app actually uses
  `useAppWorkflows`/`useBuzzWorkflow`/`useBuzzPurchase`. **A zero from a name list you invented is
  a fact about the list.** `via: command`
- **Ruled out:** *"the fleet control is 5 files"* — FALSE. That number came from
  `civitai-block-gen-matrix`, which is a SECOND CHECKOUT of the same repo
  (`ZacxDev/civitai-app-gen-matrix`) sitting on a stale `feat/production-hardening` branch. On
  `origin/main` it is **10**. Two directories, one repo, different branches. `via: command`
- **Leading hypothesis:** the cheapest remaining app is **`civitai-block-generate-from-model`** —
  the ONLY one of the six with **zero** `useAppStorage` files, and 11 distinct hooks. It still
  needs the workflows surface (4 files), which is why Track A should probe that too.
  Fleet measured 2026-09-24 (`files` = blocks-react importers; the last two columns are FILE
  COUNTS using those hooks):

  | app | files | appStorage | workflows/buzz |
  |---|---|---|---|
  | generate-from-model | 23 | **0** | 4 |
  | custom-generators | 30 | 2 | 4 |
  | playable-collections | 33 | 5 | 1 |
  | gen-matrix | 10 | 8 | 5 |
  | model-benchmarking | 44 | 10 | 2 |
  | sensei | 47 | 24 | 28 |

- **Next probe:** before choosing ANY next app, settle the platform question that gates five of
  them: **does `useAppStorage` need REST twins (an #5068-shaped platform PR), or can each app drop
  it the way `app-requests` did?** `app-requests` only escaped because the server already returns
  `viewerVoted`, making its local voted-set redundant. Read what the 2 `custom-generators` files
  and the 5 `playable-collections` files actually STORE — if it is all derivable server-side, the
  gap is avoidable; if not, the fleet needs the platform PR first.

<!-- SUPERSEDES the "TRACK A" block above. 🔴 ITS PROBE PLAN IS STRUCTURALLY IMPOSSIBLE AS
     WRITTEN and must not be re-run expecting a 200: a dev token can never carry
     `apps:storage:shared:*`. The mint half of that block is CORRECT and was exercised live;
     only its step-2 expectation is retired. Measured 2026-09-24. -->
### TRACK A RESULT — the block REST surface answered a REAL token for the first time; the port's own routes did NOT
- as-of: 2026-09-24
- **Symptom + exact repro:** ran the Track A plan against production `civitai.com`. The mint works,
  the transport works, and BOTH of the routes the plan targets refused — for two different and
  independently interesting reasons.
- **Observed (with values):** minted via the sanctioned CLI wrapper rather than raw `curl` —
  `civitai app dev-token app-requests --env` from the app repo (the CLI refreshed the stored OAuth
  credential itself; `civitai whoami` → `zachlowdenzx` id `8753561`, "Submit Apps: yes"). No
  personal API key was needed: `dev-token.ts:1b` accepts an OAuth token carrying
  `TokenScope.AppBlocksSubmit` (bit 25 = 33554432), and the CLI's stored scope `100777985` has that
  bit set. The minted RS256 JWT decodes to `blockId=app-requests`,
  `appBlockId=apb_01KXBZR1VB0F70QY4TF6AFK9K3`, `aud=civitai-app-block`, `dev=true`, 4h TTL —
  and **`scopes = ['user:read:self']` ONLY**, though the manifest declares
  `apps:storage:shared:read|write`.
  Then, all against `https://civitai.com`:

  | call | result |
  |---|---|
  | `GET /api/v1/blocks/me` | **200** `{id, username, status, buzzBudget}` — the real viewer |
  | `GET /api/v1/blocks/shared-storage/list?limit=25` | **403** `{"error":"missing required scope: apps:storage:shared:read"}` |
  | `POST /api/v1/blocks/shared-storage/vote` | **403** JSON (control — route exists, POST routes fine) |
  | `POST\|GET /api/v1/blocks/workflows/{estimate,submit,poll,cancel}` | **404 `text/html`** ×5 |

  `via: measurement`
- 🔴 **The 200 on `/blocks/me` is the positive control and it is the headline.** It is the FIRST
  time in this arc that anything other than `src/platform/testing.ts` answered. Token, signature
  verification, `withBlockScope`, Cloudflare and the pod all work end-to-end against a real block
  JWT — so the 403 below is a genuine scope refusal, not a broken probe, and the 404s are genuine
  absence rather than a transport failure.
- **Ruled out:** *"a dev token just needs the right request to carry the shared scopes"* — **FALSE,
  and it is structural.** `DEV_TOKEN_SCOPE_ALLOWLIST`
  (`src/server/services/blocks/dev-scoped-mint.service.ts:66-124`) lists `apps:storage:read` and
  `apps:storage:write` but **deliberately withholds `apps:storage:shared:*`** — its own comment at
  `:73-75` gives the reason: *"deliberately withheld pre-approval because a pre-approval app's
  storage NAMESPACE is synthetic and could collide across the approve boundary"*. `dev-token.ts`
  calls `clampDevScopes({… allowlist: DEV_TOKEN_SCOPE_ALLOWLIST})` **once, unconditionally**, so
  step (b) strips the scope on all three mint modes. `via: code`
- 🔴 **NEW FINDING — the justification does not cover the case it fires on.** `app-requests` is an
  APPROVED, published app: its namespace is not synthetic and there is no approve boundary left to
  cross, yet the clamp stripped both scopes anyway (measured above — approved-snapshot mode, scopes
  came back `['user:read:self']`). The withholding is written as a pre-approval rule and
  implemented as an all-modes rule. Widening it to the approved path is a small, well-scoped
  platform PR and is the cheapest route to the live probe this arc has wanted since #5067.
  `via: measurement`
- **Ruled out:** *"the workflows 404 means #5068 shipped broken"* — NOT supported, and it must not
  be reported that way. #5068 merged `2a2eb0fe2f` at **2026-09-23T21:40:40Z** and is an ancestor of
  `origin/main`; the probe ran **2026-09-24T02:40Z**, ~5h later. The `/shared-storage/vote` control
  returning **403 JSON** on the same POST verb proves routing is healthy, so the four 404s say the
  DEPLOY has not carried `2a2eb0fe2f` to production yet. No version/build header is exposed on
  `civitai.com` (checked `/api/health` → `{"error":"Unauthorized"}`, no `x-version`/`x-commit`
  header), so the deploy could not be read directly. `via: command`
- **Leading hypothesis:** the signed-in REST path works; nothing about it is disproven. What is now
  known is that the *dev-token* route to proving it is closed by design for shared storage.
- **Next probe:** two independent options, both cheap.
  (a) **Platform PR** — add `apps:storage:shared:read|write` to `DEV_TOKEN_SCOPE_ALLOWLIST` for the
  APPROVED-app mint mode only, then re-run the exact command below and expect **200** with
  `items[].viewerVoted` present. The 403 above is the positive control that the probe discriminates.
  (b) **Preview deploy** — the original plan: load the branch in a real civitai.com page slot so the
  HOST mints a page token off the approved manifest (that path has no dev allowlist).
  🔴 **Re-probe the four `/workflows/*` routes on any later day** — a 404 that becomes a 403 is the
  deploy landing; a 404 that survives a deploy containing `2a2eb0fe2f` is a real defect.
  ```bash
  # reproduce the whole run (the token is short-lived; never commit it)
  cd <app-requests repo> && civitai app dev-token app-requests --env   # 200, prints the JWT
  curl -s -o /dev/null -w '%{http_code}\n' https://civitai.com/api/v1/blocks/me \
    -H "Authorization: Bearer $T"                                       # 200  <- positive control
  curl -s 'https://civitai.com/api/v1/blocks/shared-storage/list?limit=25' \
    -H "Authorization: Bearer $T"                                       # 403  <- the finding
  ```
- 🔴 **STILL UNPROVEN, and one probe did not cover them:** (1) the **ANON** read #5067 fixed — the
  doc already flagged this and it remains unit-level-only; (2) `items[].viewerVoted` on a real
  response; (3) the app itself in a page slot; (4) every `/workflows/*` route, which could not even
  be reached.

<!-- SUPERSEDES the "TRACK B" block above. That block's fleet table and its
     generate-from-model recommendation SURVIVE unchanged. What is added here is the ANSWER to the
     question it left open, which it correctly framed as the gate on five of the six apps. -->
### TRACK B RESULT — `useAppStorage` cannot be dropped; the fleet needs a platform PR
- as-of: 2026-09-24
- **Symptom + exact repro:** the open question was *"does `useAppStorage` need REST twins, or can
  each app drop it the way `app-requests` did?"* Read what each app actually stores. **Answer: the
  fleet needs the platform PR.** Not one of the five stores anything derivable server-side.
- **Observed (with values):** every file read first-hand.
  - **`custom-generators`** (`src/lib/drafts.ts`) — per-viewer **DRAFTS**: a not-yet-published
    `GeneratorConfig` under a `draft:` prefix. User-authored content that exists nowhere else.
  - **`playable-collections`** (`src/lib/browse-prefs.ts`) — the browse **sort + period**, one JSON
    record. Its own docblock rules out the obvious alternatives: `localStorage` **throws** at the
    iframe's opaque origin, the app-sdk shim over it is session-scoped so it *"would read and write
    perfectly, pass every jsdom test, and PERSIST NOTHING IN PRODUCTION"*, and a URL param buys
    nothing because the address bar belongs to the host page.
  - **`gen-matrix`** (`src/persistence.ts`) — the run manifest. Its docblock states the negative
    result directly: `useAppWorkflows()` returns the workflows but **NOT which (checkpoint ×
    modifier) CELL each one was**, so *"it can't rebuild the GRID on its own"*. Server-derivable is
    exactly what this is not.
  - **`model-benchmarking`** (`src/lib/kv.ts`) — drafts + unpublished rows, and the KV listing feeds
    a path its own comment marks 🔴 **MONEY SAFETY** (the in-flight rehydrate).
  - **`sensei`** — chat session transcripts across 24 files.
  `via: code`
- **Ruled out:** *"`app-requests` dropped it, so the others can"* — FALSE and not comparable.
  `app-requests` never used `useAppStorage` at all; it dropped a local *voted-set* that the server
  already returns as `viewerVoted`. There is no such server-side twin for a draft, a grid manifest
  or a transcript. `via: code`
- **Ruled out:** *"the sandbox bans `allow-same-origin`, so web storage is impossible"* — **too
  strong, and it is `browse-prefs.ts`'s own wording.** The manifest validator bans *combining*
  `allow-same-origin` with `allow-scripts` outside the `internal` trust tier
  (`block-manifest-validator.service.ts:320-322`), and `sandbox.ts:44` DOES add it for
  `TRUSTED_TIERS`. So web storage is tier-dependent, which makes it a worse foundation than the
  comment's absolute framing suggests — not a better one. `via: code`
- **Observed — the size of the gap, with controls:** there is **no** per-viewer app-storage REST
  route. Enumerating `src/pages/api/v1/blocks/` gives 30 files: 11 `shared-storage/*` and **0**
  `app-storage`-shaped (positive control: the same enumeration lists all 11 shared-storage routes
  and all 4 `workflows/*` routes, so the zero is a real reading). The server implementation exists
  and is substantial — `apps.router.ts` `appsStorageRouter` carries `get`/`set`/`delete`/`list`
  (+`getQuota`) at `:469,508,937,1021,1105` with per-app and per-user quota ceilings. The block
  scopes exist too: `apps:storage:read|write` are declared at
  `block-scope.constants.ts:76-77`. **What is missing is only the REST adapter** — the same shape
  #5068 built for the four workflow procedures. `via: measurement`
- 🔴 **Second half of the gap, not previously recorded:** `@civitai/sdk` has **no storage client at
  all**. `AppClient` is `{site, orchestration, host, requestGrants, getToken}`
  (`packages/civitai-sdk/src/app/index.ts:25-46`); the only `storage` hits in the package are
  `sign-in/` and `session/` (browser storage for the OAuth session). `app-requests` reaches shared
  storage through its own hand-rolled `src/platform/` layer. So a fleet-wide fix is TWO pieces —
  the REST routes and an SDK client — or every app hand-rolls its own. `via: measurement`
- **Leading hypothesis:** `generate-from-model` (0 appStorage files, 23 blocks-react importers)
  ports without waiting for any of this, and is the right next app — unchanged from the block above.
  The other five wait on the platform PR.
- **Next probe:** scope the app-storage REST PR against #5068 as the worked precedent (4 routes ×
  thin adapter over the existing `appsStorageRouter` procedures), and decide whether the SDK gets a
  `storage` client or each app keeps hand-rolling. Operator call on sequencing — it is a platform PR
  that unblocks 5 apps, against porting the 1 app that needs nothing.

<!-- SUPERSEDES ranked item 1 as first written after Track A ("widen DEV_TOKEN_SCOPE_ALLOWLIST").
     🔴 DO NOT WRITE THAT PLATFORM PR — it is not needed. The route below already exists. -->
### NO PLATFORM PR NEEDED — `dev-tunnel` on an APPROVED app takes the PROD page mint, which grants the shared scopes
- as-of: 2026-09-24
- **Symptom + exact repro:** Track A concluded the live probe needed a platform change, because
  `DEV_TOKEN_SCOPE_ALLOWLIST` strips `apps:storage:shared:*`. That conclusion was right about the
  **bearer** mint and wrong about the fleet: a second, unclamped mint path already exists.
- **Observed (with values):** the storage-stripping tunnel branch is `tryDevTunnelScopedMint`
  (`src/pages/api/v1/block-tokens/index.ts`), and it is gated to PRE-APPROVAL apps by **two
  independent guards**, either of which alone excludes `app-requests`:
  `if (!appBlockId.startsWith(EPHEMERAL_APP_ID_PREFIX)) return 'continue'` (`:411`, prefix
  `'ephemeral-'` at `:173`) and `if (!app || app.status !== 'ephemeral') return 'continue'`
  (`:461`). The token minted this session decodes to
  `appBlockId = apb_01KXBZR1VB0F70QY4TF6AFK9K3` — not `ephemeral-` — and `civitai app view
  app-requests` reports the app APPROVED and live at `https://app-requests.civit.ai`, author
  `zachlowdenzx` (the same account). So the branch returns `'continue'` and the request falls
  through to the PROD page mint, `BlockRegistry.resolvePageBlock(appBlockId)` (`:835`), whose only
  scope clamp is the OAuth ceiling `validateBlockScopesAgainstOauthClient` (`:1002`). Both storage
  scopes are `SKIP_OAUTH_CHECK` (`block-scope.constants.ts:76-86`), and `:1088` states it directly:
  *"Publisher/ambient scopes (`block:settings:*`, `apps:storage:*`) are consent-exempt and always
  pass through"*. `via: code`
- **Ruled out:** *"the tunnel mint also strips storage, so it is no better than `dev-token`"* —
  **FALSE, and it was my own reading.** I took it from `dev-scoped-mint.service.ts`'s docblock
  (*"WITHOUT apps:storage:* — Decision 1: App Storage stays 403 until approval"*) and stopped at the
  summary. The docblock is accurate; the clause that matters is **"until approval"**, and the code
  implements it as an `ephemeral`-only branch. A COMMENT IS A CLAIM — this one was true and I read
  half of it. `via: code`
- **Leading hypothesis:** `civitai app dev-tunnel` from the ported branch renders the LOCAL build
  inside the real host at `civitai.com/apps/dev/app-requests`, the host mints a real page token
  carrying `apps:storage:shared:read|write`, and the port is exercisable end-to-end with no
  platform change at all.
- **Next probe:** none — ✅ **RUN 2026-09-24, and it passed.** See the block below.

### ✅ RESOLVED — the ported app READ THE REAL PLATFORM. `shared-storage/list` → 200
- as-of: 2026-09-24
- **Symptom + exact repro:** the arc's last unmeasured path. Ran the dev-tunnel probe end to end
  with the operator's authorization: local dev server → `civitai app dev-tunnel` → the real host
  page at `civitai.com/apps/dev/app-requests`, logged in as `zachlowdenzx` (id 8753561).
- **Observed (with values):** the page mint granted the scopes the dev-token mint strips. Read off
  `__NEXT_DATA__.props.pageProps` on the dev host page:
  `{"scopes":["apps:storage:shared:read","apps:storage:shared:write","user:read:self"],`
  `"status":"approved","trustTier":"unverified","appBlockId":"apb_01KXBZR1VB0F70QY4TF6AFK9K3"}`.
  `status: "approved"` is the field the whole prediction turned on — it is what makes
  `tryDevTunnelScopedMint` return `'continue'`. Then, measured INSIDE the app's own OOPIF via
  `performance.getEntriesByType('resource')`:

  **`GET /api/v1/blocks/shared-storage/list?limit=25` → `responseStatus: 200`, `initiatorType:
  fetch`, 284 ms.** The app rendered its real UI — header, Top/Newest tabs, "Request an app" —
  with no error surface. `via: measurement`
- **Instrument validated BOTH ways before the 200 was believed** (the flows file warns that a
  block's network is unobservable from the isolated world, so this needed proving, not assuming):
  **positive** — 48 resource entries present, including the app's own bundle
  (`dev-c26cbf20b8108604.civit.ai/src/main.tsx`, 200); **negative** — the SAME route fetched from
  the same frame WITHOUT auth returned **401** `{"error":"Block token required"}` and its timing
  entry read `responseStatus: 401`. So the field discriminates on this exact route; the 200 is a
  real reading, not a default. A first bogus-URL control returned `responseStatus: 0` — that is the
  no-`Timing-Allow-Origin` case, NOT a status, and it is why the control was re-run against a real
  route. `via: measurement`
- **Ruled out:** *"the empty board means the read silently failed"* — FALSE, and this was the
  `EMPTY RESULT` trap sitting right on top of the result. The app shows "No requests yet", which is
  the observable shared by a 200-with-no-rows and a swallowed 403. Discriminated by loading the
  **DEPLOYED, still-bridge-based** build at `civitai.com/apps/run/app-requests` (frame
  `app-requests.civit.ai`) in the same session: it renders the **identical** board state. Two
  different transports, same data, same answer — the board is genuinely empty. `via: measurement`
- **Ruled out:** *"CORS will block the direct fetch from the opaque block origin"* — FALSE, now
  EMPIRICALLY not just by reading `allowOpaqueOrigin`: the cross-origin fetch from the block frame
  to `civitai.com` completed and its body was readable. `via: measurement`
- **Side observation, NOT introduced by the port:** the host page renders *"App Requests is missing
  permissions it needs to work fully / Review permissions"* — on the dev page **and** on the
  deployed run page. Present on both builds, so it is a consent-ledger state
  (`user:read:self` is consent-gated; `apps:storage:*` are consent-exempt), not a regression. It
  did not stop the storage read.
- **Leading hypothesis:** the signed-in REST path works. The port is verified against the real
  platform for the read the whole board rests on.
- ✅ **THE WRITE PATHS AND `viewerVoted` ARE NOW PROVEN TOO** — see the block below, run with the
  operator's explicit go-ahead. What remains unproven is only the **ANON** path #5067 fixed: the
  tunnel session is signed in, so that is untouched and still unit-level-only.

### ✅ RESOLVED — every write path round-trips, and `items[].viewerVoted` is real
- as-of: 2026-09-24
- **Symptom + exact repro:** the two gaps the read-only probe left. Closed by driving the app's own
  UI through a second dev-tunnel session (`dev-358847038648629d.civit.ai`): post → vote → reload →
  withdraw, with the operator's authorization for a user-visible write to a LIVE published board.
- **Observed (with values):** every call read from `performance.getEntriesByType('resource')`
  inside the app's OOPIF, same validated instrument as the block above.

  | step | call | status |
  |---|---|---|
  | initial load | `GET /shared-storage/list?limit=25` | **200** |
  | post the request | `POST /shared-storage/append` | **200** (530 ms) |
  | app re-reads | `GET /shared-storage/list?limit=25` | **200** |
  | up-vote | `POST /shared-storage/vote` | **200** |
  | withdraw | `POST /shared-storage/withdraw` | **200** |

  The row rendered with author *"A Civitai member · just now"*; the vote control moved
  `aria-pressed="false"` / `aria-label="Up-vote (0)"` → `aria-pressed="true"` /
  `"Remove your vote (1)"` / `"✓ Voted · 1"`. `via: measurement`
- 🔴 **`items[].viewerVoted` proven from the SERVER, not from optimistic local state** — this is the
  discriminator that makes the claim worth anything. After voting, the whole page was re-navigated
  so the iframe was destroyed and rebuilt: on that fresh load the ONLY shared-storage call was
  `GET /list?limit=25 → 200`, and the button still read `aria-pressed="true"` / `"✓ Voted · 1"`.
  No write, no cached component state — the pressed state can only have come off the wire.
  `via: measurement`
- **Ruled out:** *"the vote button state is just an optimistic UI update"* — FALSE by the reload
  above. Without it, the post-vote reading is exactly what an optimistic update looks like.
- **Synthetic-input control, per `flows/civitai.com.md`:** every `click`/`type` inside `--frame`
  reports `trusted: false`, which is a standing excuse for any null result. Pre-empted: the
  composer opened from a synthetic click, `title-input` read the typed string back VERBATIM, and
  `submit-btn.disabled` moved `true → false` on type — a moving signal, not a constant. So the
  ops demonstrably reach this app.
- **Cleaned up — verified, not assumed:** the test row was withdrawn (`/withdraw → 200`, board back
  to "No requests yet"), and the removal was re-confirmed from the **independent deployed
  bridge-based build** at `/apps/run/app-requests`, which also shows an empty board. Nothing was
  left on the live board.
- **Side observation:** the row rendered its author as *"A Civitai member"* rather than the
  posting user. Consistent with the ungranted `user:read:self` consent the host banner reports
  (`apps:storage:*` are consent-exempt, `user:read:self` is not) — worth a look before submitting,
  but it did not affect any storage call.
- **Leading hypothesis:** the port is verified end to end for a signed-in viewer. Read, append,
  vote and withdraw all round-trip against the real platform, and the app's UI reflects real
  server state.
- **Next probe:** the ANON path only — `#5067`'s fix still has unit-level evidence alone, and no
  dev/tunnel session can produce a signed-out viewer. It needs a real signed-out browser against a
  deployed build of the ported app.
- **Two operational gotchas, both cost a cycle:** (a) `civitai app dev-tunnel` defaults to
  `--port 5186` but this app's `dev:tunnel` script serves **5187** (`vite --port 5187
  --strictPort`), so the port must be passed explicitly; (b) **`direnv exec <dir> <cmd>` does NOT
  change directory** — it loads that dir's env and runs in the CURRENT cwd, so `pnpm run dev:tunnel`
  resolved against the WRONG `package.json` and failed `ERR_PNPM_NO_SCRIPT Missing script:
  dev:tunnel`, which reads exactly like a missing script. Use `pnpm -C <dir> run …`. The same
  mismatch explains a `pnpm --version` of 10.28.1 (starters) vs 11.25.0 (this repo).

## 🔴 IN FLIGHT — seven agents dispatched 2026-09-24, fleet-wide

Operator decision, 2026-09-24: run the whole remaining fleet in parallel, with the five
storage-blocked apps getting SCOPING rather than a port that would have to drop `useAppStorage`.
Autonomy granted: **branch + PR, no merge** — review is the operator's.

| # | repo | branch | shape |
|---|---|---|---|
| A | `ZacxDev/civitai-block-generate-from-model` | `feat/civitai-sdk-port` | ✅ **DONE — PR #11**, round 0 done, fixes in flight |
| B | `civitai/civitai` | `feat/app-storage-rest` | 4 REST adapters over `appsStorageRouter` |
| C | `civitai-app-custom-generators` | — | read-only scoping |
| D | `civitai-app-playable-collections` | — | read-only scoping |
| E | `civitai-app-gen-matrix` | — | read-only scoping |
| F | `civitai-app-model-benchmarking` | — | read-only scoping |
| G | `civitai-app-sensei` (branch `trunk`) | — | read-only scoping |

**All five scoping agents (C–G) are DONE.** Their plans live in
`claudedocs/fleet-port-scoping-2026-09-24.md`, deliberately NOT in this doc.

🔴 **THEIR COLLECTIVE HEADLINE CORRECTS TRACK B: app-storage is NECESSARY BUT NOT SUFFICIENT.**
Track B concluded the fleet needs "the app-storage platform PR". Five agents reading five apps
independently surfaced **five** missing platform surfaces. Verified first-hand with one shared
positive control — `submitWorkflow` → **1** of the **30** route files under
`src/pages/api/v1/blocks`:

| surface | REST routes | in SDK `HostRequests`? | blocks |
|---|---|---|---|
| `useAppStorage` | 0 | no | 5 apps — **being built** (agent B) |
| `usePublishGenerationOutputs` | 0 | no | gen-matrix, model-benchmarking |
| `useGatedImages` | 0 | no | gen-matrix, custom-generators, model-benchmarking |
| `useAppWorkflows` | 0 | no | gen-matrix |
| `useImageUpload` / `OPEN_IMAGE_UPLOAD` | 0 | no | custom-generators |
| `SET_USER_CHECKPOINT` | 0 | no | **generate-from-model — already shipped degraded in PR #11** |

The sixth was found by the PORT, not a scoping pass, and it carries the strongest evidence of the
set: **0** REST routes and **0** in `HostRequests`, but **5 files in the blocks-react bridge
package** implement it. The capability demonstrably exists on the old transport and has no home on
the new one. Consequence already merged into a PR: `useCheckpointPicker().persist` is a **no-op** —
the viewer's checkpoint override survives the session but not a remount. It resolves rather than
rejects deliberately, because rejecting fires the call site's rollback and shows an error banner on
every swap.

`HostRequests` is four ops (`SAVE_IMAGE`, `OPEN_RESOURCE_PICKER`, `OPEN_BUZZ_PURCHASE`,
`REQUEST_TOKEN`), so the bridge is no escape hatch for any of them.

**Two apps cannot reach 0 blocks-react importers even after B lands** — `gen-matrix` (three
surfaces) and `model-benchmarking` (publish). Their PRs must state a reduced count with the
retained surfaces NAMED, not claim the closing condition.

🔴 **The sharpest single finding is `useAppWorkflows`.** A plausible substitute exists
(`app.orchestration.queryWorkflows({tags})`) and it is **wrong in a way that type-checks and passes
tests**: the bridge's host FORCES the per-app tag filter server-side, while the orchestrator client
takes tags from the caller — so substituting it relocates a trust boundary into the iframe.

**B remains the other coupling** — C–G all planned against the tRPC `appsStorageRouter` contract
(`get`/`set`/`delete`/`list`/`getQuota`) assuming B's routes mirror it; if B's shape diverges,
re-read their plans against what B shipped. B was sent F's money-safety constraints mid-flight:
`list` must **401 on auth failure, never 200-with-empty**, or `model-benchmarking`'s double-spend
backstop silently disarms and every reload double-charges.

🔴 **The two ports (A, B) were told to build their OWN worktrees with `git -C <repo> worktree add`,
NOT to take a worktree-isolation flag** — this session's cwd is `civitai-app-starters`, so a flag
would have worktreed the WRONG repo. They were also told to `cp .envrc` + `direnv allow` into the
worktree (a worktree carries neither `.envrc` nor submodules), and `git stash` was forbidden.

Claims `civitai-app-platform-migration-1` (A) and `-2` (B) were held and are now RELEASED.

### ✅ ALL THREE PRs ARE REVIEW-READY (2026-09-24T05:0xZ). None merged.

| PR | head | state | notes |
|---|---|---|---|
| `civitai/civitai#5085` | `58cb9314` | **check-runs all green**; lint failure→success | one status red, see below |
| `…/civitai-block-generate-from-model#11` | `5750a67` | `MERGEABLE`/`CLEAN`, build pass | 2 commits, 2 public corrections |
| `ZacxDev/civitai-app-requests#22` | — | `MERGEABLE`/`CLEAN`, build pass | 2 files, +16/−33 |

🔴 **#5085's remaining red is `preview / component-tests`, and the two CI surfaces disagree in BOTH
directions on this PR** — the blocking lint failure appeared ONLY in check-runs, and
`component-tests` appears ONLY in statuses. Read both or you will believe whichever you checked.

**Is that red #5085's own?** Applied this doc's own discriminator rather than the check's adjective
(*"report-only, not blocking"* — this doc already records that an adjective is not authority):
- **Per-head history on this PR: red on BOTH heads** (`d97753136a`, `58cb93144e`). That is NOT
  #5068's flake signature (five greens then one red).
- ⚠ **The fix agent called it "pre-existing, failing on the parent commit" — that reasoning does not
  hold**, because the parent IS this PR's own first head. It establishes "red since this PR began",
  not "inherited". Same shape as the `pre-existing lint errors` defence that already failed on this
  PR.
- **The actual discriminator — a cross-PR signal — supports the conclusion anyway:** open
  **PR #5077** carries `component-tests=failure` on an unrelated change. Four other open PRs
  (5080, 5073, 5069, 5043) do not carry the status at all, so they are silent rather than contrary.
  The base tip has no such status posted.
- **Mechanism:** #5085's fix commit is comments-only in two SERVER files, and the `component`
  project includes only `src/**/*.browser.test.tsx`. No mechanism connects them.
- 🔴 **NOT attributable by the failing TEST**, which is what this doc's rule actually asks for: that
  status's `target_url` is a HOST, not a log, and it is Tekton-side, so `gh run view` has nothing.
  Verdict: **consistent with a shared cause, not established as one.** Do not merge past it on the
  strength of its adjective; get the Tekton log or accept it deliberately.

### Round-0 FIX batch — three agents dispatched 2026-09-24T04:30Z
Both PRs passed round 0 with `requirement questioned`, neither with `close`. Fixes dispatched, one
agent per repo, **push to branch, no merge**:

| repo | what |
|---|---|
| `civitai/civitai` #5085 | the 7 `no-empty-function` errors reddening CI; correct the unreproducible `13 → 12` bearer claim; PR comment correcting the gate table |
| `…/civitai-block-generate-from-model` #11 | delete the inert `minimumReleaseAgeExclude`; `@civitai/app-sdk` → `devDependencies`; PR comment correcting 26-vs-25 importers and the 4-reds-3-causes matrix |
| `ZacxDev/civitai-app-requests` | new PR deleting its now-inert `minimumReleaseAgeExclude` |

🔴 **Four round-0 findings were deliberately WITHHELD from the fix agents as operator decisions**,
and each was named in its brief as do-not-touch:
1. **R4 / the checkpoint degradation** — may this port ship a viewer-visible behaviour loss on a
   README note? `App.tsx:1143-1150`'s unreachable catch is entangled with it: deleting presumes the
   no-op stays, surfacing an error presumes it does not. Held rather than pre-empted.
2. **`enforceAppBlocksFlag` on the five storage procedures** — removing it dissolves R6 but is a
   live behaviour change on the bridge path.
3. **The `updatedAt` wire shape** — fix in #5085 (emit an epoch number) or in `gen-matrix` (declare
   `string`). Pin whichever with a test that loads BOTH sides.
4. **Anon → 403 vs bridge-parity `null`** for the three read routes. Keep 403 for `list` (the money
   chain needs a throw); `get`/`quota` are a free choice overriding no evidence.

## Next steps (ranked)

1. ✅ **DONE — `civitai-block-generate-from-model` is ported. Review + merge PR #11.**
   `https://github.com/ZacxDev/civitai-block-generate-from-model/pull/11` — branch
   `feat/civitai-sdk-port`, 42 files, +2419/−205, `MERGEABLE`/`CLEAN`, `build` **pass**.
   **Closing condition re-measured by me on the COMMITTED tree (`bba558b`), not taken from the
   agent:** blocks-react **importers 0** · the string survives in exactly **1** file,
   `src/platform-seam.test.ts`, which is the guard enforcing the zero and must name what it forbids
   · positive control `@civitai/sdk` **11** · unported control `gen-matrix` **10** · dependency
   absent from `package.json`.
   ⚠ **Not verified against production and cannot be**: all four `/workflows/*` routes still
   **404** (re-probed 03:56Z; controls `/blocks/buzz` and `/blocks/shared-storage/list` → 401 JSON).
   The generation path is green only against a fake server — the agent stated this in the PR body,
   the README and `workflows.ts`. Also unclicked: the dev harness, the picker and purchase modals
   against a real host.
   ⚠ **Behaviour loss shipped deliberately**: `useCheckpointPicker().persist` is a no-op (surface 6
   above). Also no picker pre-highlight and no `newBalance` from the purchase modal.
   ⚠ `pnpm-workspace.yaml` carries another narrow `minimumReleaseAgeExclude` for `@civitai/sdk@0.2.0`
   — same written-expiry condition as item 6.
   The agent recommends `/audit-pr 11`, Round 0 first, while the merge decision is still open.
   forcing: user — review is the operator's; the agent was told not to merge.
2. **Decide the app-storage platform PR** — 4 REST adapters over `appsStorageRouter`
   (`get`/`set`/`delete`/`list`), #5068-shaped, plus whether `@civitai/sdk` grows a `storage`
   client or each app hand-rolls one like `app-requests` did.
   forcing: gate — five of the six remaining apps are blocked behind it.
3. **Re-probe `/api/v1/blocks/workflows/*` until #5068 deploys.** 🔴 **The check needs NO token and
   no browser** — an UNAUTHENTICATED POST discriminates: a route that exists answers **401
   `{"error":"Block token required"}`** (`application/json`), an absent one answers **404
   `text/html`**. Control: `/shared-storage/list` unauthenticated → 401 JSON. Read
   2026-09-24T03:0xZ: all four still **404**, ~5.5h after `2a2eb0fe2f` merged.
   ```bash
   for r in estimate submit poll cancel; do
     curl -s -o /dev/null -w "$r %{http_code} %{content_type}\n" -X POST \
       "https://civitai.com/api/v1/blocks/workflows/$r" -H 'Content-Type: application/json' -d '{}'
   done
   ```
   forcing: gate — #5068's surface is unverified in production, and item 1 lands on it.
4. **DEFERRED (operator, 2026-09-24) — prove the ANON read.** The last unmeasured path in the
   `app-requests` port. `#5067`'s fix rests on unit evidence alone; no dev-token or dev-tunnel
   session can produce a signed-out viewer, so it needs a deployed build of the PORTED app loaded
   in a signed-out browser. Expect **200**; the pre-`3a1e090924` **403** is the positive control.
   🔴 Deferred, NOT dropped — the app's stated premise is *"Anyone can read the board signed out"*,
   so this is the one remaining way the port could be wrong for real users.
   forcing: user — deliberately deferred.
5. **Merge devrc #1862, `home-manager switch`, then land the cairn entry** from
   `/home/zach/workspace/civit/cairn-entry-civitai-app-requests-platform.md` with
   `cairn create --scope civitai-app-requests --ref platform --file <file>`. 🔴 Check its Tekton
   statuses first — they were stuck `pending` for ~25 min.
   forcing: gate — the index write is blocked until the route is live.
6. 🔴 **Delete BOTH `minimumReleaseAgeExclude` blocks NOW — the stated condition is the WRONG one
   and they are already inert.** This item used to read *"when `@civitai/sdk` moves past 0.2.0"*.
   That is not the expiry: the real one was pnpm 11's **24-hour clock**, and it ran out at
   **2026-09-24T03:49:30Z** (`@civitai/sdk@0.2.0` published `2026-09-23T03:49:30.004Z`, confirmed via
   `npm view @civitai/sdk time`). Two repos carry one — `civitai-app-requests/pnpm-workspace.yaml:31`
   and the `generate-from-model` port (PR #11).
   🔴 **PR #11's was inert 7 MINUTES BEFORE THE COMMIT THAT ADDED IT**: commit `6d03c5c` is authored
   `2026-09-23T22:56:34-05:00` = `2026-09-24T03:56:34Z`, seven minutes after the window shut. It was
   carried across from `app-requests` without re-reading the clock and has never had any effect in
   that repo. Round 0 proved this with both controls — exclude removed + default policy → **PASS**;
   negative control (`minimumReleaseAge: 100000`, no exclude) → **4 violations** naming
   `@civitai/sdk@0.2.0`; positive control (same, exclude present) → **3**, the package gone. The
   timestamps re-verified first-hand.
   Left in place, 28 lines documenting a supply-chain exemption that does nothing will read to the
   next maintainer as an ACTIVE HOLE in a security control, expiring on a condition that will never
   be the reason.
   forcing: security — a standing exemption that is now pure misinformation.
7. **Ask GitHub Support to purge `9c97491136c4eb0b6bd7c73f3d6abc3f856ab6da`** in
   `civitai/civitai-app-starters` — force-pushed off the branch, still reachable by sha.
   forcing: security — residual exposure on a PUBLIC repo from an earlier session's leak.
8. **Ratify or reject R14** — #5068 reached tRPC via a `blocksRouter` caller, diverging from the
   body-extraction precedent #5054/#5055 set.
   forcing: user — an operator call, not an engineering one.
9. **Revisit F2/F6 when a GENERATION app adopts the poll surface.** Still unfired: `app-requests`
   does not generate. Track A could not fire it at all — `/workflows/poll` 404s in production today.
   forcing: user — deferred deliberately, not dropped.
10. **Prune this document.** 🔴 **The "65,536 B ceiling" this item used to cite is WRONG.**
    `handoff-audit.py` reports **target 12,288 B · hard cap 40,960 B**, and says plainly that
    NEITHER is enforced here — this repo ships no `scripts/tests/test_handoff_doc_size.py`, so
    nothing can go red and the numbers are judgement, not a gate. Measured 2026-09-24:
    **113,670 B — 9.3× target**, of which the tool measures **16,129 B (14.2%)** evictable
    (6 resolved investigation blocks, 2 retracted bullets; **0** completed ranked items).
    `Open investigations` alone is **62,739 B**. Evicting everything the tool finds still leaves
    ~97 KB, so the real lever is summarising resolved arcs, not deleting the marked bullets.
    forcing: none — but this session added ~11 KB, so the trend is the wrong way.

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

- 🔴 **A COMMENT CAUSED THE ONLY DEPLOY-BLOCKING FINDING OF ROUND 1.** `submit.ts` justified a real
  design decision with *"`ai:write:budgeted` is not in `READ_SCOPE_LABELS`"* — true, and one map
  short: `humaniseScopeInvocation` falls THROUGH that map into `SCOPE_ACTION_LABELS`. The decision
  survived; the three READ-shaped twins did not. **The retracted reasoning is now recorded IN the
  docblock** so the next reader cannot re-derive it. Generalises: when a comment argues from a
  registry's membership, check what the code does AFTER that registry misses.
- 🔴 **MAKING A FIELD REQUIRED BREAKS THE TEST THAT PINNED IT OPTIONAL — and the honest move is to
  INVERT that test, never to relax the change.** F5 broke 10 tests; one was literally named *"omits
  idempotencyKey entirely when the caller sent none"*. Rewritten to assert the 400 and to assert the
  mock is NOT called, so the refusal is pinned at the schema rather than somewhere downstream.
- 🔴 **THREE IDENTICAL STRINGS, ONE OF WHICH MUST NOT CHANGE.** Three call sites read exactly
  `createMocks({ body: { body: TXT2IMG_BODY } })`; two needed a key added and the third was the NEW
  refusal test that must stay keyless. A `replace_all` would have silently green-washed it. Count
  occurrences first, then anchor each edit on unique surrounding lines — and where all N genuinely
  do need the same change (the 5 seam call sites), count them BEFORE using `replace_all`.
- 🔴 **A PASSING TYPECHECK IS NOT A LIVE GUARD.** F3's fix was only believable after deleting a
  required context field and watching `TS2345` name it. The same edit against the PRE-fix tree
  compiled clean — that pair is the evidence, not the green.
- 🔴 **`[exited with code 0]` FROM A CI WAIT-LOOP IS A CLAIM ABOUT THE LOOP.** An empty
  "non-success" list is indistinguishable from an empty rollup, so quote the TOTALS beside it:
  `statuses total=7 success=7`, `check-runs total=13 success=12 skipped=1`.
- 🔴 **THE SECURITY FINDING IS ROUTED — `civitai/civitai-orchestration#363`, assigned `koenbeuk`,
  2026-09-23. DO NOT RE-FILE.** Recorded under this APPEND heading on purpose: `State now` is
  REPLACED on every update and this must outlive one. The operator's fuller local-only note is
  OUTSIDE every repo, one level above this checkout — ask the operator; its contents stay out of
  this PUBLIC repo. `#363` carries the closing condition, so check the issue, not the note.

- 🔴 **I TWICE CLAIMED THE ATTRIBUTION GATE HAD FIRED WHEN IT HAD NOT, AND BOTH TIMES IT WAS MY
  ARITHMETIC WEARING THE MACHINE'S AUTHORITY.** `audit-dispatch.py --round N` exits **0** and
  assembles a brief; it does NOT refuse. Two independent reasons, both worth knowing before anyone
  plans a stop around it: (a) its ledger reads **`COULD NOT MEASURE`** whenever the assembling
  checkout is not standing on the PR head — and a failed command is NOT a zero; (b) its classifier
  counts **block comments and docstrings as EXECUTABLE on purpose** (over-counting keeps the gate
  silent — the fail-open direction), so a round of pure JSDoc edits still reads non-zero. The gate
  also needs **both** of the two most recent blocks to read zero, and a ladder that honestly keeps
  one unit across rounds will usually have a non-zero stated count in one of them.
  **A ladder stop is a JUDGEMENT. Say so, and show the measurement it rests on.**
- 🔴 **DO NOT RECLASSIFY THE PAYLOAD UNIT MID-LADDER TO FORCE A STOP.** The temptation was live and
  explicit: switching to "executable lines only" at round 4 would have produced the gate refusal I
  wanted. Kept the line-count unit across all five rounds and reported the executable-zero as a
  SECOND count under its own name, saying which the stop was taken on. That is the shape the rule
  asks for, and it is what made the retraction above possible rather than embarrassing.
- 🔴 **COPYING HALF A SIBLING GUARD'S SHAPE LEFT A GAP IN THREE CONSECUTIVE ROUNDS, ON THREE AXES.**
  The same enumeration guard was blind to `.tsx` (round 3), then to directory-shaped routes
  (round 4), then to routes NESTED UNDER AN ALREADY-LABELLED DIRECTORY (round 5) — where
  `submit/retry.ts` collapsed to `submit`, which the assertion loop filters out, so it was never
  checked at all. Each round I mutated only the case I had imagined. **The sibling
  (`block-scope.normalize-endpoint.test.ts`) had the correct full-relative-path shape from the
  start; take the WHOLE predicate, not the half you need.**
- 🔴 **A MUTATION PROVES THE CASE YOU IMAGINED, NOT THE CASE THAT EXISTS.** Round 2's guard was
  "proven" by a `.ts` mutant and was blind to `.tsx`. Vary the SHAPE of the mutant, not just its
  presence — and prefer a predicate the repo already uses over one you derive.
- 🔴 **REMOVING A FALSIFIABLE NUMBER IS NOT A CORRECTION.** "already maps all four endpoint tokens"
  (false) → "maps the synthetic endpoint tokens" (still false, and now unfalsifiable) → **"FOUR of
  the FIVE, `post:create` has none"**. A vaguer sentence is harder to check, not safer. State the
  count AND name its exception, then pin it — nothing asserted on the arm count for three rounds.
- 🔴 **A STATUS WITH SIX HOMES HAS SIX EDIT SITES AND NO GREPPABLE ANCHOR.** The hold status was
  restated six ways in one comment block; two successive rounds each corrected one copy and left the
  rest, and they then contradicted each other ten lines apart. Consolidated into one delimited box
  that the surrounding evidence supports but never restates.
- **Decision (operator):** F1's fix went in the SHARED `humaniseScopeInvocation` rather than a
  per-route stash, so no future `ai:write:budgeted` route inherits the bug; `idempotencyKey` was made
  REQUIRED on the REST submit route; F2/F6 recorded rather than implemented.

- 🔴 **A PROD FLIPT READ PATH ALREADY EXISTS ON THIS HOST, VIA ANOTHER SESSION'S PORT-FORWARD.**
  `kubectl port-forward -n flipt svc/flipt-v2 18081:8080`, started with
  `KUBECONFIG=/home/zach/workspace/civit/datapacket-talos/prod-kubeconfig` (read its `/proc/<pid>/environ`
  to confirm which cluster before trusting it). My own kube contexts are LOCAL ONLY — `colima`,
  `k3d-diffsona*` — so without that forward there is no Civitai cluster access from here.
  🔴 **It is NOT mine: read through it, never kill it.** Evaluate with
  `POST localhost:18081/evaluate/v1/boolean {"namespaceKey":"default","flagKey":…,"entityId":…,"context":{…}}`.
- 🔴 **THE FLIPT NAMESPACE KEY IS `default`, NOT `civitai-app`.** `civitai-app` is the INSTANCE
  DIRECTORY in `flipt-state` (`civitai-app/default/features.yaml`). A probe using `civitai-app`
  answers `namespace "civitai-app" not found`, which reads exactly like "no access" and will send
  the next session looking for credentials it already has. My own source-only analysis had this
  wrong and would have misled anyone following it.
- 🔴 **`hasFeature` RETURNS THE FLIPT ANSWER AND NEVER REACHES STATIC EVALUATION** — so a flag
  declared `availability: ['public']` is NOT a backstop; a missed segment overrides it to false.
  That is what turned an empty Flipt context into a REFUSED generation rather than a no-op.
- 🔴 **VERIFY A FLAG BOTH WAYS, AND PAIR IT WITH A CONTROL.** Definition at `origin` AND a live
  evaluation — my local `flipt-state` clone was **behind origin** when first read. And run a second
  flag whose expected answer DIFFERS on the same call shape (`wildcards` false beside
  `app-blocks-runtime-enabled` true), or a probe wired to nothing returns a confident `true`.
- 🔴 **A CI CHECK'S OWN DESCRIPTION IS NOT AUTHORITY ON WHETHER TO IGNORE IT.**
  `preview / component-tests` says *"report-only, not blocking"*. The discriminator is the
  PER-HEAD HISTORY of that status on the same PR — green on five heads, red on one — which says it
  responded to a change regardless of whether it gates. Read the sequence, not the adjective.
- 🔴 **DO NOT MOCK THE FUNCTION UNDER TEST AT A SEAM.** Leaving the real `parseSubjectUserId`
  unmocked is what caught a wrong fixture: it returns null for the literal `anon` and THROWS
  `malformed sub claim` on anything else. A mock would have encoded my own wrong guess and shipped
  a fix that threw on anon requests.

- 🔴 **`app-blocks-runtime-enabled` IS LIT IN PRODUCTION, SO THE BLOCK REST SURFACE SHIPS LIVE, NOT
  DARK.** Recorded here rather than under `State now`, because that heading is REPLACED on every
  update and this outlives one. Confirmed BOTH ways on 2026-09-23: `enabled: true` in the definition
  at `origin` (`flipt-state`, `civitai-app/default/features.yaml`) **and** a live global evaluation
  returning `true` with `DEFAULT_EVALUATION_REASON`, `segments: []`. Control on the identical call
  shape: `wildcards` returns `false`, so the probe discriminates rather than answering true for
  everything. ⚠ Round 0's characterisation — *"fail-safe off means all four routes 401"* — is right
  in effect but WRONG in mechanism: with the flag off the middleware **falls through to the legacy
  auth path** (`block-scope.middleware.ts:979`), and the 401 then comes from each route's own
  claims guard. This is what made the F4 Flipt fix matter at merge time rather than eventually.
- 🔴 **A CI CHECK'S OWN DESCRIPTION IS NOT AUTHORITY ON WHETHER TO IGNORE IT, AND THE PER-HEAD
  HISTORY IS.** `preview / component-tests` says *"report-only, not blocking"*; it was green on five
  heads of this PR and red on one, which is what made it worth chasing regardless of whether it
  gates. It resolved as a flake — but the sequence was right: decline to merge, use a push that was
  needed anyway as the re-run, and get an answer instead of a guess. **Do not merge past a red on
  the strength of an adjective in its description.**
- 🔴 **VERIFY A SQUASH BY CONTENT, NEVER BY ANCESTRY** — `git cat-file -e origin/main:<path>` per
  shipped file, plus a grep for the specific symbol the last fix added (`blockFliptUser` → 3 hits).
  `merge-base --is-ancestor` is false after every squash, forever, and reads as "not merged".
- 🔴 **RE-SYNC THE BASE CLONE AND REMOVE THE MERGED WORKTREE IN THE SAME BREATH AS THE MERGE.** The
  base clone is write-only during worktree work and silently falls behind; a merged worktree keeps
  holding its branch repo-globally. `git -C <repo> fetch origin && git merge --ff-only origin/main`,
  then `git worktree remove … --force && git worktree prune`.
- **Decision (operator, 2026-09-23):** F4 fixed by threading the token's subject into the flag
  context; the live Flipt probe was run and confirmed the divergence; F2/F6 shipped as-is with the
  decisions recorded; I merged #5068 myself once green.

- 🔴 **A MUTATION SWEEP FOUND THE ONE THING 413 GREEN TESTS COULD NOT SEE.** Against the new REST
  client, three mutants died (wrong route path, date revival returning the raw string, `viewerVoted`
  hardcoded true) and **one SURVIVED THE ENTIRE SUITE: deleting the `cursor` query parameter from
  `list()`**. The reason generalises past this repo: the board's paging tests live in
  `App.test.tsx`, which **MOCKS the client**, so they assert the board ASKS for the next page and
  never that the client SENDS the ask — and every e2e seed was smaller than one page, so the real
  client was never asked to page. **A test that mocks the seam cannot guard the seam.** Fixed by
  seeding 40 rows with the winner at index 30 (page size 25): green at HEAD, red under the mutant.
- 🔴 **"VERIFIED IN ISOLATION" AGAIN — AND THE HANDOFF'S OWN SCOPE CLAIM WAS THE CASUALTY.** The
  predicted scope ("UI rebind + e2e harness") was derived from reading the app; it missed that
  `@civitai/sdk` has no shared-storage surface at all. **Measure the TARGET's surface, not just
  the SOURCE's usage** — the question is not "what does the app use" but "what does the thing I
  am porting TO actually have".
- 🔴 **THE CHECKOUT WAS 19 COMMITS STALE AND EVERY MEASUREMENT BEFORE I NOTICED WAS WRONG** —
  11 files vs the real 22, `blocks-react@0.37` vs `0.51`, no `Modal`, no `useBlockBreakpoint`, npm
  vs pnpm. Nothing announced it; `git status` was clean because the branch was clean. **Before
  measuring an app, `git -C <repo> fetch` and `rev-list --left-right --count origin/main...HEAD`.**
  A clean tree says nothing about whether it is the CURRENT tree.
- 🔴 **TWO INSTRUMENTS FAILED THEIR OWN CONTROLS THIS SESSION, AND ONE WOULD HAVE SHIPPED A FALSE
  CLAIM.** (a) A dev-server probe read `http=200` for all five modules — and **200 for a module
  that does not exist**, because vite serves the SPA fallback; the status was no discriminator at
  all. The body is (`<!DOCTYPE html>` = unresolved). (b) A CSS grep returned 0 for
  `data-civitai-ui="button"` because that stylesheet uses **single** quotes; the positive control
  (`grep -c button` = 7) is what caught it. **Both were caught by running the control, neither by
  reading the result.**
- 🔴 **`find` DOES NOT FOLLOW pnpm's SYMLINKS — use `find -L`.** `find node_modules/@civitai/… -name '*.d.ts'`
  returned NOTHING for a package that was installed and working, because pnpm links every package
  into `.pnpm/`. It reads exactly like "the export does not exist" and sent me looking for a
  missing type that was there all along.
- 🔴 **A TEST HARDCODED THE OLD MOCK'S INTERNALS AND WOULD HAVE GONE ON PASSING.** The e2e
  moderation case targeted key `'shared_2'` — the retired mock host's minting convention. The REAL
  server mints a **ULID** (`apps-shared.router.ts:511`, *"the server GENERATES a ULID key"*), so
  the test was asserting against a fake's implementation detail, not the platform's contract.
  Seeds can now pin their own key. **When a fixture names an id, ask which system actually mints it.**
- 🔴 **PORTING FOUND THREE PACK GAPS THAT ARE NOT IN ANY LEDGER**, each handled explicitly and all
  three recorded in the app's README: (a) `@civitai/sdk` has **no analytics** and there is no REST
  route for one — six `track()` events are now a no-op shim; (b) the components pack ships a modal
  only as a **Lit custom element**, which under jsdom leaves children in the DOM **while closed**
  and exposes no `role="dialog"` — "present while closed" is a real defect for a modal holding a
  composer, so it is reimplemented; (c) its `SegmentedControl` defaults to `radiogroup` where the
  old pack rendered `tablist` — pinned to `tabs`, because **a transport port must not silently
  change what a screen-reader user hears**.
- 🔴 **CORRECTION TO THIS DOC: the published `@civitai/components-react@0.4.0` has NO `Modal` and
  NO `./elements` subpath.** This doc recorded *"`Modal`/`SegmentedControl` are reachable via its
  `./elements/*` subpath"* — true of the starters **source**, false of the version the app
  installed. `./elements` first appears in **0.5.0**; the port bumps `components` and
  `components-react` 0.4.0 → 0.5.0. **Check the PUBLISHED artifact, not the monorepo source.**
- 🔴 **AN EXISTING GUARD CAUGHT MY OWN INVENTED DESIGN TOKENS.** A destructive-button style used
  `var(--civitai-color-on-error, #fff)`; `theme.test.tsx`'s "no hex in inline styles" assertion
  went red. The theme defines **exactly one** error token, `--civitai-color-error` — there is no
  `on-error` and no `*-surface` variant. The fallback was what made the invention invisible.
  **A `var(--x, <literal>)` fallback silently converts a missing token into a shipped hardcoded colour.**
- 🔴 **A `grep -c` OF ZERO EXITS 1 AND KILLED AN `&&` CHAIN**, so a verification run reported only
  "TYPECHECK: 0" and stopped before the tests ever ran — a *passing* measurement that truncated the
  rest of the verification. Same family as this doc's existing "count the runner's own result
  lines" entry: **never chain verification steps with `&&` through a `grep -c`.**
- 🔴 **THE CAIRN ROUTING TABLE IS NOT DERIVABLE FROM THE SCOPE NAME, AND `cairn create` REFUSES
  RATHER THAN GUESSING.** A first entry for a new scope needs `~/.config/subsystem-store/routes.json`
  to name its instance, and the fleet apps already in it go BOTH ways — `civitai-app-model-benchmarking`
  and `civitai-app-sensei` → `civitai`, while `civitai-app-playable-collections` and
  `civitai-app-starters` → `personal`. **Any session porting a fleet app will hit this**, and the
  refusal arrives at the END of `/handoff` when the window is tight. Resolve the routing BEFORE the
  index write, not after — and never pick by name similarity; two sibling app repos disagree.
- **Decision (mine, UNCONFIRMED — see ranked item 1):** analytics kept as a no-op shim rather than
  deleted, so re-wiring later is one function and not six call sites; the e2e harness rebuilt as a
  **fetch-level** fake rather than a transport-level one, because after the port the board's real
  boundary IS `fetch` — a mock host would answer a conversation nobody is having and the suite
  would pass while exercising nothing.

- 🔴 **MY LOCAL GREEN RAN A DIFFERENT PNPM MAJOR THAN CI, AND THAT IS WHY IT COULD NOT SEE THE
  FAILURE.** Local `pnpm --version` is **10.28.1**; `flake.nix` pins `pnpmMajor = "11"` and the
  workflow sets `pnpm/action-setup@v4 version: 11`. `minimumReleaseAge` is a **pnpm 11** supply-chain
  policy — `pnpm config get minimumReleaseAge` under 10 answers `undefined` — so the install-policy
  tier was STRUCTURALLY INVISIBLE locally while typecheck, 414 tests and the build all passed.
  This repo has **no `.envrc`**, so nothing puts the flake's toolchain on PATH automatically and
  `pnpm` resolves to whatever the host has. The flake's own comment already states the rule —
  *"a local shell and CI cannot run different pnpm majors. Change both, or neither"* — and it was
  silently violated by simply running `pnpm`. **Run the repo's pinned toolchain (`nix develop`)
  before quoting a local green, and when a repo pins a toolchain with no `.envrc`, ASSUME you are
  not using it until you have checked the version.**
- 🔴 **A SUPPLY-CHAIN GATE CAN MAKE A CORRECT PR RED FOR A FIXED, PREDICTABLE WINDOW.** #21's only
  check failed at `pnpm install` because `@civitai/sdk@0.2.0` was ~22h old against a 24h
  `minimumReleaseAge`. **It is not a flake and not a defect: it has a known clear time** — the log
  prints both the publish timestamp and the cutoff, so the exact minute it goes green is
  computable. The trap is that it *reads* like a broken build and the obvious "fix" is to relax the
  policy. Compute the clear time from the log's own two numbers and wait.
- 🔴 **`readlink -f` SETTLED WHETHER A CONFIG EDIT WOULD EVEN BE LIVE, BEFORE ANY EDIT.**
  `~/.config/subsystem-store/routes.json` is read-only and resolves into `/nix/store` — a
  `home.file` COPY, not an `mkOutOfStoreSymlink` — so editing the devrc source does nothing until
  a `home-manager switch`. The first write attempt failed `[Errno 30] Read-only file system`,
  which names the symptom but not the remedy; `readlink -f` names the remedy.
- 🔴 **`cairn create` REFUSES AN UNREGISTERED SCOPE RATHER THAN GUESSING AN INSTANCE, AND THE
  ROUTING TABLE IS NOT DERIVABLE FROM THE NAME.** Civitai fleet apps go BOTH ways —
  `civitai-app-model-benchmarking`/`civitai-app-sensei` → `civitai`, while
  `civitai-app-playable-collections`/`civitai-app-starters` → `personal`. Any session porting a
  fleet app hits this, and it arrives at the END of `/handoff` when the window is tight. **Resolve
  the routing BEFORE the index write**, and never pick by name similarity.
- **Decision (operator, 2026-09-23):** the sort switcher becomes a `radiogroup`, reversing my
  recommendation to preserve `tablist`. The old role was wrong on its own terms — a tab promises an
  `aria-controls` panel that control has never had. The assertion was **inverted, not relaxed**,
  and additionally pins that the element does not still claim to be a tab set; mutating the adapter
  back to `mode="tabs"` turns exactly that test red with its own error.

- 🔴 **PUSHING THROUGH A SUPPLY-CHAIN GATE HAS A NARROW FORM AND A CATASTROPHIC ONE, AND THEY ARE
  ONE LINE APART.** `minimumReleaseAge: 0` turns CI green instantly and removes the protection from
  **every dependency in the tree, forever** — silently, for everyone after you. The narrow form is
  `minimumReleaseAgeExclude: ["<pkg>@<exact version>"]`: the policy still RUNS (it verified all 185
  entries in the passing run) and exactly one pinned version is exempt. 🔴 **The version pin is
  load-bearing, and MEASURABLY so** — a bare `@civitai/sdk` would exempt every future release
  including one cut by a compromised token; the control is that pinning `@civitai/sdk@0.2.1`
  instead leaves 0.2.0 still failing. **When told to bypass a control, bypass the smallest thing
  that unblocks the work, prove the bypass is that small, and write its expiry into the file.**
- 🔴 **"CI WENT GREEN" IS NOT "MY FIX WORKED" WHEN THE FAILURE HAD A CLOCK IN IT.** This failure
  self-clears at a known time, so a passing run AFTER that time cannot distinguish the fix from
  elapsed time — and the obvious fix would have been credited for free. The discriminator is
  timestamps, and it has to be read on purpose: the passing run started **2026-09-24T02:01:35Z**,
  **1h48m BEFORE** the 03:49:30Z window closed. **Whenever a red has an expiry, record both the
  expiry and the passing run's start time, or the attribution is unproven.**
- 🔴 **`pnpm --version` LIED THREE DIFFERENT WAYS BEFORE I GOT THE REAL ONE.** Corepack's shim sits
  ahead of everything on PATH: bare `pnpm` said 10.28.1; `nix-shell -p pnpm_11 --run 'pnpm --version'`
  ALSO said 10.28.1; and even `node <store>/libexec/pnpm/bin/pnpm.cjs --version` said 10.28.1. Only
  `node <store>/libexec/pnpm/bin/pnpm.mjs` reported 11.27.0. **A toolchain version read through a
  shim is a fact about the shim** — when a repo pins a major, verify you are running it before
  quoting any result that depends on it.
- 🔴 **THE SETTING NAME CAME FROM THE TOOL'S OWN BINARY, NOT FROM MEMORY.** Grepping pnpm 11's dist
  for `minimumReleaseAge[A-Za-z]*` returned the real family — `minimumReleaseAgeExclude`,
  `…ExcludePrune`, `…IgnoreMissingTime`, `…Strict` — and reading `parseVersionPolicyRule` gave the
  exact grammar (scoped names handled, EXACT versions only, `||` unions, name patterns refused with
  a version union). A guessed key would have been accepted silently and changed nothing, leaving a
  red CI and a config file that *looks* like it should work. **A wrong config key fails in the
  quiet direction; read the parser.**
- **Decision (operator, 2026-09-23):** push through the 24h `minimumReleaseAge` rather than wait
  ~2h for it to close. The package is first-party (`@civitai/sdk@0.2.0`, published by hand from
  this org's own monorepo because npm OIDC cannot create a package that does not yet exist), so the
  third-party-compromise threat the window guards against does not apply to it. Implemented as an
  exact-version exemption with its own removal condition, never as a disabled policy.

- 🔴 **RETRACTION: "this repo has no `.envrc`" WAS WRONG, AND A STALE CHECKOUT MANUFACTURED THE
  EVIDENCE.** I `ls`'d the base clone, got "No such file", and wrote the conclusion into this
  doc — but the clone was **19 commits behind** and `.envrc` had been added in `9366021`. The file
  is tracked and always shipped. **The real mechanism is that `direnv` authorization is PER PATH
  and the path was `allowed 0`**, so a present, correct `.envrc` sat inert and the host's pnpm 10
  won silently. The tell is in `direnv status`: `Found RC path …` together with `Loaded RC
  allowed 0` — *found* and *allowed* are different fields and only the second one matters.
  Generalises: **a file's PRESENCE is not its ACTIVATION**, and an absence measured on a stale
  tree is not an absence.
- 🔴 **A RED CI CHECK ON A ONE-LINE JSON CHANGE WAS INHERITED FROM THE BRANCH POINT, AND THE
  CONTROL TOOK ONE COMMAND.** devrc #1862 added a single routes entry and
  `tekton/devrc-pytests` failed `test_no_unallowlisted_public_ip_literal_is_committed` (2 of
  24,076). The discriminator is **run the failing test at the branch point vs at current main**:
  it FAILS at `a6e98a3d` (my base) and PASSES on `5273d71b` (current main), so it was fixed
  upstream while my branch sat 3 commits behind. Rebase, don't investigate. 🔴 Note the local
  control is only valid if you run it in a tree that HAS the change — my first attempt ran against
  local `main`, which did not, and proved nothing about my branch.
- 🔴 **`direnv exec <dir> <cmd>` LETS THE OUTER SHELL RESOLVE `<cmd>` FIRST.** `direnv exec $R pnpm
  --version` printed **10.28.1** — the corepack shim — while
  `direnv exec $R bash -c 'pnpm --version'` printed **11.25.0** from the flake. The first form
  reads as "direnv is not working" and is really "you measured the wrong pnpm". Wrap the command in
  a shell when you need the environment to apply to resolution as well as to execution.
- 🔴 **THE FIVE OPERATOR DECISIONS OF THIS ARC, MOVED HERE SO A STATUS REPLACE CANNOT EAT THEM.**
  They lived under `State now`, which is overwritten on every update, and the write gate flagged
  them as a durable drop. Taken 2026-09-23/24, each with its alternative explicitly on the table:
  (1) **analytics** — keep a no-op shim with all six `track()` call sites intact, rather than
  deleting them or blocking the port on a new SDK surface; (2) **test harness** — a fetch-level
  fake, because after the port the board's real boundary IS `fetch` and a mock host would answer a
  conversation nobody is having; (3) **cairn route** — `civitai`, chosen by an operator because the
  table is genuinely split for sibling fleet apps; (4) **sort-control a11y** — switch to
  `radiogroup` NOW, which **reversed my recommendation** to preserve `tablist`; (5) **the 24h
  supply-chain gate** — push through it rather than wait ~2h, implemented as an exact-version
  exemption and never as a disabled policy.
- **Decision (operator, 2026-09-24):** PR #21 merged by squash, matching this repo's convention
  (every mainline commit carries `(#N)`; the repo has no merge commits). The squash body preserves
  the three-part structure — transport port, a11y change, supply-chain exemption — because the
  commits were deliberately separated and the reasoning for each is worth keeping.

- 🔴 **FILE COUNT IS THE WRONG METRIC FOR PORTING COST — COUNT THE PLATFORM SURFACE.** I ranked
  `gen-matrix` next-cheapest at 10 files; it imports **14 platform hooks** to `app-requests`'s six
  and carries two hard blockers, while `generate-from-model` at **23** files is the genuinely
  cheapest because it is the only one using **zero** `useAppStorage`. The file count measures how
  much TEXT changes; the hook set measures how many PLATFORM CAPABILITIES must exist first — and
  only the second can be blocked on a PR in another repo. **Rank ports by surface, not by diff.**
- 🔴 **TWO DIRECTORIES CAN BE ONE REPO ON DIFFERENT BRANCHES, AND THE FLEET NUMBERS LIE IF YOU
  MISS IT.** `civitai-app-gen-matrix` and `civitai-block-gen-matrix` both have origin
  `ZacxDev/civitai-app-gen-matrix`; the first is `main` (10 importers), the second a stale
  `feat/production-hardening` (5). I quoted the 5 as a positive control. It was still a valid
  control — non-zero is all a control needs — but it is NOT that app's state. **`git -C <dir>
  remote get-url origin` before treating two directories as two apps**, and measure against
  `origin/main`, not whatever branch a checkout was left on.
- 🔴 **A ZERO FROM A NAME LIST YOU INVENTED IS A FACT ABOUT THE LIST.** I grepped gen-matrix for
  `submitWorkflow|SUBMIT_WORKFLOW|estimateWorkflow|pollWorkflow`, got nothing, and concluded "it
  does not generate". It uses `useAppWorkflows`/`useBuzzWorkflow`/`useBuzzPurchase` — none of which
  I had imagined. The fix that caught it was reading the actual import block instead of testing a
  hypothesis about it. **When a grep for a CAPABILITY returns zero, enumerate what the file
  imports before believing the capability is absent.**
- 🔴 **`useAppStorage` IS A FLEET-WIDE PLATFORM GAP, NOT A PER-APP PROBLEM.** There is no REST twin
  for the per-viewer KV (0 routes; control 12 for shared-storage) and five of the six remaining
  apps use it — 24 files in `sensei` alone. `app-requests` escaped only because the server already
  returns `viewerVoted`, which made its local voted-set redundant and deletable. **That was luck,
  not a pattern**, and assuming the next app can do the same is the mistake this note exists to
  prevent. It is ranked item 2 precisely because it may require a platform PR before most of the
  fleet can move at all.
- **Decision (operator, 2026-09-24):** next session runs Track A and Track B **in parallel**. They
  share no files and no repo: A is network + `curl` against civitai.com, B is local reading across
  fleet checkouts. Claim ranks 1 and 2 separately.

## How to verify

```bash
# 1. THE ARC — closed on main, with both controls (this should not regress)
R=/home/zach/workspace/civit/civitai-app-requests
git -C $R fetch origin --quiet
git -C $R grep -l "@civitai/blocks-react" origin/main -- '*.ts' '*.tsx' | wc -l   # => 0
git -C $R grep -l "@civitai/sdk"          origin/main -- '*.ts' '*.tsx' | wc -l   # => 13  (control)
P=/home/zach/workspace/civit/civitai-app-gen-matrix
git -C $P grep -l "@civitai/blocks-react" origin/main -- '*.ts' '*.tsx' | wc -l   # => 10  (control: an UNPORTED app)

# 2. the merge landed by CONTENT, never ancestry (a squash is never an ancestor)
gh pr view 21 --repo ZacxDev/civitai-app-requests --json state,mergeCommit \
  --jq '"\(.state) \(.mergeCommit.oid)"'        # => MERGED 52b7e1b1…
git -C $R show origin/main:src/platform/ui.tsx | grep -c radiogroup     # => 2

# 3. the local toolchain is the PINNED one (this is what CI runs)
direnv exec $R bash -c 'pnpm --version'          # => 11.25.0, NOT the host's 10.28.1
#    🔴 `direnv exec $R pnpm --version` answers 10.28.1 — the outer shell resolves `pnpm`
#    first. Wrap it in a shell or you measure the corepack shim.

# 4. STILL UNMET — the real-platform probe. See "TRACK A" for the exact commands.
```
