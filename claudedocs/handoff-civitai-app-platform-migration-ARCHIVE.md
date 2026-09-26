# Archive — civitai-app-platform-migration

RESOLVED investigation blocks EVICTED from
`claudedocs/handoff-civitai-app-platform-migration.md` so that document could stay
under its size ratchet. **Nothing here was deleted — this is the full text, moved.**

🔴 Every block below is CLOSED. Read it for the evidence and the eliminations behind a
decision already taken — never as live state. The live document is the handoff; if a
block here contradicts it, the handoff wins and this file is the older reading.

## Evicted 2026-09-26

### RESOLVED (host-side proxy, `civitai#5068`) — no REST spend surface for a block token
- as-of: 2026-09-23
- **What it was:** adopting `@civitai/sdk` removed the transport an app's generation
  runs on. `HostRequests` carried no `SUBMIT_WORKFLOW`/`ESTIMATE`/`POLL`/`CANCEL`,
  and the orchestrator authenticates with a **server-minted temporary user API key**
  (`get-orchestrator-token.ts:106-112`) that never leaves the server. Of 22
  `requiredScope` sites repo-wide, **zero** were `ai:write:budgeted`.
- **Ruled out:** *"the orchestrator just needs a `withBlockScope` wrapper"* — FALSE,
  and it was my own framing. `withBlockScope` is Next.js middleware on civitai.com's
  routes; the orchestrator is a separate service never taught the block JWT's key
  material or audience. `via: code`
- **Resolved by** a host-side REST proxy (`#5068`), which touches neither the
  `appblk-*` OAuth bar nor the orchestrator. Merged; the surface ships live, not
  dark (see the Flipt block).

### RESOLVED — a block CAN get an OAuth token; the bar was deliberate and is still there for interactive flows
- as-of: 2026-09-23
- **The bar is deliberate security, not an oversight.**
  `apps/auth/src/lib/server/oauth/block-guard.ts:8-12`: app-block clients *"must
  NEVER drive the interactive authorization_code / device flows … an app-block owner
  could otherwise phish a user through the consent screen → account takeover."*
  Four gates; the load-bearing one is `grants: []` written into the client row at
  approve time (`publish-request.service.ts:2388-2409`), with a retry path that
  converges hand-edits back. `via: code`
- **Ruled out:** *"use client-credentials"* — FALSE. `getUserFromClient` returns the
  **app developer**, so it would spend the developer's Buzz — the tenant model
  `AGENTS.md` warns against. No on-behalf-of/RFC 8693 flow exists (verified with a
  positive control). `via: code`
- **Resolved a different way:** the host mints the OAuth token for a manifest that
  opts in, without the block ever driving an interactive flow — measured working by
  `oauth-probe` (below). The open product question that remains is **whether a block
  must act without an open host page**: the block JWT lives ~15 min and is refreshed
  by the host page's session, and the block holds no refresh credential.
### RESOLVED — `app-requests` anon-read 403, and the UI rebind
- as-of: 2026-09-23
- **What it was:** the binding loop walked every scope on the token, so an anon
  `shared:read` 403'd at `block-scope.middleware.ts:821-831` with *"requires
  authenticated subject"* — on a READ route. A behaviour change on port, not a
  pre-existing bug: the bridge gates anon **per operation**
  (`apps-shared.router.ts:246-251`).
- **Resolved by:** `civitai#5067`, on `origin/main` as `3a1e090924`. The unit case
  *"an ANON token carrying shared:read AND shared:write can READ shared storage"*
  passes at HEAD and **fails 403 at `0cd25bb226e5`**, so the arm discriminates.
- 🔴 **Still unprobed LIVE, and now unprobeable:** app blocks are moderator-only
  (see that block below), so no anonymous viewer can reach the route at all. This
  fix rests on unit evidence only.
### RESOLVED (F4) — the REST transport evaluated Flipt as an EMPTY context and refused real users
- as-of: 2026-09-23
- **Confirmed, then fixed** by threading the token's subject into the flag context;
  the live Flipt probe was run and confirmed the divergence.
