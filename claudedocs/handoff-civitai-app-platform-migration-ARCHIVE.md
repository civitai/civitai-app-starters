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

## Evicted 2026-09-26 (third pass) — the fleet-measurement correction, and #5163's ladder

<!-- Written STRAIGHT HERE rather than into the doc: the doc's size ratchet gates the
     DELTA of an update, so new detail in an APPEND section is what makes a round
     unlandable. The doc keeps one-line pointers. -->

### 🔴 THE FLEET IMPORTER NUMBERS IN THIS DOC ARE ALL INFLATED — the anchored pattern PREFIX-MATCHES the subpaths
- as-of: 2026-09-26
- **Symptom:** this doc's `How to verify` step 2 and every per-app number it quotes use
  `(from|import\()[[:space:]]*'@civitai/blocks-react`. That has **no closing quote**, so it matches
  `'@civitai/blocks-react/ui'` and `'@civitai/blocks-react/testing'` too — three populations counted
  as one. The doc's own gotcha *"grep for the CONSTRUCT, not the token"* fires on the doc again.
- **Observed (with values), per app on its own default branch:**

  | app | doc says | bridge (root, closing quote) | **production** bridge | `/ui` | `/testing` |
  |---|---|---|---|---|---|
  | `gen-matrix` | 7 | 4 | **3** | 4 | 3 |
  | `sensei` (`trunk`) | 21 | 12 | **6** | 10 | 2 |
  | `playable-collections` | 27 | 7 | **3** | 7 | 15 |
  | `model-benchmarking` | 42 | 22 | **7** | 17 | 19 |

  **Production bridge files across all four remaining apps: 19, not 97.** `via: measurement`
- 🔴 **The CLOSING CONDITION IS UNAFFECTED and must not be "fixed" on the strength of this** —
  0 on the prefix pattern implies 0 on the root pattern (the prefix set is a superset), and both
  ported apps read 0 on every population. `via: command`
- 🔴 **What it changes is the PORT RANKING, which this doc gets wrong.** `/ui` is the design-system
  pack — a SEPARATE migration (`starters#328`) — and `/testing` is the harness. By production
  bridge files `playable-collections` (3) TIES `gen-matrix` (3) as cheapest, and
  `model-benchmarking` is 7, not six times the cost. Rank by the root pattern with its closing
  quote, and report the three populations separately.
- **Next probe:** when the next port lands, re-measure with `'@civitai/blocks-react'` (closing quote
  included) and state which population each number is.

### Gotchas from this session
- 🔴 **`civitai/civitai` TAKES SQUASH MERGES, NOT MERGE COMMITS — this doc said the opposite.** Its
  existing gotcha reads *"`civitai/civitai` takes **merge commits**; `civitai-app-starters` and the
  `ZacxDev/*` app repos are squash."* Measured 2026-09-26: the last five numbered PRs
  (`#5156`–`#5160`) each landed as a **single-parent** commit carrying `(#N)`, and 27 of the last 30
  mainline commits have one parent. `#5163` was merged as a squash accordingly (`de52df5a63`,
  parent `eb57472dbe`). ⚠ My first attempt to measure this was itself wrong — `rev-list --count
  --merges -40` and `--no-merges -40` both returned 40, because the `-40` caps each query separately rather
  than partitioning. The per-PR `mergeCommit` parent count is what settled it.
- 🔴 **A RENAME SILENTLY INVALIDATES EVERY POINTER IN A cairn INDEX ENTRY, AND NOTHING CHECKS THEM.**
  `packages/civitai-blocks-client{,-react}/` were renamed to `@civitai/sdk` in `f53f5a8`
  (2026-09-22). The `civitai-blocks-client-react` index entry still named all four old paths, and a
  briefing I wrote from it sent an agent to `packages/civitai-blocks-client/BREAKING.md`, which does
  not exist. The agent found the real ledger at `packages/civitai-sdk/BREAKING.md` and reported the
  correction. Entry rewritten via `cairn put`; the dead paths are kept NAMED so a reader who followed
  one knows why it missed. **When a rename lands, sweep the index for the old package name.**
