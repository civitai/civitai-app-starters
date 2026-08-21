# Handoff: release publish-guard — 2026-08-13

## Goal

Close ranked items #1 and #3 from `<datapacket-talos>/claudedocs/handoff-appblocks-consent-chain-shipped-2026-08-12.md`:
unblock the release workflow's approval gate, and close the booked gaps around `check-starter-pins.mjs`.
Both landed. Item #3's guard then broke the release workflow and took four rounds to get right — that
arc is the substance of this doc.

## State now

- **Branch/PR:** nothing of mine open. `origin/main` = `8568f8d` (this doc, via #246). Base clone
  re-synced (`merge --ff-only`); every worktree this session created is removed.
  ⚠️ `git worktree list` still shows several under `/tmp/wt-*` and `civitai-app-starters-*` —
  `batchd-contract-sdk`, `consentfix`, `longpoll-sdk`, `sdk-inline-docs`, `handoff2`, and ~30 named
  siblings. Those are **other sessions'**, predate this work, and must not be removed (broad-glob
  worktree cleanup has destroyed other agents' running jobs before).
- **`main`: GREEN.** All runs green on every merge below.
- 🔴 **PR #243 was CLOSED, not merged** — it was an earlier refresh of this same doc, written before
  the 2026-08-20 work, and its ranked items 3 and 4 had become wrong (see below). Everything in it
  that was still true has been folded into this doc; nothing was lost. Do not reopen it.

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
| #244 | `729f328` | **`changesets/action` SHA-pinned + exact-sha guard. SIX audit rounds** |

Issues: **#235** filed → auto-closed by #236. **#106** closed → **#241** (rewritten Dependabot
triage, retitled 2026-08-20, **CLOSED 2026-08-21 with the policy decided** — see below). **#245**
filed — deferred observations from #244's audit rounds, **still open and now the top remaining item**.

### 2026-08-21 — the Dependabot queue is EMPTY, and not one of the four merged

| PR | outcome | how |
|---|---|---|
| #110 `@types/node` | **CLOSED by Dependabot** | rebase requested → *"no longer updatable, so this is no longer needed"* |
| #111 playwright group | **CLOSED by Dependabot** | same |
| #125 sveltekit group | **CLOSED by Dependabot** | same |
| #200 happy-dom | **CLOSED by hand** | Dependabot's update path failed on it 3× (auto 08-19T19:18Z, then `rebase`, then `recreate`), identical *"something went wrong"* each time |

Zero open Dependabot PRs remain (confirmed against `repos/…/pulls?state=open` directly — the
search-backed `gh pr list` still returned `1` for a few seconds after the close, and it was the
stale one). **Alert counts did not move**: 40 open / 0 critical, unchanged before and after, because
these PRs never covered the transitive lockfile entries that make up most of the count. That is
itself the argument for the policy below.

### Verified — independently, not from the tooling's own report

- **npm:** `app-sdk@0.35.0` and `blocks-react@0.42.0` both HTTP 200 with matching `.version`;
  negative control `app-sdk@99.99.99` → 404. The **published tarball** for 0.35.0 was unpacked and
  contains `readonly miniMaxMusic3: "Music generation from a caption + lyrics (MiniMax Music 3)"` —
  with `aceStepAudio` present (2) and a nonsense string absent (0) as controls, because a first
  attempt at that grep returned 0 for BOTH target and control (wrong nested path).
- **Dependabot:** 44 → **40 open, critical tier EMPTY** (19 high / 20 medium / 1 low, measured
  2026-08-20T01:03Z), confirmed by re-scan plus a positive control proving the query CAN see
  criticals (the four `@vitest/browser` rows now read `state=fixed`, `fixed_at 19:06:14Z`).
  Independently corroborated by GitHub's own push banner.