- 🔴 **`app-blocks-runtime-enabled` IS LIT IN PRODUCTION, so the block REST surface
  ships LIVE, not dark.** Confirmed BOTH ways 2026-09-23: `enabled: true` in the
  definition at `origin` (`flipt-state`, `civitai-app/default/features.yaml`) **and**
  a live global evaluation returning `true` with `DEFAULT_EVALUATION_REASON`,
  `segments: []`. Control on the identical call shape: `wildcards` returns `false`,
  so the probe discriminates rather than answering true for everything.
- ⚠ **Round 0's mechanism was WRONG while right in effect:** *"fail-safe off means all
  four routes 401"* — with the flag off the middleware **falls through to the legacy
  auth path** (`block-scope.middleware.ts:979`) and the 401 comes from each route's
  own claims guard. That is what made this fix matter at merge time rather than
  eventually.
- 🔴 **An unmocked dependency caught a wrong fixture:** it returns null for the
  literal `anon` and THROWS `malformed sub claim` on anything else. A mock would have
  encoded my own wrong guess and shipped a fix that threw on anon requests.
### RESOLVED (flake) — `preview / component-tests` red on the F4 commit
- as-of: 2026-09-23
- **Resolved as a flake**, but the sequence was right: green on five heads of this PR
  and red on one, so it was worth chasing regardless of whether it gates. Declining to
  merge, then using a push that was needed anyway as the re-run, got an answer instead
  of a guess. The durable rule is in `## Gotchas` (*a check's own description is not
  authority on whether to ignore it — the per-head history is*); see also the
  still-open block on this same check being red across every PR in `civitai/civitai`.

### RESOLVED (`203328a`) — PR #21's red was a supply-chain TIME gate, not the code
- as-of: 2026-09-24
- **What it was:** `pnpm install` failed because `@civitai/sdk@0.2.0` was ~22h old
  against a 24h `minimumReleaseAge` (a **pnpm 11** policy; pnpm 10 has none, which
  is why it was invisible locally). **Not a flake and not a defect — it has a known
  clear time**, computable from the log's own publish timestamp and cutoff.
- **Resolved by** an exact-version `minimumReleaseAgeExclude`, never a disabled
  policy: the policy still RAN (verified all 185 entries) with exactly one pinned
  version exempt. The pin is load-bearing and measurably so — pinning `0.2.1`
  instead leaves `0.2.0` still failing.
- 🔴 **"CI went green" was NOT "my fix worked", because the failure had a clock in
  it.** The discriminator is timestamps read on purpose: the passing run started
  `2026-09-24T02:01:35Z`, **1h48m BEFORE** the 03:49:30Z window closed.

### RESOLVED — the pnpm-major split was an UNAUTHORISED `.envrc`, not a missing one
- as-of: 2026-09-24
- 🔴 **RETRACTION, and a stale checkout manufactured the evidence.** I `ls`'d the
  base clone, got "No such file", and wrote *"this repo has no `.envrc`"* into this
  doc — but the clone was **19 commits behind** and `.envrc` had been added in
  `9366021`. The file is tracked and always shipped.
- **The real mechanism:** `direnv` authorization is **PER PATH** and the path was
  `allowed 0`, so a present, correct `.envrc` sat inert and the host's pnpm 10 won
  silently. The tell is in `direnv status`: `Found RC path …` together with
  `Loaded RC allowed 0` — *found* and *allowed* are different fields and only the
  second one matters. **A file's PRESENCE is not its ACTIVATION, and an absence
  measured on a stale tree is not an absence.**

### RESOLVED — no platform PR needed: `dev-tunnel` on an APPROVED app takes the PROD page mint
- as-of: 2026-09-24
- **`dev-tunnel` against an already-APPROVED app takes the PRODUCTION page mint**,
  which grants the shared scopes — so the shared-storage surface was reachable
  without the platform PR Track B had predicted. This is what made the two live
  probes below possible.
### ✅ RESOLVED — the ported app read AND wrote the REAL platform
- as-of: 2026-09-24
- **Read path:** `shared-storage/list` → **200**. **Write paths:** every one
  round-trips, and `items[].viewerVoted` is real rather than reconstructed
  client-side. The port is exercised against the real platform, not a mock.