- 🔴 **A STALE WORKING TREE AND A REF DISAGREE ABOUT DEPENDENCY VERSIONS, AND BOTH READINGS LOOK
  AUTHORITATIVE.** An agent read `civitai-app-playable-collections/package.json` from the **working
  tree** (`app-sdk 0.39.0`, `blocks-react 0.49.0`); `origin/main` says `0.42.0` / `0.51.0`. That
  clone's `main` is **3 commits behind**. Same family as this repo's own `AGENTS.md` warning, and it
  bit an agent today: **read deps from the ref, not the tree.** Nothing rested on it here — both
  readings agree the app has **no `@civitai/sdk` dependency at all**, which is the load-bearing fact.
- **`#5163`'s ladder, in one line each:** round 0 found the first commit fixed a false comment and
  shipped a false one one sentence over (*"this route has no 403 path at all"* — `withBlockScope`
  403s at `block-scope.middleware.ts:1279`/`:1343` before the handler); round 1 found the correction
  still unguarded (no gated-images test can see what the gate throws, so it could go false again with
  all three suites green) → **deleted** rather than rewritten; round 2 found the round-1 commit
  message claimed the job done while a second cross-module sentence stood → deleted too; round 3
  found four more stated numbers wrong and **closed the ladder on the attribution gate** (two
  consecutive zero-payload rounds). Shipped production change: a **two-line comment deletion**.
  🔴 The transferable half: **every round after the first found a false claim the PREVIOUS round's
  fix had written**, and the code was correct from the start.
- 🔴 **I STATED ONE DIFF'S SIZE WRONG FOUR TIMES** on a PR whose whole thesis is that an unchecked
  restated number goes wrong (`7` → `13/5` → `12/9` → `12/6`). The durable fix is not care: it is
  **reading the number off `git diff --numstat <base> <head>` at the moment of writing**, and saying
  so in the artefact instead of restating a remembered figure.

## Evicted 2026-09-27 (fourth pass) — `starters#479`'s ladder, and the port scope

<!-- Straight to the archive: the doc's ratchet gates the DELTA, so new detail in an
     APPEND section is what makes a round unlandable. The doc keeps pointers. -->

### 🔴 ONE PARAGRAPH TOOK THREE FRAMINGS, AND NOTHING IN THE REPO COULD SEE ANY OF THEM WRONG
- as-of: 2026-09-27
- **The structural finding, which is the transferable one:** **zero** test files and **zero** scripts in
  `civitai-app-starters` read `packages/civitai-sdk/BREAKING.md` — measured by enumeration, with
  `api-report.mjs` reading `public-api.md` as the positive control proving the search works. So all
  three wrong framings of its porting section shipped past a **fully green suite**. Prose review was
  the only guard and it failed three times. `via: measurement`
- **The three framings, all mine, each written while fixing the previous one:**
  (a) *"a second client for these same routes already ships here"* — **FALSE**: `useSharedStorage`
  sends `SHARED_*` over `postMessage` (20 hits, **zero** `/api/v1`) and the host answers via tRPC
  `apps.shared.*`. Two **transports**, not two clients of one surface — and it inverted
  `BREAKING.md`'s own master table, which maps the `SHARED_*` family to those routes.
  (b) *"the port is a transport change; budget for the token/CORS work"* — **FALSE**: `initialize()`
  wires `createHostSession`, `createHttp` sends `Authorization: Bearer` on every request
  (`src/http/index.ts:41`) and retries once on 401 with a fresh host-minted token (`:54-56`), and all
  five kept routes declare `allowOpaqueOrigin`. It pointed a porter's effort at **finished
  infrastructure** while demoting the real work.
  (c) the landed one: the transport does change, the credential and CORS declaration are already
  handled, and the remaining work is four **call-site** items — narrow `value` from `unknown`, move
  vote/counter/report app-side, handle refusals as HTTP (`ApiError` with a `status`, **except** a
  CORS/network failure which is a bare `TypeError`), audit every `limit`.
- 🔴 **THE FIX THAT MATTERS IS THE GUARD, NOT THE WORDING.** `test/shared-storage/seam.test.ts` now
  pins the section's load-bearing claims as **whole normalised strings** (`readFileSync` + a
  `normalisedProse()` normaliser), with a positive control and a file-visibility control: **8 doc
  mutants, 8 killed**, each red on its own assertion — reword a pinned claim, reword the tier CORS
  clause, drop the `ApiError` carve-out, restore the over-reaching quote, delete the transport
  carve-out, drop a retracted framing, shrink the four-item list, rename the heading. A cosmetic
  reword now fails a test, which is the point. **The doc also carries its own retraction record** so
  a fourth framing is not derived.
