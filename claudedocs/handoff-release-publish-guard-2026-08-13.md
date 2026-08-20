# Handoff: release publish-guard — 2026-08-13

## Goal

Close ranked items #1 and #3 from `<datapacket-talos>/claudedocs/handoff-appblocks-consent-chain-shipped-2026-08-12.md`:
unblock the release workflow's approval gate, and close the booked gaps around `check-starter-pins.mjs`.
Both landed. Item #3's guard then broke the release workflow and took four rounds to get right — that
arc is the substance of this doc.

## State now

- **Branch/PR:** nothing of mine open on this work. `origin/main` = `b335c0e`. Base clone re-synced
  (`merge --ff-only`); every worktree this session created is removed.
  ⚠️ `git worktree list` still shows 4 under `/tmp/wt-*` — `batchd-contract-sdk`, `consentfix`,
  `longpoll-sdk`, `sdk-inline-docs`. Those are **other sessions'**, predate this work, and must not be
  removed (broad-glob worktree cleanup has destroyed other agents' running jobs before).
- **`main`: GREEN.** All runs green on every merge below.

### Merged 2026-08-13 → 2026-08-20

| PR | sha | what |
|---|---|---|
| #236 | `dd7a426` | F1 — the FLOOR names the ref and sees unusable manifests. **3 audit rounds** |
| #231 | `aef91b3` | published `app-sdk@0.34.0` + `blocks-react@0.42.0` |
| #237 | `18446ad` | this handoff doc — landed as a tracked file (`claudedocs/` had been untracked) |
| #238 | `da3a9dd` | `WORKFLOW_STEP_TYPES` was missing `miniMaxMusic3` |
| #239 | `ec8084d` | published `app-sdk@0.35.0` |
| #240 | `0121810` | `@vitest/browser` 4.1.7 → 4.1.11 — **4 criticals → 0** |
| #242 | `b335c0e` | bounded `playwright install --with-deps` (see the wedge below) |

Issues: **#235** filed → auto-closed by #236. **#106** closed → **#241** (rewritten Dependabot triage).

### Verified — independently, not from the tooling's own report

- **npm:** `app-sdk@0.35.0` and `blocks-react@0.42.0` both HTTP 200 with matching `.version`;
  negative control `app-sdk@99.99.99` → 404. The **published tarball** for 0.35.0 was unpacked and
  contains `readonly miniMaxMusic3: "Music generation from a caption + lyrics (MiniMax Music 3)"` —
  with `aceStepAudio` present (2) and a nonsense string absent (0) as controls, because a first
  attempt at that grep returned 0 for BOTH target and control (wrong nested path).
- **Dependabot:** 44 → 40 open, critical tier **empty**, confirmed by re-scan, not inferred from a
  version string.
- **#230 fully verified, on BOTH paths.** The push path came from the actor split across 79 runs on
  `changeset-release/main` (pre-fix every `github-actions[bot]` first-attempt parked
  `action_required`; post-fix 5/5 `actor=ZacxDev`, none parked). The `opened` path was then exercised
  for real: #238's changeset created a **brand-new** Version PR (#239) whose first run was
  `attempt=1 actor=ZacxDev event=pull_request in_progress` — a parked run never reaches
  `in_progress`. That was the case the original doc said could not be verified.

## Open investigations — live diagnosis state

### F1 — the FLOOR is reachable from the git-ref reader, but its message was written for the disk reader

- **Symptom:** on a damaged/partial object store, a run hard-fails with `ERROR: no publishable package
  found under packages/.` while the files sit readable on disk, and never names the ref it inspected.
- **Observed:** repo with one committed `packages/p/package.json` whose blob object is deleted,
  `GITHUB_SHA=HEAD`:
  - at `dabcf10`: `WARN could not read packages/p/package.json …` → `SKIP the publish assertion` → **exit 0**
  - at `58c9914`+: same WARN → `ERROR: no publishable package found under packages/.` → **exit 1**
  The line that would name the ref (`… package(s) from ${source}`) is printed *after* the floor and is
  unreachable on that path.
- **Ruled out:** not a correctness hole — the guard's verdict is defensible, only its *diagnosis* is
  wrong. Not exposed by default config: `actions/checkout@v7` in `release.yml` sets no `filter`, so a
  blob-filtered partial clone isn't in play.
- **Leading hypothesis:** `readPublishablePackagesFromGit()` drops unreadable manifests into `dropped`
  and returns `{pkgs: []}`, which the floor then reports as "nothing found".
- **Next probe / fix:** carry `dropped.length` out of the reader and name `source` in the floor message
  (`scripts/assert-published-versions.mjs:485-490`, `:260-274`). Diagnostics-only. Deliberately booked
  as a follow-up rather than a seventh round, on the auditor's recommendation.

### `changesets/action@v1` is a moving branch — the guard's whole premise can change with no diff here

- **Observed:** `git ls-remote changesets/action` → `refs/heads/v1` exists, **no `refs/tags/v1`**, and
  `refs/tags/v2.0.0` exists (shipped 2026-08-11).
- **Why it matters:** everything the guard assumes about *where the version bump lands* — that
  `prepareBranch()` + `pushChanges()` commit it and leave HEAD there — is a claim about that action's
  internals, verified by reading `a45c4d5` (v1.9.0). An upstream change silently invalidates it.
- **Next probe:** if a release run starts failing here for no local reason, re-read the action's
  `src/git.ts` `prepareBranch()`/`pushChanges()` **before** believing the guard. Recorded as a PREMISE
  RISK in the script header. **Decision pending: pin the action to a SHA?** Not done — it has its own
  upgrade cost and is the operator's call.

### F1 — RESOLVED 2026-08-13, and the fix took three audit rounds

Shipped in #236 (`dd7a426`). The reader now returns `dropped` **and** `listed` alongside `pkgs`; the
floor names `source` and reports both counts. Verdicts unchanged on every path — a zero still exits 1.

🔴 **The same defect shipped THREE times inside this one PR, each time in the replacement message.**
This is the substance worth carrying forward, because two of the three were found by audit and none by
a green suite:

| v | the claim | why it was false |
|---|---|---|
| v1 | `N manifest(s) ARE listed … and every one is UNREADABLE` | `N` was `dropped.length`, not `listed`; "every one" was false of the manifests it read fine |
| v2 | `the population is there and this guard could not use it` | same universal claim, moved from the count into the prose below it |
| v3 | `Repairing the unusable ones ALONE will floor again` | **advice**, asserting the pessimistic branch of an unknown as fact — whether an unusable manifest is publishable is exactly what the guard could not determine |

v3 was the worst: it was operator-facing advice during a broken release, **and the round-2 `deepEqual`
pinned it**, so the suite would have defended it. Measured refutation, now a permanent test: on the
mixed fixture, restoring only the two damaged blobs (private manifests untouched) exits 0 with
`2/2 confirmed`.

**Still NOT covered, stated rather than implied:** all object-store damage in the suite is simulated by
unlinking loose blobs. A real `--filter=blob:none` clone with a *live* promisor is uncovered — and the
message now says so, since a REACHABLE promisor would have fetched the blob and the floor would never
have fired. Partial damage (`pkgs` non-empty AND `dropped` non-empty) still exits 0 and WARNs; failing
there is a verdict change and wants its own decision.

### The CI wedge is BOUNDED, not diagnosed — root cause still unknown

- **Symptom:** `pnpm --filter <pkg> exec playwright install --with-deps chromium` hangs with no
  output. The job renders `in_progress` until GitHub's 6-hour cap, so a wedge is indistinguishable
  from a slow install and nothing reports a problem.
- **Observed (values):** same step, same day —
  - four other branches 09:45–09:47Z: **22s, 23s, 26s, 33s**
  - PR #240 attempt 1, 16:45:48Z: **hung 2h13m**, cancelled by hand
  - PR #240 attempt 2 (SAME COMMIT), 19:01:15Z: **3m48s, success**
  - after #242, on its own CI: blocks-react **28s**, design-system **25s**
- **Ruled out — my diff.** Attempts 1 and 2 are the same commit and lockfile with opposite outcomes.
  And the bump does not move Playwright: `playwright@1.60.0` / `playwright-core@1.60.0` are identical
  on both sides. 🔴 The `playwright@4.1.11` vs `4.1.7` strings in `pnpm-lock.yaml` are **peer-dep
  annotations on `@vitest/browser-playwright`, not a playwright version** — reading them as a bump is
  the trap here.
- **Leading hypothesis:** transient apt/network stall inside `--with-deps` (that flag shells out to
  `apt-get`). Unproven — no logs were captured from the hung run before cancelling.
- **Next probe if it recurs:** the step now dies at 15m instead of 6h, so grab the log while it is
  failing rather than re-running: `gh run view --repo civitai/civitai-app-starters --job <id> --log`
  on the timed-out attempt, and look for whether apt or the CDN download is the stall. Consider
  splitting `--with-deps` (apt) from the browser download so the two failures are distinguishable.

## Next steps (ranked)

1. **Fix #241's own title — it is already stale, exactly like #106's was.** It reads
   "44 open alerts (4 critical…)"; live is **40 open, 0 critical** (measured 2026-08-19, after #240).
   🔴 This is my error and worth stating plainly: I closed #106 *for having volatile counts in the
   title* and then filed its replacement with volatile counts in the title. Retitle to something
   durable — e.g. "Dependabot: triage policy + current alert split (counts in body, re-measure before
   acting)". The body already says to re-measure; the title does not.
2. **Decide the Dependabot policy** — the actual ask of #241. 5 open Dependabot PRs, nothing gating
   them, no auto-merge: #200 happy-dom, #199 eslint, #125 sveltekit group, **#111 playwright group**,
   #110 @types/node. #111 touches the very step that wedged (below). Options in #241.
3. **Make `Starter pins vs published` a required context.** Confirmed still absent: 8 contexts,
   `strict=false`. 🔴 **Caveat that has NOT been resolved, only stated:** protection runs
   `enforce_admins: true`, and this check compares pins against *published* npm. A failed publish —
   precisely what it detects — would red it and block **every merge in the repo, including the fix**.
   Correct-as-a-gate, but it converts a publish outage into a total merge lockout. Decide knowingly.
4. **Pin `changesets/action` to a SHA** — de-prioritised on measurement, not dropped. `refs/heads/v1`
   is still `a45c4d5`, the exact sha the guard's premise was audited against; no `refs/tags/v1`
   exists; a `v2` branch now exists at `198f833`. Re-check the sha before assuming the risk is live.
5. **Not mine:** `civitai-orchestration#305` (cross-user write/delete/spend) still **OPEN**. Blocker
   still looks like the 11 breaking `getWorkflow` call sites in `civitai/civitai`; a PR title/body
   search surfaced no companion PR — that is "none surfaced", not "none exists" (it did not search
   code).

## Gotchas / decisions / dead-ends

🔴 **This file shipped FOUR defects of the same shape. Every one lived in the environment/job seam, not
in the script's logic, and every one was invisible to a green local suite.**

| # | defect | caught by |
|---|---|---|
| 1 | read the WORKING TREE — `changeset version` had rewritten it to unpublished versions | **production** |
| 2 | read `HEAD` — inert; the action *commits* the bump and leaves HEAD on it | audit |
| 3 | test fixture inherited CI's `GITHUB_SHA`, disarming the control that proved the fix load-bearing | audit (5 required checks red, 46/46 green locally) |
| 4 | conflated "ref unreadable" with "ref read fine, nothing publishable" → the documented floor became unreachable in CI | audit |

Six audit rounds total. **Each round's fix introduced the next round's finding** — including a round
whose fix *masked* the next defect (the env-strip kept the floor test green precisely because it removed
`GITHUB_SHA`).

- 🔴 **The technique that finally worked: a REPLAY HARNESS.** Build a real git repo, replay the action's
  real sequence (`checkout -b`, `reset --hard $SHA`, rewrite manifests, `git add`, `git commit`), then run
  the script with and without `GITHUB_SHA` and compare. Testing the *script* against synthetic fixtures
  could not see any of the four. **Model what the JOB does to the working directory and to HEAD, not just
  what the script does to a fixture.**
- 🔴 **Run any suite that reads env vars in BOTH environments** — clean, and with the ambient CI vars set.
  Defect 3 was 46/46 green locally and red in CI for exactly this reason. `runGuard` now strips
  `GITHUB_SHA`/`NPM_REGISTRY`/`PUBLISH_CHECK_FROM_DISK` before layering the caller's env.
- **Deletion-mutants are the easy half.** My first battery was 3 deletion mutants, all killed; an auditor's
  16-mutant battery had **10 survivors**. The important gap: the retry-then-*succeed* path — the entire
  reason retries exist — had zero coverage, and the "paired count" I'd presented as the anti-vacuous-zero
  instrument wasn't pinned by any test.
- **A branch whose mutant no test can kill is a signal it is dead code.** I added a publish-mode exemption
  ("ref unreadable but `HEAD === $GITHUB_SHA`"); two mutants against it were unkillable. Deleted it rather
  than keep an unprovable guard. (A later audit *did* construct that state — delete a commit's root tree
  object — so my stated reason was wrong while the decision was right. Corrected in the comment.)
- **Both PR bodies needed public corrections** (`#232`, `#234` issue comments) — a PR body that misstates
  what the change does gets corrected in a comment, not a silent edit, because a reviewer may already have
  read it.
- **Dead end:** `gh pr checks` green is worthless as evidence here. #234 was 16/16 green while completely
  inert, and again while about to turn 5 required checks red.

🔴 **Round 3 of an audit is where the findings change SHAPE — that is the stop signal, not a clean
round you declared yourself.** Rounds 1–2 found wrong code; round 3 found wording. The loop was stopped
there deliberately and the decision handed over, rather than hardening prose in a diagnostic path that
has never fired in production.

- 🔴 **An audit's own harness is an instrument and needs validating.** The first auditor's mutation
  script assigned a pass count it never read (an editor diagnostic caught it). Every mutant it had
  scored was unproven **in both directions** — a killed and a surviving mutant render identically. It
  rebuilt the harness and re-derived everything. **Ask what an agent's verdict was COUNTED from.**
- 🔴 **A mutant that never APPLIED reads exactly like a survivor.** A `perl -0pi` substitution died on
  `${relative(...)}` and reported clean; re-run with a sha check proving the edit landed, it killed two
  tests. Every battery here now proves landing three ways: single-occurrence, sha256 delta, and a
  **literal `str.find`** of the new text.
- 🔴 **A guard can be SPELLED rather than structural, and the synonym you didn't think of walks past
  it.** `doesNotMatch(/every one/i)` was survived by "Each and all of the manifests … is unusable" —
  the same false universal, new words. Cure: `deepEqual` on the whole message block. Cost accepted: a
  cosmetic reflow now fails the test. (No prettier in this repo, so no formatter will trip it.)
- 🔴 **A window that stops early leaves the natural place to add text unpinned.** `floorBlock` ran
  header→terminator, so a summary line appended *after* the terminator survived, as did one printed
  *before* the header. It now runs header→EOF and constrains what may precede the header.
- 🔴 **"Verified in isolation" again: `exit 1` cannot distinguish a completed floor from one that
  crashed inside it** (`main().catch` also exits 1). A floor that TypeErrored mid-message reported
  green. `assertFloorIsIntact` pins the floor's LAST line, which is what a crash removes.
- **`grep -c 'found in ${source}'` returns 0 on a line that is demonstrably there** — `$` mid-pattern
  plus `{}` breaks GNU BRE. `grep -cF` returns 1. Cross-check every reassuring zero with `-F`.
- **`git push … | grep -v '^remote:'` reports GREP's exit status, not git's.** A push that succeeded
  read as `rc=1`. Confirm a push by comparing local and remote shas, never by the pipeline's status.
- **A squash merge never makes the branch head an ancestor of `main`.** Verify a squash landed by
  CONTENT (`git show origin/main:<path> | grep -F`), which is what was done for both merges here.
- **Dead end, unchanged:** `gh pr checks` green is worthless as evidence on this file. #234 was 16/16
  green while completely inert; #236 was 16/16 green while carrying the v2 overclaim.

🔴 **The recurring shape this session, in five costumes: a query defect that renders identically to a
real finding.** Every one produced a confident wrong reading that a control caught:

| # | the reassuring output | what it actually was |
|---|---|---|
| 1 | `grep -c 'found in ${source}'` → **0** | `$` mid-pattern + `{}` breaks GNU BRE; `grep -cF` → 1 |
| 2 | `pnpm … ` → **rc=127** | pnpm not on PATH; a `rc==0?clean:dirty` reader scores it as "0 errors" |
| 3 | `git push … \| grep -v '^remote:'` → **rc=1** | grep's status, not git's — the push had SUCCEEDED |
| 4 | tarball grep → **0 for target AND control** | glob missed the nested `dist/orchestrator/` path |
| 5 | job step timings → **blank** | `test("design-system")` matched `design-system drift guard` first |

**The cure held every time and is always the same: a POSITIVE CONTROL.** #4 and #5 were caught only
because the control also came back empty/wrong, which is the whole reason to run one.

- 🔴 **An audit's own harness is an instrument.** The first auditor's mutation script computed a pass
  count it never read (an editor diagnostic caught it) — every mutant it had scored was unproven **in
  both directions**, since a killed and a surviving mutant render identically. Ask what an agent's
  verdict was COUNTED from before believing its table.
- 🔴 **A mutant that never APPLIED reads exactly like a survivor.** A `perl -0pi` died on
  `${relative(...)}` and reported clean; re-run with a sha check proving the edit landed, it killed
  two tests. Batteries here now prove landing three ways: single-occurrence, sha256 delta, literal
  `str.find`.
- 🔴 **A guard can be SPELLED rather than structural.** `doesNotMatch(/every one/i)` was survived by
  "Each and all of the manifests … is unusable" — same false universal, new words. Cure was
  `deepEqual` on the whole message block. Accepted cost: a cosmetic reflow now fails the test.
- 🔴 **A window that stops early leaves the natural place to add text unpinned.** `floorBlock` ran
  header→terminator, so a line appended *after* the terminator — and one printed *before* the header
  — both survived. It now runs header→EOF and constrains what may precede the header.
- 🔴 **`exit 1` cannot distinguish a completed floor from one that crashed inside it** (`main().catch`
  also exits 1). A floor that TypeErrored mid-message reported green.
- **`scope: runtime` in the Dependabot API is not a shipped-vs-dev signal** — it says `runtime` for
  every `pnpm-lock.yaml` row, including packages that are devDependencies in their own manifest. Sort
  by it and `hono` looks like a runtime risk. Use where the package is *declared*.
- **"`private: true`" ≠ "nobody gets it."** The starters are private but distributed by
  `npx tiged` (README:46). What actually makes them safe is **caret** pins (`hono: ^4.12.23`) that a
  user's own install resolves to a patched version. That property dies if a starter moves to an exact
  pin.
- **A Dependabot alert's manifest list UNDER-REPORTS scope.** It named only `civitai-blocks-react`;
  enumerating every `package.json` found `civitai-components-react` also carried `@vitest/browser`.
- **`gh pr view <n> --json mergeable` flaps.** `orch#305` read `UNKNOWN/UNKNOWN` then `MERGEABLE/CLEAN`
  ~3s later, twice on different days. **Poll twice before concluding anything.**
- **Squash merges:** `git merge-base --is-ancestor` is always false afterwards. Every merge here was
  verified by CONTENT (`git show origin/main:<path> | grep -F`).
- **Dead end, unchanged:** `gh pr checks` green is worthless as evidence on the guard file. #234 was
  16/16 green while inert; #236 was 16/16 green while carrying the v2 overclaim.

## How to verify

```bash
R=civitai/civitai-app-starters
# 1. the guard ran in PUBLISH mode and asserted just-published versions
RUN=$(gh api "repos/$R/actions/runs?branch=main&per_page=8" \
  --jq '[.workflow_runs[]|select(.head_sha|startswith("ec8084d"))|select(.name=="Release")][0].id')
gh run view --repo $R --job "$(gh api repos/$R/actions/runs/$RUN/jobs --jq '.jobs[0].id')" --log \
  | grep -aE "New tag|package\(s\) from|confirmed"
# expect: New tag app-sdk@0.35.0, "5 package(s) from $GITHUB_SHA (ec8084d)", 5/5 confirmed

# 2. INDEPENDENT of the guard — npm directly, with a negative control
curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/@civitai/app-sdk/0.35.0   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/@civitai/app-sdk/99.99.99 # 404

# 3. the guard suite, in BOTH environments — a green run in only one is how defect 3 shipped
WT=/home/zach/workspace/civit/civitai-app-starters
pnpm --dir "$WT" test:guards                                   # expect 56/56
GITHUB_SHA=deadbeef NPM_REGISTRY=http://127.0.0.1:9 PUBLISH_CHECK_FROM_DISK=1 \
  pnpm --dir "$WT" test:guards                                 # expect 56/56

# 4. catalog drift is closed (run from a CLEAN tree — this reads the LIVE spec)
(cd "$WT" && node scripts/check-orchestrator-catalogs.mjs)     # expect: No drift, 45 + 12

# 5. the CI wedge is bounded at both sites
git -C "$WT" show origin/main:.github/workflows/ci.yml | grep -c "timeout-minutes: 15"   # expect 2

# 6. criticals are gone
gh api "repos/$R/dependabot/alerts?state=open&per_page=100" \
  --jq 'group_by(.security_advisory.severity)[]|"\(.[0].security_advisory.severity): \(length)"'
# expect NO critical row
```