- 🔴 **A mutation sweep found the one thing 413 green tests could not see.** Three
  mutants died; **one SURVIVED the entire suite: deleting the `cursor` query
  parameter from `list()`**. The board's paging tests live in `App.test.tsx`, which
  **MOCKS the client** — so they assert the board ASKS for the next page and never
  that the client SENDS the ask, and every e2e seed was smaller than one page.
  **A test that mocks the seam cannot guard the seam.** Fixed by seeding 40 rows
  with the winner at index 30 (page size 25): green at HEAD, red under the mutant.
- 🔴 **A test hardcoded the retired mock's internals and would have gone on
  passing** — it targeted key `'shared_2'`, while the REAL server mints a **ULID**
  (`apps-shared.router.ts:511`). **When a fixture names an id, ask which system
  actually mints it.**

### RESOLVED — the first OAuth opt-in is `oauth-probe`, and NO fleet app could have been
- as-of: 2026-09-25
- 🔴 **The deciding constraint was absent from this doc until then.**
  `manifestCanMintOauthToken` (`block-oauth-scope.ts:64-71`) returns **false** for an
  `auth: "oauth"` manifest that does not declare `user:read:self`, so such an app
  silently never enters the OAuth branch and is handed a block JWT instead. The
  minted token unavoidably carries `TokenScope.UserRead`, the consent mirror will
  not claim a bit the viewer never granted, and the hub then refuses *forever* — a
  non-terminating re-consent loop. **`user:read:self` is MANDATORY**, which makes
  "needs a consent-gated scope" automatic rather than a filter.
- 🔴 **Ruled out — *"`models:read:self` / `collections:write:self` are
  consent-gated"* — FALSE, and it was this doc's own claim.** Both sit in
  `CONSENT_EXEMPT_SCOPES` (`scope-grant.service.ts:423`, `:428`). The real gated set
  is registry-minus-exempt: `user:read:self`, `ai:write:budgeted`, `buzz:read:self`,
  `social:tip:self`, `collections:read:private`, `posts:write:self`. `via: code`
- **The fleet intersection is EMPTY** — all 7 manifests read on their own
  `origin/main` (`sensei` on `origin/trunk`), all confirming the `auth`-absent
  claim. Only `generate-from-model` clears the `apps:storage:*` hard refusal at
  submit (`block-manifest-validator.service.ts:557-571`), and it declares neither
  `user:read:self` nor the rest. **No fleet app could be the first opt-in without a
  manifest change** — hence a scratch app. `via: measurement`
- **The reachable surface is narrower than the arc assumed:** `/api/v1/me` is the
  ONE capability an OAuth token unlocks today — `hasFlag(…UserRead|BuzzRead)` is
  checked in exactly **one** non-test file, and 11 of 38 `/api/v1/blocks/*` route
  files call `bearer(req)` and 401 an opaque token. `via: measurement`
### ✅ RESOLVED — the OAuth opt-in WORKS, measured in a real page slot
- as-of: 2026-09-25
- 🔴 **First live evidence in the entire arc for the OAuth path.** `oauth-probe@0.1.3`
  at `civitai.com/apps/run/oauth-probe` as `zachlowdenzx`, driven through consent,
  read from the app's own `data-testid`s inside its OOPIF. Before → after **Allow**:

  | reading | ungranted | granted |
  |---|---|---|
  | `token kind` | `block` | **`oauth`** |
  | `granted` | none | `user:read:self, buzz:read:self` |
  | `tokenScope` | — (401) | **65537** = `UserRead(1) \| BuzzRead(65536)` |
  | `/api/v1/me` fields | refused | **`email, emailVerified, isModerator`** |

  `#5128`'s host notice rendered, `#5129`'s consent-required fallback behaved as
  designed, and the grant rotated the SAME session to `oauth`. **No screen was
  taken** — `browser activate` was never called. `via: measurement`
- **Ruled out:** *"a `block` token under an `auth: "oauth"` manifest means the opt-in
  failed"* — **FALSE, and the probe itself reported it that way on first load.** A
  block token has TWO causes: the consent-required fallback (designed) and a
  genuinely ignored opt-in. The discriminator is whether anything is still withheld.
  Fixed in the app at `0.1.3`. `via: measurement`