- **Generalises past this repo:** when a document's claims are load-bearing and no test reads it,
  the count of wrong versions is bounded only by how many times someone looks. Pin the normalised
  string; a keyword assertion is walkable by rewording.

### `#479`'s ladder in one line each, and what four rounds actually bought
- as-of: 2026-09-27
- **No code defect was ever found.** Two independent mutation batteries (28/28 and 23/23, different
  mutants) confirmed the client. Round 0 questioned the requirement — *"the immediate consumer needs
  three methods"* was **false as stated**: `civitai-app-playable-collections` has **no
  `@civitai/sdk` dependency at all**, so the PR unblocked nothing today; it is the surface the port
  needs to pre-exist. Rounds 1–3 found only prose, **two of the findings mine** (the (a)/(b)
  inversions above). The ladder closed on the **attribution gate** — two consecutive rounds whose
  fixes changed zero payload lines.
- 🔴 **A void evidence row survived three rounds because of a same-named twin.**
  `apps.router.storage.test.ts` stays 100% green when `block-token-access.service.ts`'s throw is
  flipped, because a **module-private** `assertAppBlocksEnabledForTokenUser(userId, op)` at
  `src/server/services/apps/app-storage.service.ts:150` is what it actually exercises. ⚠ The twin is
  a **DELIBERATE, DOCUMENTED divergence** — `block-token-access.service.ts:23-38` names it, records
  the extra `StorageOp` and the counter, and says *"Keep all of that when reconciling the two."* An
  earlier report of mine called it an undocumented one-rule-two-places hazard; **retracted**. Only the
  `'Apps are not enabled'` throw is byte-identical; the subject-unresolvable messages differ by the
  leading word `runtime`, deliberately.
- **`limit` is the divergence that bites silently**: the bridge **HOST** normalised three ways
  (clamp 1..100, floor a non-integer, fall back to 50 on non-finite **or non-number**) and the REST
  route 400s on all three. The hook itself does not clamp — the attribution is the host's.

### `playable-collections`' REAL port scope, measured
- as-of: 2026-09-27
- **3 production bridge files**, not 27: `src/App.tsx`, `src/lib/popular.ts`, `src/lib/viewer-maturity.ts`.
  The other root importers are `dev-transport.ts` plus three tests; one (`scope-contract.test.ts`) is
  reached only by a **dynamic `await import()`** that no `from '…'` pattern sees. **10** platform
  hooks, not 9 — `viewer-maturity.ts` adds `useDomainMaturity`. `via: measurement`
- 🔴 **ONE `/ui` COMPONENT KEEPS THE BRIDGE ALIVE, and it is not the one it looks like.** Of the 11
  `/ui` components the app uses, only **`FollowButton`** reaches a transport (via
  `useCollectionFollow` → `getTransport()`); **`BlockGate` does NOT**, despite wrapping the
  production root — its only non-visual dep, `useDirectLoad`, touches no transport. So the
  dual-transport hazard is **one component in one file** (`CollectionViewer.tsx`), not the app root.
  Remedy is `initialize({ transport })` (`civitai-sdk/src/app/index.ts:87,103`), **not** pulling
  `FollowButton` in scope — that app's `CLAUDE.md` forbids a second follow implementation.
  ⚠ I originally briefed "leave `/ui` alone" after counting **import sites** without checking what
  those components **do**. Counting sites is not knowing whether one constructs a transport.
- **Blocked on nothing now** — `#479` merged (`62bf04de`). The `/testing` harness (15 files) needs a
  **fetch-level** rebuild, because after the port the app's real boundary IS `fetch`.

### Cross-agent hazards this session created, worth avoiding next time
- as-of: 2026-09-27
- 🔴 **The scratchpad is SHARED by every subagent.** One audit round's cleanup used broad
  `*.log`/`*.err`/`*.out` globs there and may have deleted an earlier round's artifacts; another
  found a similarly-named `pr_body.md` already present. **Name every scratch file per-agent, and
  delete only what you created, by exact name.**
