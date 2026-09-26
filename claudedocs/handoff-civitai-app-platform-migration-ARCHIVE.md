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

## Evicted 2026-09-26 — gotchas belonging to the `browser` and `civitai-app-fleet` SKILLS

These are tool-specific traps, not facts about this migration. They are here VERBATIM;
their proper home is the owning skill, and moving them there is still outstanding.

- 🔴 **`js --frame` ON A CROSS-ORIGIN OOPIF RUNS IN THE MAIN WORLD, NOT AN ISOLATED ONE.** `cdpFrameEval` forks: same-process → `Page.createIsolatedWorld`; OOPIF → `Runtime.evaluate` with **no `contextId`** = the page's own world. `reference/frames-cdp.md` already said so; `flows/civitai.com.md` carried the blanket claim. The OBSERVATION (a `window.fetch` hook catches nothing) is real; the MECHANISM was wrong — the cause is ordering, and an empty intercept list is **undiagnosed**, not proof.
- 🔴 **`wake --wait 12000` IS SILENTLY CLAMPED TO 6000** (`WAKE_SETTLE_MAX_MS`, a bare `Math.min`, no warning). The App Block recipe prescribed double the cap, so a working recipe was right about the outcome and wrong about the cause — the settle was 6 s.
- 🔴 **A HIT-TEST THAT PASSES AND A CLICK THAT DOES NOTHING = a RE-THROTTLED TAB (or a `disabled` control).** Cost a cycle on the consent dialog: `elementFromPoint` returned the button's own span and the click was inert; `wake` then re-click worked immediately. `flows/civitai.com.md` carries **no** re-throttle warning at all (it lives in `SKILL.md`/`spa-wake.md`), and its App Block recipe says `wake … once`. The rival cause is real too — `BlockConsentModal`'s Allow is `disabled` until the Buzz-budget field validates.
- 🔴 **`div[role="status"]` IS NOT UNIQUE ON `/apps/run/<slug>`** — the host loading veil, `BlockFallback` and the consent notice all use it. It worked only because the veil had already gone; anchoring on it is a race.
- 🔴 **`flows/civit.ai.md` EXISTS, IS ROUTED, AND IS DEEPER than `civitai.com.md`'s App Block section** — but the bridge routes you there only AFTER your first `--frame` op, by which point every decision that section governs is already made.
- 🔴 **A PROPOSED GUARD THAT WOULD HAVE CAUGHT NOTHING — MEASURED, AND DECLINED.** Pinning every backticked identifier in `flows/*.md` to the bridge source was justified as catching "three of four" contradicted items. Measured: **1 identifier matched, 15 did not**, and the catch rate against the actual contradicted items was **ZERO** (one was a wrong CASE not a wrong string, one camelCase in another repo, one a number, one an English phrase). It would have needed an allowlist larger than its signal.
- 🔴 **THE `git archive` / WORKTREE SUBMIT RULE IS OBSOLETE AND NOW COSTS TWO GUARDS.** CLI 0.1.105 drops a `.git` **FILE** as well as a directory (packaged a real worktree: `Skipped … .git`). Following the stale 🔴 loses the dirty-tree refusal AND the `SOURCE` provenance stamp — visible in `civitai app status`: `custom-generators SOURCE=-` (archive export) vs `oauth-probe SOURCE=04e9c8e`.
- 🔴 **`gpu-fleet-infra` IS A FALSE CORROBORATOR.** It carries its own `app-blocks-pipeline.yaml`, still in its kustomization, still on `1.27-alpine` with the retired `npm ci || npm install` — so a second, independent-looking source **confirms the skill's stale text**. talos-infra wins, proven by the live `app-blocks-build-recipe` ConfigMap matching it line-for-line and by today's PipelineRuns being on dp-1.
- 🔴 **`onlyBuiltDependencies` WAS RETIRED IN pnpm 11 AND IS SILENTLY IGNORED; the live key is `allowBuilds` (a map).** pnpm's own CHANGELOG says so — *"silently ignored since, so a workspace migrated from pnpm 10 kept them around LOOKING ACTIVE"*. 🔴 **Grepping pnpm 12's native binary returns the retired key too**, so binary presence is NOT evidence a key is live; the CHANGELOG was the discriminator. Cost one CI round.
- 🔴 **THE PLATFORM INSTALLS WITH `--ignore-scripts`, SO `ERR_PNPM_IGNORED_BUILDS` IS A CI GATE, NOT A PLATFORM ONE.** `app-blocks-pipeline.yaml:1429` — `corepack enable; pnpm install --frozen-lockfile --ignore-scripts`. My claim that `allowBuilds` was "confirmed against the real platform build" is **WRONG**; it fixed GitHub Actions CI, which passes no such flag. No build can discriminate, because `allowBuilds` and `minimumReleaseAgeExclude` landed in the same commit. The wrong attribution is still in `civitai-app-oauth-probe`'s commit message.