- **#230 fully verified, on BOTH paths.** The push path came from the actor split across 79 runs on
  `changeset-release/main` (pre-fix every `github-actions[bot]` first-attempt parked
  `action_required`; post-fix 5/5 `actor=ZacxDev`, none parked). The `opened` path was then exercised
  for real: #238's changeset created a **brand-new** Version PR (#239) whose first run was
  `attempt=1 actor=ZacxDev event=pull_request in_progress` — a parked run never reaches
  `in_progress`. That was the case the original doc said could not be verified.
- **#244 landed by CONTENT, not ancestry** (a squash merge never makes the branch head an ancestor):
  `origin/main:.github/workflows/release.yml` contains the pinned sha (1 hit, `grep -F`), the
  pre-merge `uses: changesets/action@v1` is gone (0 hits, negative control), and `dependabot.yml` is
  byte-identical to `b335c0e`.

### Branch protection — CHANGED 2026-08-20

**9 required contexts** (was 8), `strict=false`, `enforce_admins=true`, no rulesets, auto-merge
disabled, **no required reviews**. Added: `design-system (theme + components + components-react)` —
a hermetic job gating three published packages (`@civitai/theme`, `@civitai/components`,
`@civitai/components-react`) that was somehow never required while its two siblings were.

Rollback if wanted: `PATCH repos/<owner>/<repo>/branches/main/protection/required_status_checks`
with the 8-context list. Use the sub-resource PATCH, never a whole-object PUT — a partial PUT
silently drops `enforce_admins` and friends. Verified after the change by diffing the full
protection object: exactly one context added, nothing removed, no sibling setting touched.

**Stranded-PR check, done:** #32 and #34 were already blocked before this change (#34 was missing
ALL 8 prior contexts, #32 was missing `README snippets`), so it stranded nothing that wasn't
already stranded. All 4 Dependabot PRs report `design-system=SUCCESS`.

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

### 🔴 RESOLVED 2026-08-21 — the four Dependabot PRs were never rebased, and "nothing gating them" was wrong

The 2026-08-13 doc said the 4 open Dependabot PRs had "nothing gating them, no auto-merge". **Both
halves of that were wrong by 2026-08-20**, in two layers, and the second only became visible after
probing the first. Kept because the *diagnostic* shape recurs, even though the PRs are now gone.

- **All four conflicted.** `gh pr view --json mergeable` said `CONFLICTING/DIRTY` for all of them
  (polled twice, ~2 min apart — it can return `UNKNOWN` before GitHub computes it).
  `git merge-tree --write-tree` against `origin/main`, **branching on exit code rather than grepping
  for `<<<<<<<` markers**, named the conflict on every one: `pnpm-lock.yaml` on all four, plus
  `packages/civitai-blocks-react/package.json` on #200. Cause was #240's `@vitest/browser` lockfile
  rewrite (`0121810`), the only lockfile-touching commit on `main` since they were opened.