- ⚠ **Says NOTHING about the ANON path**, which remains unprobeable — app blocks are
  moderator-only. 🔴 **Two app-level corrections are pinned by tests watched red but
  were NOT re-observed live**, because the viewer is now granted and `civitai#5120`
  (viewer-facing withdrawal) is still OPEN: the corrected *"Waiting on your consent"*
  copy, and the `/me` re-read on token rotation.
- **Four platform gates refused a submit before this worked, each real and each found
  only by submitting:** `minimumReleaseAge`, `ERR_PNPM_IGNORED_BUILDS`, the
  `boot-skeleton-gate`, and one transient Docker Hub pull timeout cleared by a
  same-version `--allow-downgrade` re-submit. 🔴 **`civitai app validate` passed all
  four** — `civitai/cli#706`.
<!-- REPLACES the former block "`devrc#1876` is held because its gates NEVER RAN — not because
     they failed", DELETED in the 2026-09-26 prune rather than left behind to be read. Its
     "Next probe" had become actively wrong: it said still-starved-after-a-few-hours ⇒ open a
     `tekton` capacity item. Capacity DID return (02:01Z) and the gate then went red on the
     PR's OWN code, so there is no tekton capacity item to open. This block is the live state. -->
### RESOLVED (`617b8c95`) — `devrc#1876`'s red was its own +27 chars, not Tekton capacity
- as-of: 2026-09-26
- **Symptom:** at head `fa0cbd8`, three gates green and `tekton/devrc-pytests`
  **failure**: `collected=24185 passed=24177 skipped=5 failed=3`.
- **The discriminator was the per-head status timeline**
  (`gh api repos/.../commits/<sha>/statuses`): `00:00:42Z` `error` *"NO CAPACITY —
  the gate never started"*; `02:01:22Z` `pending`; **`02:19:37Z` `failure`**. Capacity
  returned, and the gate then produced a REAL red. Cause: the PR's own +27-char
  `description:` edit to `civitai-app-fleet`, which reds THREE tests — the pinned
  measurements in `test_skill_tiers.py` (1) plus the listing-total ratchet and its
  own can-go-red control in `test_skill_descriptions.py` (2). 1 + 2 = CI's
  `failed=3`. The tier-A ceiling was never breached (80 headroom); the ratchet on the
  **SUM** was, by exactly 27 (10,859 vs 10,832). `via: measurement`
- **Ruled out:** *"inherited from the branch point, like `devrc#1862` — rebase, don't
  investigate"* — **FALSE.** `#1876` IS 3 behind `origin/main`, which is what makes
  the hypothesis attractive, but both failing test files are **byte-identical**
  across the two trees, so the base cannot be the cause. **Check the FILE, not the
  distance.** `via: command`
- **Fixed** per the ratchet gate's own eviction playbook step 1, not by raising a
  ceiling (its step 4 names raising as the thing the constant exists to prevent):
  the clause *"rolling one change through every app repo"* came out of the same
  description, since it restates the opening and the skill BODY already says it.
  Net **−18** chars vs pre-PR; measurements re-pinned 7,510→7,491 / 7,695→7,676 /
  11,011→10,992; headroom 107→**126**.
- **Verified:** red arm reproduced all three; green arm
  `nix build .#checks.x86_64-linux.pytests` → `collected=24185 passed=24180
  skipped=5 failed=0` (same collected and skipped as CI's red, passed +3). Mutating
  `MEASURED_TIER_A_CHARS` to `1_234` in isolation reds exactly the pinned-measurement
  test with its own assertion and prints `7_491`.
- ✅ **MERGED `47a76ed3` 2026-09-26T03:49:05Z, and CI confirmed the fix exactly.** All
  four gates passed, `devrc-pytests` reporting `collected=24185 passed=24180
  skipped=5 failed=0` — the same numbers the local gate predicted. Verified on
  `origin/main` by CONTENT, not ancestry: the three pins read 7_491 / 7_676 / 10_992
  and the trimmed clause greps **0**. Claim released; worktree removed; base clone
  re-synced.
- **Next probe:** none. 🔴 **The durable lesson is the timeline read**: a gate
  reporting `NO CAPACITY — the gate never started` is a DISTINCT status from a
  failure and it CLEARS on its own, so a PR held on one must be RE-CHECKED rather
  than assumed still starved. That string is documented in no skill; the `tekton`
  skill owns these gates and is where it belongs.
