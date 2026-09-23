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

**Nothing has been ported. Every route needed for the two cheapest ports now exists, and both
apps are still blocked** — for reasons found at the end of the session, not at the start.

- Repos: `civitai-app-starters` @ `8b3fce3` (main, clean) · `civitai` @ `2fd658d77` (main, clean).
- **No `clawgate-task:` field**, deliberately. `clawgate_handoff.sh resolve` exited **5**. A wrong
  session id also answers 200 with an empty array, so that zero is not a clean bill of health.

### Merged this session

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
| civitai | `2fd658d77` | #5070 fixed a live `main` breakage (below) |

**Published:** app-sdk 0.50.0 · blocks-react 0.57.1 · components + components-react 0.5.0 ·
theme 0.4.0 · **`@civitai/sdk` 0.2.0** (first publish — verified by three claims with controls).

### IN FLIGHT

- **civitai/civitai#5067** — narrows `enforceContextBinding` to the route's `requiredScope`.
  Green except one pending check; an unrelated `moderation.instrumentation` timing test flaked
  once and cleared on re-run. **Merging this is what makes the ten shipped routes usable.**
  Worktree: `/home/zach/workspace/civit/civitai-scope-binding`.
- **civitai/civitai#5068** — `/api/v1/blocks/workflows` REST proxy (submit/estimate/poll/cancel).
  Red **only** on the `ctx.domain` break it inherited; `#5070` fixed that on `main`, so it needs a
  sync then a re-run. Round 0 brief already generated at
  `<scratchpad>/brief-5068-r0.md`. Worktree: `/home/zach/workspace/civit/civitai-workflows-rest`.

### Not verified anywhere

**No live probe with a real block JWT against a running server**, except one narrow check: on
`pr-5054.civitaic.com` the three shared-storage read routes returned **401 with no token**,
identical to the pre-existing `top` route, while a bogus sibling path returned 302. That proves
the routes are wired and the auth gate fires. It is **not** a happy-path probe.

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

## Next steps (ranked)

1. **Merge civitai/civitai#5067.** One check pending; the one red was an unrelated
   `moderation.instrumentation` timing flake that cleared on re-run. This unblocks anon reads and
   removes the `?id=` workaround from all ten block REST routes.
   forcing: gate — everything shipped this session is partly inert until it lands.
2. **Sync civitai/civitai#5068 onto `main`, re-run CI, then `/audit-pr 5068` Round 0.** It was red
   only on the `ctx.domain` break that `2fd658d77` fixed. Brief pre-generated at
   `<scratchpad>/brief-5068-r0.md`.
   forcing: gate — it is the only thing that unblocks generation apps, i.e. most of the fleet.
3. **Batch: filed but not advanced.** civitai#5059 (audit labels duplicate
   `humaniseScopeInvocation`), civitai#5060 (`bearer()` open-coded in 11 routes), civitai#5063
   (the binding loop — #5067 fixes it, close on merge), civitai#5064 (workflows proxy — #5068),
   starters #425–#432, #422, #423.
   forcing: none

## Defects (batched)

- **civitai `main` was broken for ~1h** — `model-file.controller.ts` referenced `ctx.domain` in a
  sessionless function, so **every `'Training Data'` upload failed at runtime**, not just
  typecheck. Fixed in `2fd658d77`. Cause: #5058 wrote the stamp into a handler that *had* `ctx`;
  a separate commit extracted that body into a sessionless function. Textually clean merge,
  semantically wrong — a disjoint-region semantic conflict.
- **The HF-import path can still write an unstamped `'Training Data'` row** (both callers pass
  `uploadDomain: null`). Moderator/webhook-gated, so not the laundering vector #5058 targeted, but
  noted on #5070 rather than papered over.
- **`me.ts` declares a `requiredScope` but no `allowOpaqueOrigin`**, so an unverified block's
  direct fetch of the viewer self-read 405s on preflight. Recorded as a pin in the CORS test.
- **The new shared-storage routes return `{ message }`; the two older siblings return `{ error }`.**
  Deliberate (the older arm forwards raw `pg` text that can name the app's schema), but a client
  written against `top`/`increment` sees a different key.
- `pnpm lint` exits 1 repo-wide in starters (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`). Pre-existing.
- `civitai-block-generate-from-model` **has no linter at all** — no config, no dependency, no
  script; its 11 `eslint-disable-next-line` comments disable something that is not installed.

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

## How to verify

```bash
# 1. main is unbroken (the live breakage this session fixed)
cd /home/zach/workspace/civit/civitai && git fetch origin --quiet
git show origin/main:src/server/controllers/model-file.controller.ts | grep -n "uploadDomain: ColorDomain"
#    => a required param on createModelFile; the sessionless path no longer references bare ctx

# 2. the ten block REST routes exist
git ls-tree --name-only -r origin/main src/pages/api/v1/blocks/ | grep -E "buzz|shared-storage" | wc -l
#    => 10  (buzz + 9 shared-storage)

# 3. the closing condition — NO app meets it yet
F=/tmp/.../scratchpad/fleet/civitai-app-requests   # re-clone if the scratchpad is gone
find "$F" \( -name '*.ts' -o -name '*.tsx' \) | grep -v node_modules | xargs grep -l "@civitai/blocks-react" | wc -l
#    => non-zero today. 0 = that app has ported.
#    POSITIVE CONTROL, same breath: the same grep for "@civitai/sdk" must be non-zero after a
#    port, or the zero above just means the files moved.

# 4. @civitai/sdk really is published
npm view @civitai/sdk version --prefer-online     # => 0.2.0
npm view @civitai/blocks-react version            # => 0.57.1  (control: the probe can see npm)
```