- 🔴 **None of them had ever been rebased, so every one of their 13/13-green runs was a claim about
  a PRE-#240 tree.** Their `updatedAt` bumps at 19:07–19:18Z read exactly like successful rebases
  and were not — they were GitHub recomputing mergeability after #240 landed. **The discriminator
  is the bot's own comment history, not `updatedAt`**: #200 carried a `Dependabot tried to update
  this pull request, but something went wrong` comment, and #110/#111/#125 carried *no bot comments
  at all*, i.e. no attempt had ever been made.
- 🔴 **`@dependabot rebase` and `@dependabot recreate` on #200 both reproduced the same bot-side
  error**, so it was never a conflict Dependabot could resolve. Three failures total.
- **The control that separated the two hypotheses:** rebasing a *sibling* (#111) distinguished
  "Dependabot is broken for this repo" from "#200 specifically is stuck". #111 answered within a
  minute — Dependabot closed it as *"no longer updatable"* — proving the bot path was healthy and
  #200 was individually wedged. Without that control, three failures on one PR read equally well as
  a repo-wide outage.
- **The operational fact that constrained every policy option:** all four contended for one
  `pnpm-lock.yaml`, so merging any one would have invalidated the other three. There was no batch
  merge available; it was N sequential recreate-and-wait cycles regardless of policy. (Moot in the
  end — three were obsolete and closed themselves.)

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
  ⚠️ ~~Dependabot **#111 (playwright group)** touches this exact step — expect it to re-roll the
  dice.~~ **Retired 2026-08-21: #111 was closed by Dependabot as no longer updatable**, so that
  re-roll will not happen. The wedge remains un-diagnosed and the 15m bound is still the only
  mitigation — the next Playwright bump, whenever it is filed, is the next chance to catch it live.

## Next steps (ranked)

1. ✅ **DONE 2026-08-21 — the Dependabot policy is decided and #241 is CLOSED.**
   Policy, written into #241 as a comment before closing: **dev-only alerts are accepted risk and
   the aggregate count is no longer tracked.** Act on an alert only when it is `critical`/`high`
   AND either (a) it affects one of the five published packages, or (b) it is in tooling that
   executes PR-branch code in CI (the `@vitest/browser` case, #240). Everything else — transitive
   lockfile entries, build tooling, starter devDependencies — merges opportunistically or not at
   all. **No sweep is scheduled and no backlog is owed.**

   Rejected, with reasons recorded in the issue: **auto-merge** (a SHA-pinned action bump is green
   on every required check because `release.yml` has no `pull_request` trigger, and only wedges
   *after* merge — closed for `changesets/action` by the exact-sha guard, but #245 records the
   `peter-evans` residue, so the class is not fully closed; if ever revisited it must exclude the
   `github-actions` ecosystem); a **`dependabot.yml` ignore** (blocks the notification, not the
   merge, and suppresses security PRs — #244 round 2); a **monthly batch** (a recurring slot spent
   maintaining a number with no user-facing meaning).
2. **🔴 DO NOT make `Starter pins vs published` a required context.** Previously ranked as a next
   step; investigated 2026-08-20 and the answer is no. Two independent reasons:
   - `ci.yml` carries an explicit in-repo policy on the sibling `design-system-drift-guard` job:
     *"Because it can fail for reasons outside this PR … it is kept ADVISORY — do NOT add it to
     branch protection. This mirrors the sibling live-dependent `Canonical schema drift-check` job."*
     `check-starter-pins.mjs` fetches `registry.npmjs.org`, so it is the same class.
   - Its **designed** failure is a repo-state condition ("a release left the starter pins behind"),
     not a PR condition — so the next release that outpaces the pins blocks **every open PR**. And
     with `enforce_admins: true`, a failed publish — precisely what it detects — would red it and
     block every merge in the repo **including the fix**. It converts a publish outage into a total
     merge lockout.

   The genuine gap that *did* exist here was `design-system`, now closed (see State now).
3. **Work #245** — deferred observations from #244's audit rounds. Highest-value item: the
   `peter-evans/create-pull-request` label residue (editing the `# vX.Y.Z` label and
   `PINNED.version` *together* still lies, because unlike `changesets/action` it has no third copy
   in `RELEASING.md` to cross-check). Also records why grouped Dependabot action PRs now go red as
   a unit, and that the npm-ecosystem `ignore` entries were never revisited under the same argument.
4. **Not mine:** `civitai-orchestration#305` (cross-user write/delete/spend) still **OPEN** and has
   decayed to `CONFLICTING/DIRTY` (untouched since 2026-08-11; `main` moved out from under it).
   Blocker still looks like the 11 breaking `getWorkflow` call sites in `civitai/civitai`; a PR
   title/body search surfaced no companion PR — that is "none surfaced", not "none exists" (it did
   not search code). 🔴 Poll `mergeable` **twice**: it returned `UNKNOWN` then `CONFLICTING` ~30s
   apart, because GitHub had simply not computed it yet.

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

### #244: six audit rounds, and FOUR of the defects were in replacement text written while fixing the previous one

This is the same shape the F1 arc showed, reproduced end to end on a different change. Worth reading
before touching `tests/guards/workflow-action-pins.test.mjs` or the release workflow.