## Evicted 2026-09-26 — closed-arc gotchas and ladder bookkeeping

VERBATIM, not deleted. Each is either superseded by a later entry, duplicated by an
investigation block already in this archive, or bookkeeping about the audit ladder
rather than about this migration.

- 🔴 **RELOCATED OUT OF PRUNED `RESOLVED` BLOCKS — these three were measured, are still live, and were inside blocks an audit classified as evictable.** Their evidence is in git history (the prune commit's parent); what survives here is the rule.
  - **`direnv allow` is PER-PATH, so every new worktree starts BLOCKED and silently gives the wrong toolchain.** `civitai-app-custom-generators`' `flake.nix` pins `pnpmMajor = "11"` while the ambient pnpm is 10.28.1, and pnpm 11 is what enforces `minimumReleaseAge`. 🔴 **Confirmed again 2026-09-25, and the failure has a SECOND shape the original note lacked:** the dev shell's own banner prints the **invoking** shell's version (`custom-generators: node v24.19.0, pnpm 10.28.1`) while `nix develop <wt> --command` inside it gives **11.25.0** — and `direnv exec <wt>` did **not** pick the flake up either. So `pnpm --version` inside the shell is the only reading that counts, and a banner is not it.
  - **A check's own description is not authority on whether to ignore it.** `preview / component-tests` self-described as *"report-only, not blocking"* and was merged past four times; the discriminator that settled flake-vs-real was the **per-head history of that status on the same PR**, not its adjective. Do not merge past a red on the strength of how it labels itself.
  - **A closing instruction inside a RESOLVED block is still an open action.** The `minimumReleaseAgeExclude` cleanup sat in a block marked resolved and was never executed; it is now in `## Defects (batched)` where the list drains. When a block resolves, move its residual action OUT of it.

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
- 🔴 **RETRACTION: "this repo has no `.envrc`" WAS WRONG, AND A STALE CHECKOUT MANUFACTURED THE
  EVIDENCE.** I `ls`'d the base clone, got "No such file", and wrote the conclusion into this
  doc — but the clone was **19 commits behind** and `.envrc` had been added in `9366021`. The file
  is tracked and always shipped. **The real mechanism is that `direnv` authorization is PER PATH
  and the path was `allowed 0`**, so a present, correct `.envrc` sat inert and the host's pnpm 10
  won silently. The tell is in `direnv status`: `Found RC path …` together with `Loaded RC
  allowed 0` — *found* and *allowed* are different fields and only the second one matters.
  Generalises: **a file's PRESENCE is not its ACTIVATION**, and an absence measured on a stale
  tree is not an absence.

## Evicted 2026-09-26 (second pass) — this session's detail, held here to keep the doc's delta under its ratchet

<!-- MOVED, NOT DELETED. The main doc carries a one-line pointer per item; the
     evidence is here. Evicted at write time rather than after, because the size
     ratchet gates the DELTA of an update and not the total, so trimming the doc
     afterwards cannot buy room for the same round. -->

### ✅ SUPERSEDES `TRACK B RESULT` — the per-viewer storage gap is CLOSED (full evidence)
- as-of: 2026-09-26
- **What changed:** the `TRACK B RESULT` block in the main doc (2026-09-24) records *"no REST twin
  for the per-viewer KV — **0** routes, against a control of **12** for shared-storage"*, and ranks
  it as the thing that *"may require a platform PR before most of the fleet can move at all"*.
  **Both halves now exist.** That block is retained for its reasoning; its blocking conclusion is dead.
- **Observed (with values):** platform — **5** routes on `civitai@origin/main`:
  `src/pages/api/v1/blocks/app-storage/{get,set,delete,list,quota}.ts`. Control:
  `src/pages/api/v1/blocks/shared-storage/` = **11**, which matches the figure the superseded block
  itself quotes, so the count is a real reading and not a mis-scoped glob. SDK —
  `AppClient.storage: StorageClient` in the **published** `@civitai/sdk@0.7.0`;
  `packages/civitai-sdk/src/storage/index.ts` sets `BASE = 'blocks/app-storage'` and issues real
  calls with per-call error handling; reached from the root export at
  `packages/civitai-sdk/src/app/index.ts:46`. `via: code`
- **Ruled out:** *"it is a type with no wiring"* — FALSE. The module issues real calls against
  `blocks/app-storage`, and `app/index.ts:184` records that `test/storage/seam.test.ts` pins its
  `BASE` textually. `via: code`
- ⚠ **NOT verified: that a real block token round-trips through it against production.** The claim
  is that the surface EXISTS on both sides — which is what unblocks a port, not that a port works
  first try.
- **Leading hypothesis:** `playable-collections` (27 importers) is now portable. Its
  `block.manifest.json` declares `apps:storage:read` + `apps:storage:write` (8 scopes total), which
  is exactly what the 5 new routes serve.
- **Next probe:** port it and let the port be the test. If `AppClient.storage` is wrong, that is
  where it shows.

### Gotchas from this session, evicted with the block above
- 🔴 **THE HARNESS REPORTED A BACKGROUND RUN AS "exit code 0" WHILE ITS LOG ENDED `ELIFECYCLE
  Command failed with exit code 2`.** Same family as the doc's existing *"count the runner's own
  result lines"* entry, but the wrapper was the **task-completion notification** rather than a
  script, so there was no pipeline to inspect. **Read the log's content; a completion notice is a
  claim about the runner, not a verdict on the work.**
- 🔴 **RETRACTED 2026-09-26, and the retraction is the transferable half. CLAIMED:**
  *"`src/tests/api/v1/blocks/` has two files red on `civitai@origin/main` —
  `workflows-controls-seam.test.ts` and `suspended-app-rest-refusal.test.ts`, 32 tests.
  Pre-existing and NOT a `#5163` regression: established by running a pristine `origin/main`
  worktree and comparing failure SETS (33 lines each, zero difference in either direction).
  Unowned; nobody has filed it."* **FALSE.** Those two files pass **41/41** once
  `event-engine-common` is initialised; there is no base failure and nothing to file.
  🔴 **A CONTROL THAT SHARES THE STEP YOU DOUBT IS A SECOND SAMPLE, NOT A CONTROL.** Both arms of
  the comparison were worktrees with the submodule UNINITIALISED, so the identical failure sets
  could not distinguish *"the base is broken"* from *"both my trees are misconfigured the same
  way"* — and identical sets read as strong evidence, which is what made it convincing. The
  set-comparison method was sound for the question *"did my change cause this?"* and worthless for
  the question I then answered. **Ask which step both arms share before quoting a matched pair**;
  here the discriminator was one command (`git submodule update --init`) and it inverted the
  conclusion. Caught by `#5163`'s round-1 auditor, who reported that every failure in its own
  worktree traced to `Cannot find module '../../../event-engine-common/feeds'` and that CI was
  green at head — i.e. it could not reproduce my mechanism, and said so instead of confirming it.
- **A propagation test needs a SEPARABILITY control, not just a kill.** After `#5163` corrected its
  fixture, that case and the anon case share a CODE. Mutation A (rewrite the propagated error in the
  route's `catch`) killed it on `expect(err.code)`. Mutation B — feed the fixture the anon refusal's
  MESSAGE with the SAME code — left the code assertion green and turned **exactly** the newly added
  message assertion red. Only B proves the added line is load-bearing rather than decoration.
- 🔴 **THE SIZE RATCHET GATES THE DELTA, AND THE TOOL'S OWN OPTION 2 DOES NOT SATISFY IT — CONFIRMED
  BY ARITHMETIC THIS SESSION.** The refusal offers *"MOVE what has closed out first, then re-run
  unchanged"*. Measured: total = base + delta (`94,688 + 5,331 = 100,019`), so evicting from the base
  lowers the total and leaves `+N` identical — the gate checks GROWTH. The doc already recorded this;
  it is re-confirmed here because the tool's own remedy text still points the wrong way. **The
  working move is to write new detail STRAIGHT INTO THIS ARCHIVE and leave a pointer in the doc**,
  which is what this section is.