- 🔴 **Two audit rounds wrote to the SHARED primary clone** (a bare `git fetch`) before internalising
  the rule against it. Additive, but it is a write to a checkout other sessions are standing in.
  Put it in the dispatch brief explicitly — the invariant clause alone did not prevent it.
- ⚠ **A subagent read dependency versions from the WORKING TREE, which was 3 commits behind
  `origin/main`** (`app-sdk 0.39.0/blocks-react 0.49.0` vs the ref's `0.42.0/0.51.0`). Brief agents
  to read deps from the ref.
- 🔴 **I STATED ONE DIFF'S SIZE WRONG FOUR TIMES** (`7` → `13/5` → `12/9` → `12/6`) on a PR whose
  thesis is that an unchecked restated number goes wrong. **Read it off
  `git diff --numstat <base> <head>` at the moment of writing** and say so in the artefact, rather
  than restating a remembered figure. Twice this session a **zero from a phrase I invented** also
  read as a real absence — both caught only by a positive control.

## Evicted 2026-09-27 (fifth pass) — this session's detail, held here to keep the doc's delta under its ratchet

The two investigation blocks and three gotchas below were written for the handoff and moved
here VERBATIM: the ratchet gates the DELTA, so appending them there is what would have made
the round unlandable. The doc carries a one-line pointer to this heading.

### ✅ RESOLVED — `sdk@0.8.0`'s publish failed E503; attempt 2 fixed it and was NOT mine
- as-of: 2026-09-27
- **Symptom:** `main` at `0.8.0` with `sharedStorage` while npm `latest` was `0.7.0`, whose tarball has **no** shared-storage files. Run `36283050923` ended `failure`.
- **Observed (with values):** the publish step names the cause — `E503 ... PUT https://registry.npmjs.org/@civitai%2fsdk`. **In-job control:** all three publishes launched at `00:38:01` on one OIDC credential; `components@0.8.1` and `components-react@0.9.0` succeeded, only the sdk 503'd at `00:40:52`. `assert:published` then 404'd over 60 cache-busted attempts / 590 s. `via: measurement`
- **Ruled out:** *"npm STAGED it"* — staging returns success and hides the row, never `E503`; and the re-run worked. 🔴 The authoritative check was unavailable: `npm whoami` is **E401** here, so `npm stage list` would answer about my session. `via: command`
- **Ruled out:** *"my re-run fixed it"* — FALSE. `run_attempt=2` started `02:03:08Z`, done `02:05:06Z`; my `gh run rerun` was **refused rc=1**. `triggering_actor` `ZacxDev` is the shared account, so it does not separate operator from concurrent session. `via: measurement`
- **Verified by CONTENT:** `latest`=0.8.0; tarball has `dist/shared-storage/index.{js,d.ts}`; **neg control** 0.7.0 = **0**; `.d.ts` has exactly **5** methods and **0** of the six absent ones; `AppClient.sharedStorage` at `dist/app/index.d.ts:41`.

### 🔴 CORRECTION — `BlockGate` DOES keep the bridge alive; this doc's "FollowButton, not BlockGate" was WRONG
- as-of: 2026-09-27
- **Observed (with values):** measured on the **pinned** published `blocks-react@0.51.0` tarball (the app's `node_modules` is a stale **0.48.0** — do not measure there). `dist/ui/BlockGate.js:4` → `dist/hooks/useDirectLoad.js:3` → `useTransportSnapshot` → `getTransport()` at `dist/hooks/useBlockContext.js:8`. **Neg control:** `dist/ui/Card.js` = **0**. `BlockGate` wraps the PRODUCTION root at `src/main.tsx:56`. `via: code`
- **Consequence:** the blocks-react transport is built on **every production boot** regardless of `FollowButton`, so `initialize({ transport })` is **more** load-bearing than this doc implied — you cannot dodge the two-transport problem by not rendering `FollowButton`. PR #48's original reading was right. `via: code`

### Gotchas from this session

- 🔴 **A PUBLISH FAILURE'S CAUSE WAS IN THE LOG, AND THE IN-JOB CONTROL MADE IT READABLE.** `assert-published-versions.mjs` rightly says an anonymous 404 cannot separate *failed publish* from *staged* — but it reads only the registry. The **publish step** named `E503` on the `PUT`, and the discriminator was **two sibling publishes on the same credential in the same second succeeding**. **Read the step that did the work, not only the step that checked it.** Its staged-vs-failed warning also does not apply once the partial set is published: a re-run then touches one package and fails loudly with `E409`. 🔴 **AND A TOOL REFUSING YOUR ACTION CAN MEAN SOMEONE ELSE ALREADY DID IT** — `gh run rerun` exited 1 ("cannot be retried") because the run had gone green 2 min earlier on an attempt I did not start. Read `run_attempt` + `run_started_at` before claiming credit; `triggering_actor` cannot separate the operator from a concurrent session on a shared account.
- 🔴 **A SKILL'S SIZE GATE CAN EXIST WITHOUT A TEST FILE NAMED AFTER IT, AND ITS DOCSTRING IS THE SPEC.** `browser-bridge/SKILL.md` is budgeted at **12,038 B** by `test_skill_audit.py` — a filename my `size|ratchet` survey listed but I discounted, so I called five skills ungated and was wrong. Its docstring says the browser skill is the **exemplar** for "a complex tool fits the budget", so growing it is the one forbidden fix: route detail to an **already-referenced** file (it also asserts no `missing_refs`/`orphan_refs`). 12,540 B → red 2 failed/180 passed → moved to `reference/frames-cdp.md` → **182 passed**. **Enumerate the guards that read a file you touched; do not grep their filenames.**
- 🔴 **MINING THE OPERATOR'S ASKS: `--ids-file` WORKS AND ITS SET OVER-COLLECTS.** `--arc` still exits **3** here. The step-6 workaround gave **12 sessions / 269 messages**, of which only **101 were operator-typed** — filter `<task-notification>` or the corpus reads 2.7× larger. 🔴 Matching is on the doc NAME, so it pulls in adjacent arcs (2 of 12 only MENTION this doc), and it misses the **opencode** corpus — exactly where rank 13's artifact might be.

## Evicted 2026-09-27 (sixth pass) — the devrc audit ladder, and the port adapter's measured contract

Held here VERBATIM because the ratchet gates the DELTA; the doc carries pointers only.

### `devrc#1889` — the 4-round ladder, and what every round after round 0 actually found

MERGED, squash `9b41e398f2`, verified BY CONTENT on `origin/main` (4 patterns + a
positive control + a negative control; ancestry is FALSE after a squash and that is
normal, never evidence it failed to land). Gate on the merged head: `pytests
collected=24297 passed=24291 failed=0`, `gotests 461/461`, `nodetests 1720/1720`.

🔴 **EVERY FINDING AFTER ROUND 0 WAS IN PROSE A PREVIOUS ROUND WROTE WHILE FIXING THE
ROUND BEFORE IT. Zero were in the 9 lessons the PR shipped.** Round 0 `deletion
candidate` (2 files retired as duplicates of an auto-loaded `CLAUDE.md`); r1 2🔴/4🟡/2🟢;
r2 2🔴/4🟡/1🟢; r3 0🔴/2🟡. Merged at `fe509d0a` on operator direction with round 4 owed.

- 🔴 **TWO OF MY FIXES WERE WORSE THAN WHAT THEY REPLACED, AND THE ANSWER WAS TO REVERT,
  NOT REDRAFT.** (a) I wrote *"nothing is loaded at all: `direnv status` reads `Found RC
  allowed 0`"* — the reading was right, the inference BACKWARDS. Controls on 2.37.1:
  never-allowed `1`, **allowed `0`**, denied `2`; devrc reads 0 and `direnv export bash`
  prints `direnv: loading`. (b) I wrote that the copy-`.envrc` step *"is a no-op here"* —
  false, and it contradicted `CLAUDE.md:37`, which DOES the copy. Untracked is the REASON
  it is required. Writing draft 3 is how a ladder reaches draft 5.
- 🔴 **A RETRACTION IS A TREE-WIDE SWEEP AND I BROKE THAT RULE HAVING BEEN HANDED IT.**
  I removed the false "four devrc gates" figure from `CLAUDE.md` and left it standing in
  `pipelines.md` — the file gotcha 11 POINTS AT, and the only occurrence in the tree.
  The measured truth: ONE gate on **2026-09-21** (`79e0b655`, `d5f8ea99`) posting
  `NO CAPACITY: <leg>` on all FOUR OF ITS LEGS; devrc posts four contexts per gate, so
  the number four carries no information about how many PRs were affected.
- 🔴 **A REVERT CAN DELETE SOMETHING TRUE.** My round-2 revert dropped *"pnpm 12 errors
  where 10 only warns"* and replaced it with *"no source is cited"* — an unverified
  negative refuted by a TRACKED file in the repo I was citing three lines later
  (`civitai-app-oauth-probe/.github/workflows/ci.yml`, plus `8175b31`). pnpm 12 also
  ships a native binary NixOS CANNOT execute, so that gap is permanent, not a to-do.
- 🔴 **A "DISCRIMINATOR" THAT DISCRIMINATES NOTHING.** Item 11 named the per-head status
  timeline as THE discriminator and printed a jq selecting only `created_at/context/state`
  — dropping `.description`, the field the `NO CAPACITY` text lives in. Live control on the
  PR's own head: corrected form prints `pending devrc gate running`, the old form stops at
  `pending`. 🔴 **The fix then caught its own bug on its own PR**: head `8702dc76` shows 4×
  `error` whose description reads *"superseded by a newer run … this commit was not
  validated"* — NOT a failure, and on `state` alone indistinguishable from a red.
- 🔴 **`--emit-claims` REFUSED a corrupted anchor and that refusal is load-bearing.** I
  passed `--audited <from>..<to>` where it wants a single sha; it would have written
  `a..b..c` and copied the corruption into the next round. `<from>` = the tip the round
  READ, `<to>` is stamped from `headRefOid`. And EMITTING IS NOT POSTING — the control is
  a next-round probe parsing the block back (`round=N` at rc 0).
- ⚠ **`audit-dispatch.py`'s WHERE TO WORK is WRONG for a cross-repo dispatch, confirmed
  three times** — it asserts the target "is the repository this session is standing in".
  Brief every cross-repo auditor that it is wrong, rather than letting it discover it.
- ⚠ **Round 2 predicted a #1787 textual conflict; round 3 REFUTED it** — `git merge-tree
  --write-tree` rc 0 in BOTH orders, instrument validated with a real-conflict control
  (rc 1 + a CONFLICT line). Round 2 had read #1787's diff against its OWN base.

### `playable-collections` port — the adapter's measured contract (commit `b157419`)

The bridge and SDK transports do not line up, and the gap is exactly three things:

1. **SNAPSHOT — one field.** Diffing both `BlockSnapshot` shapes: `hostOrigin` is the ONLY
   field the SDK wants that the bridge's snapshot lacks (the bridge's extra `appId`/`blockId`
   are ignored). 🔴 **Identity is load-bearing**: `snapshot.get()` feeds
   `useSyncExternalStore`, which bails on `Object.is`, so composing `{...snap, hostOrigin}`
   fresh per call renders FOREVER — memoised on both inputs. 🔴 **`hostOrigin` takes NO
   fallback**: the bridge documents `getHostOrigin()` as a security invariant because its
   value becomes the base URL a money-scoped bearer token is sent to, so `null` must stay
   `null`; substituting `location.origin` converts not-ready into an exfiltration vector.
2. **REQUEST — one mapping.** The SDK's `request(type, params)` carries no reply type; the
   bridge REQUIRES one. Only `REQUEST_TOKEN` → `TOKEN_REFRESH_RESPONSE` is needed, verified
   three ways (`mockHost.js:889`, `useBlockToken.js:11`, `validate.js:326`).
   `REQUEST_CONSENT`/`REQUEST_SIGN_IN` are **notify**-shaped in the SDK's own host client
   (`host/index.js:286`, `:37`), and Buzz/storage go over REST. An unmapped type THROWS: a
   wrong reply type hangs until timeout and reads as a dead host. All SDK traffic funnels
   through three wrappers in `core/messaging.js`, so the adapter surface is exactly
   snapshot/request/notify/on.
3. **ABORT — not castable.** The SDK passes `{signal}`, the bridge takes `{timeoutMs}` —
   NO common property, caught by the type checker. A cast compiles and silently discards
   cancellation. The signal is honoured explicitly, with the limitation STATED: it rejects
   the caller's promise; the bridge cannot recall the in-flight postMessage, so the host
   still does the work.

🔴 **BOTH `/ui` CONSUMERS REACH THE BRIDGE — the doc's "FollowButton, not BlockGate" was
WRONG.** Measured on the PINNED published `blocks-react@0.51.0` tarball (the app's install
is a stale **0.48.0** — do not measure there): `dist/ui/BlockGate.js:4` →
`hooks/useDirectLoad.js:3` → `useTransportSnapshot` → `getTransport()`
(`hooks/useBlockContext.js:8`); negative control `dist/ui/Card.js` = 0. `BlockGate` wraps
the PRODUCTION root at `src/main.tsx:56`, so the bridge transport is built on every
production boot regardless of `FollowButton`.

🔴 **A VACUOUS GUARD I CAUGHT IN MY OWN TEST.** The security test also asserted
`not.toContain(globalThis.location?.origin)` — VACUOUS in vitest's `node` environment,
which defines no `location`, so it reduced to `not.toContain(undefined)`. The mutant was
killed by `toBeNull()`. Deleted rather than kept: an assertion that reads as covering the
exfiltration case while covering nothing stops the next reader looking.

**Mutation evidence, both isolated and both restored byte-identical by sha256:** removing
ONLY the memo early-return → exactly **1** test red on its OWN assertion (`Object.is
equality`, line 51) with 11 still green; adding a `hostOrigin` fallback → the security test
red with its own assertion (`expected 'https://evil.example' to be null`).

## Evicted 2026-09-27 (seventh pass) — the rank-5 rebind's lessons, held here to keep the doc's delta under its ratchet

Full text of five gotchas and two decisions from the session that landed
`zach/sdk-port-pc-rebind` (4 commits: `a825a5c` `72119bd` `bd0ac37`, on `b157419`).
The commit messages carry the per-change evidence; this is the transferable half.

🔴 **I WROTE A VACUOUS GUARD AND ONLY THE MUTANT FOUND IT — THE OBSERVABLE WAS THE BUG,
NOT THE ASSERTION.** Guarding that the SDK runtime follows a REPLACED bridge transport
(`test-setup.ts` nulls the singleton in a global `beforeEach`, so a plain `??=` would wrap
a disposed one forever), I asserted *"re-rendering does not throw"*. The unkeyed-cache
mutant **SURVIVED a 19-test green suite**: `dispose()` only drops listeners, so
`getSnapshot()` on a disposed transport still answers its last value — and `ready` was
already `true` on it. NEITHER "throws" nor "ready" can DIFFER between the two transports,
so neither discriminates anything. Fixed by choosing a field whose value only ONE of them
can produce: anonymous viewer on the first, signed-in on the second. The mutant then died
`expected 'anon' to be 'porter'`. **Generalises: when a guard is about WHICH object is
being read, the assertion must name a value the wrong object CANNOT produce — and
"it did not crash" is never that value.**

🔴 **A PORT INHERITS A FIELD THE OLD CODE DID NOT TRUST, AND THE SAFE DIRECTION IS NOT THE
DEFAULT.** `@civitai/blocks-react`'s `useDomainMaturity` RE-APPLIED the domain∩viewer
intersection via `effectiveBrowsingCeiling(maxBrowsingLevel, effectiveBrowsingLevel)`;
`@civitai/sdk`'s snapshot passes the host's `effectiveBrowsingLevel` through RAW
(`dist/core/transport.js`). A literal port of `viewer-maturity.ts` — one line, type-checks,
same field name — would have silently WIDENED the maturity ceiling, rendering mature media
to a viewer who turned NSFW off. The bridge hook's own comment states why it re-derived:
*"so the never-wider property holds even against a host that ships a wrong value"*, and the
function additionally maps junk `(31, -1)` to `3` (SFW). The `undefined` arm is equally
load-bearing: `effectiveBrowsingCeiling` always returns a NUMBER, so calling it
unconditionally turns "the host told us nothing" into a concrete ceiling, inverting a
documented fail-closed contract. **When porting, diff what the OLD wrapper DID against what
the NEW one PROVIDES; a field of the same name is not the same guarantee.**

🔴 **WHICH WAY A STALE GUARD BREAKS IS A PROPERTY OF ITS PHRASING, AND TWO IN THIS PORT
BROKE RED ONLY BY LUCK OF IT.** (a) `scope-contract.test.ts` scans value imports of ONE
package to prove every manifest scope has a consumer; moving the nine hooks to an app-local
module made it see **zero**, and the thing that failed by name was its **POSITIVE CONTROL**
(*"finds the scoped hook this app really does call"*) — without that control the file would
have passed the port untouched while asserting nothing. (b) The browse-prefs relationship
guard watched an `APP_STORAGE_SET` postMessage that no longer happens; it failed because it
asserts a write COUNT of **1**, and zero writes fails that. A guard phrased *"no more than
one key"* would have PASSED on an empty set and gone on reading as coverage.
**Phrase a contract guard as a positive count, never as an upper bound — and give every
scanner a positive control, because that control is what survives a refactor the scanner
cannot see.** Proven load-bearing: narrowing the regex back reddens the control AND reports
all 5 declared scopes orphaned.

🔴 **A FAKE'S DEFAULTS ARE PART OF ITS CONTRACT, AND THE FAILURE LANDS THREE STEPS AWAY.**
Replacing the mock host with a `fetch`-level fake (`src/dev-rest.ts`) for app storage,
shared storage and the Buzz balance — fetch-level because after the port those three ARE
HTTP, and a transport-level fake would answer a conversation nobody is having — I defaulted
the balance to zeros. The mock host defaults `{blue:1000, green:0, yellow:5000}`. One test
then failed on a **tip never sending**: the tip modal's soft ceiling derives from the
balance, and a zero ceiling refuses every amount. Nothing in the failure named the balance.
**When a fake inherits an older fake's job, copy its DEFAULTS, not just its route shapes.**
Two things kept the rest of the misses loud: the fake 404s any unrecognised route (an
unknown path is a failure, not an empty screen), and its keys are ULID-shaped rather than
`shared_<n>`, because this repo has already been bitten by an e2e case pinned to the retired
mock host's minting convention.

🔴 **`node_modules/.bin` IS THE TELL, NOT THE EXIT CODE — AND A VERSION CHECK CORROBORATED
THE FALSE PASS.** A backgrounded `pnpm install --frozen-lockfile` was reported by the
harness as `[exited with code 0]` while its log ended `✗ Lockfile failed supply-chain policy
check (191 entries in 3.1s)` / `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Worse, the obvious
confirmation LIED in the same direction: `node_modules/@civitai/sdk/package.json` was
already readable at exactly the expected `0.8.0`, because packages are linked BEFORE the
policy check runs. The discriminator was `ls node_modules/.bin | wc -l` → **0**. Same family
as this doc's "count the runner's own result lines, never the exit code", one level out: the
countable artefact here is a DIRECTORY the step is supposed to create. Re-confirmed in the
same session: **the dev-shell banner's `pnpm --version` is not the pnpm you get** — it
printed `10.28.1` in a run whose own warnings and closing `Done in … using pnpm v11.25.0`
were pnpm 11's.

**Decision (mine, operator UNCONFIRMED):** added the exact-version `@civitai/sdk@0.8.0`
`minimumReleaseAgeExclude` entry rather than wait ~19h for the clock, on THIS repo's own
`CLAUDE.md` condition (*"Bumping any `@civitai/*` dependency also means updating
`minimumReleaseAgeExclude` in `pnpm-workspace.yaml`"*) plus the four existing first-party
entries as precedent — a different condition from `app-requests`' *"almost always to wait …
last resort"*, and the governing repo is the one being changed. The clock that actually
governs (`2026-09-28T02:03:55Z`, 24h after the publish) is written into the file with a
"delete it then" instruction, because the previous exemption pair in this fleet carried a
removal condition that could never fire. Reversible in one line; flagged, not assumed.

**Decision (mine):** `configureSdkRuntime` DROPS a stale AppClient instead of throwing on a
second call. The throw named a real hazard — a `fetch` swapped mid-flight would otherwise be
silently ignored — but refused a legitimate case in this repo's own suite (a test rendering
the app twice with different props), and dropping the client REMOVES what refusing merely
reports. Its test is now a behaviour (`the second fetch is the one that answers`) rather than
an error string, and its mutant dies `expected '1' to be '2'`.