| round | what it found |
|---|---|
| 1 | 🔴 **Architectural miss.** SHA-pinning *hands the ref to Dependabot*. `@v1` was a branch it never touched; a 40-hex sha is exactly what it bumps. `release.yml` has no `pull_request` trigger, so that bump is green on every PR check, merges, then wedges the release lane on v2's renamed inputs. |
| 2 | 🔴 The fix (a `dependabot.yml` major-`ignore`) was blunter than its own comment claimed — `v1.9.0` is the LAST v1.x tag, so it meant *zero* PRs forever; and `ignore` also suppresses **security** PRs. |
| 3 | 🔴 The replacement KNOWN LIMITS claimed a wrong version label "is caught". It was not — two mutants survived 5/5, and the file contradicted itself 150 lines down. |
| 4 | Two false measurements + the guard-the-guard was a *spelled* guard (three one-line disarms survived). |
| 5 | 🔴 The "more structural" rewrite **lost a property the crude regex had** — `[\s[,]` matches the space in `  # pull_request:`, so a commented-out trigger satisfied it, 6/6 green. |

🔴 **The `7be170e` discovery reframes the whole thing.** The `peter-evans` pin was commented `v6.1.0`
while the sha was `v8.1.1` — two majors stale. That was not sloppiness: `7be170e` ("bump the actions
group across 1 directory with 3 updates", #175) was Dependabot bumping it across a major and leaving
the full-line comment above untouched. **The mislabel and the 🔴 are the same mechanism.**

- 🔴 **A Dependabot `ignore` is the wrong instrument for "don't let this bump silently".** It blocks
  the *notification*, not the *merge*, and it suppresses security PRs. The right shape here was an
  **exact-sha assertion in a test that already runs in a required, `pull_request`-triggered context**
  (`ci.yml`'s `Starter` job runs `pnpm test:guards`). That supplies the PR coverage a `push`-only or
  `schedule`-only workflow structurally lacks. Blocking the merge is what you want; blocking the
  notification is not.
- 🔴 **A shape check passes a breaking bump.** `is it 40 hex?` was satisfied 5/5 by swapping the pin
  to `changesets/action` v2.1.1 — which renames every input `release.yml` passes. Assert the VALUE.
- 🔴 **An overstated LIMIT is still a false claim.** Adding a `RELEASING.md` cross-check *narrowed*
  the residue, which made the freshly-written "this still lies" limit wrong in the other direction.
  Limits get measured per case and enumerated, not asserted in general.
- 🔴 **A mutant that never landed reports green and reads exactly like a survivor.** One `Y1` mutant
  was mangled by shell quoting, reported 6/6, and was discarded unscored; re-run from a **file** it
  died immediately. Every mutant here proves landing (`grep -F` the new text) before being scored.
- 🔴 **Stop writing test COUNTS into comments.** The `PINNED = {}` figure was wrong three rounds
  running — always because the same commit that cited it also added a test. A count is a fact about
  a tree; the comment is about a mechanism.
- **`enforce_admins: true` + `required_pull_request_reviews: none`** — an audit round asserted
  `required_approving_review_count: 1`; the live read says none. Re-derive protection, don't quote it.

### 🔴 The recurring shape: a query defect that renders identically to a real finding

Every one below produced a confident wrong reading that only a **control** caught. The cure is
always the same: feed the instrument a case that MUST move the number, and report the pair.

- `grep` on a nested path returned **0 for both the target and the control** — the path was wrong,
  not the tarball.
- An unanchored `git log -p … | grep changesets/action` returned **22 lines, 3 relevant**; the rest
  were commit-message and comment prose merely mentioning it.
- A `severity=critical` query returning nothing is indistinguishable from a query wired to nothing —
  hence the positive control now written into #241's re-measure snippet.
- `git ls-remote … | grep 'refs/tags/v1$'` finding nothing is only meaningful *alongside* a match
  that does fire; `refs/heads/v1` was the discriminator that proved `@v1` was a branch.
- A `cd ""`-class trap in a mutation harness: `$$` differs per Bash tool call, so a
  `worktree remove /tmp/wt-$$` cleanup targeted a path that never existed and reported failure while
  the real worktree survived. Resolve the exact path from `worktree list`, never rebuild it.
- 🔴 **A field that moves for an unrelated reason reads exactly like the event you wanted.** Four
  PRs' `updatedAt` moved at the moment #240 merged, which was read as "Dependabot rebased them".
  It had not — GitHub had recomputed mergeability. The discriminator was a *different surface*
  entirely (the bot's own comment history) and it said the opposite. **Ask which surface would
  DIFFER between the two mechanisms** before believing the one that is convenient.
- 🔴 **A settle-poll needs a predicate for the thing you ASKED FOR, not just for terminal state.**
  A monitor requiring "≥13 checks, none pending" settled on its FIRST poll against the stale
  pre-rebase run — every check was terminal because they had all finished days earlier. The missing
  predicate was `head sha != the sha recorded before requesting the rebase`. This is the
  empty-conclusion false-settle trap with a different field missing: **enumerate what MUST CHANGE,
  not only what must stop moving.** (Fixed mid-session; the corrected watch also exits on
  `CLOSED`/`MERGED`, because a bot closing the PR is a terminal outcome a checks-only poll cannot
  see and would have burned the full timeout on.)
- 🔴 **A `gh pr list` count can disagree with `gh pr view` on the same PR, and the LIST is the stale
  one.** Seconds after #200 was closed, `gh pr view` said `CLOSED` while the search-backed
  `gh pr list --state open` still returned 1. `repos/…/pulls?state=open` (direct, not search-backed)
  agreed with `pr view`. **When two GitHub reads disagree, prefer the direct object read** — the
  search index lags writes.

## How to verify

```bash
R=civitai/civitai-app-starters
A=/home/zach/workspace/civit/civitai-app-starters

# 1. #244 landed by CONTENT (a squash merge is never an ancestor)
git -C "$A" show origin/main:.github/workflows/release.yml \
  | grep -cF 'changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d # v1.9.0'   # 1
git -C "$A" show origin/main:.github/workflows/release.yml \
  | grep -cF 'uses: changesets/action@v1'                                            # 0 (control)

# 2. the pin guard is armed AND red-able — run it, then break it on purpose
(cd "$A" && node --test "tests/guards/"*.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)')  # 62/62
# ...and in the CI environment, which is how defect 3 of the F1 arc shipped:
(cd "$A" && GITHUB_SHA=deadbeef NPM_REGISTRY=http://127.0.0.1:9 PUBLISH_CHECK_FROM_DISK=1 \
  node --test "tests/guards/"*.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)')            # 62/62

# 3. branch protection is 9 contexts, and design-system is one of them
gh api "repos/$R/branches/main/protection" \
  --jq '"\(.required_status_checks.contexts|length) contexts"; .required_status_checks.contexts[]'

# 4. Dependabot counts — WITH the positive control, never the zero alone
gh api "repos/$R/dependabot/alerts?state=open&per_page=100" \
  --jq 'group_by(.security_advisory.severity)[]|"\(.[0].security_advisory.severity): \(length)"'
gh api "repos/$R/dependabot/alerts?per_page=100&severity=critical" \
  --jq '.[]|"\(.number) \(.state) \(.dependency.package.name)"'
#   Expect SIX state=fixed rows: 4x @vitest/browser (closed by #240) + 2x happy-dom (closed
#   earlier). An empty result means the QUERY is wrong, not the repo clean. Do not expect "4" —
#   the 2026-08-13 revision of this doc said 4 because its control was scoped to the @vitest
#   ones only, and a reader checking for exactly 4 would misread a correct control as a failure.

# 5. the Dependabot queue is empty — direct read, NOT the search-backed `gh pr list`
gh api "repos/$R/pulls?state=open&per_page=100" \
  --jq '[.[]|select(.user.login=="dependabot[bot]")]|length'      # 0
```
