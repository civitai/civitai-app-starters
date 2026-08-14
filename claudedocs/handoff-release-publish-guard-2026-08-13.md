# Handoff: release publish-guard — 2026-08-13

## Goal

Close ranked items #1 and #3 from `<datapacket-talos>/claudedocs/handoff-appblocks-consent-chain-shipped-2026-08-12.md`:
unblock the release workflow's approval gate, and close the booked gaps around `check-starter-pins.mjs`.
Both landed. Item #3's guard then broke the release workflow and took four rounds to get right — that
arc is the substance of this doc.

## State now

- **Branch/PR:** nothing of mine open on this work. `origin/main` = `aef91b3`. Base clone re-synced
  (`merge --ff-only`); every worktree from this session and its audit agents removed.
- **`main`: GREEN.** All three runs on `dd7a426` and all three on `aef91b3` (Release, CI, Push on main).

### Merged 2026-08-13 (evening session)

| PR | sha | what |
|---|---|---|
| #236 | `dd7a426` | F1 fix — the FLOOR names the ref and can see unusable manifests. **3 audit rounds.** |
| #231 | `aef91b3` | the Version PR — **published `@civitai/app-sdk@0.34.0` + `@civitai/blocks-react@0.42.0`** |

- **Issue #235** (F1) filed, then auto-closed `COMPLETED` at `21:00:18Z` — one second after #236 merged.

### Verified — and the distinction still matters

- **PUBLISH MODE IS NOW EXERCISED.** This was the gap the previous handoff left open: every prior run
  confirmed versions *already* on the registry. On `aef91b3` the guard asserted versions the job had
  just published, from the merged Version PR commit:
  ```
  21:09:56  🦋 New tag: @civitai/app-sdk@0.34.0
  21:10:01  registry … 5 package(s) from $GITHUB_SHA (aef91b3)
  21:10:02  OK @civitai/app-sdk@0.34.0 is on the registry  …  5/5 confirmed, 0 missing
  ```
  Confirmed INDEPENDENTLY against npm (not the guard's own report): both 200 with matching
  `.version`, and a negative control `@civitai/app-sdk@99.99.99` → 404.
- **#230 IS VERIFIED — the previous handoff was wrong to say it could not be.** It claimed
  verification needed a *new* Version PR; a **push** to the existing branch exercises the same path.
  The discriminator, over all 79 runs on `changeset-release/main`:
  - pre-#230: every `github-actions[bot]` first-attempt run parked `action_required`; only manual
    `attempt=2` re-runs ever executed.
  - post-#230 (00:25Z on): 5 runs, all `attempt=1`, `actor=ZacxDev`, all `success`, none parked.
  What is proven is the `synchronize` (push) path — the failure mode #230 named. The `opened` run was
  already PAT-authored pre-fix.

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

## Next steps (ranked)

1. **`@vitest/browser` bump + re-file issue #106.** RECOMMENDED, not started — awaiting go-ahead.
   #106's title says "12 open alerts (2 critical)"; live is **44 open, 4 critical** (measured
   2026-08-13). That title is what people triage from, which is why it has sat. Substance is narrower
   than the count: all 4 criticals are 2 advisories × 2 manifests, both `@vitest/browser`, a
   **devDependency of `civitai-blocks-react`** — nothing ships to consumers; the real exposure is a CI
   runner executing browser-mode tests on PR branches. Close #106 and re-file with live counts and an
   explicit shipped-vs-dev-only split rather than editing it. Leave the 19 high / 20 moderate until
   there is a policy — 6 open Dependabot PRs, nothing gating them.
2. **Decide on pinning `changesets/action` to a SHA.** Unchanged, still the operator's call. `v1` is a
   moving BRANCH (no `refs/tags/v1`; `v2.0.0` shipped 2026-08-11), so the guard's whole premise can
   change with no diff here.
3. **Make `Starter pins vs published` blocking.** Confirmed as predicted: it PASSES on every PR but is
   not among the 8 required contexts (`gh api repos/…/branches/main/protection`). A branch-protection
   change under `enforce_admins: true`, not a code change. ⚠️ Also observed: `strict: false`, so PRs
   are not required to be current with `main` — a green PR is not a claim about the merged tree.
4. **Not mine:** `civitai-orchestration#305` (cross-user write/delete/spend) still **OPEN**, now
   `MERGEABLE/CLEAN`. 🔴 It reported `UNKNOWN/UNKNOWN` on one poll and `MERGEABLE/CLEAN` on the next
   ~30s later — GitHub had simply not computed it; **poll twice before drawing any conclusion.**
   Blocker still looks like the 11 breaking `getWorkflow` call sites in `civitai/civitai`; a PR-title
   search surfaced no companion PR (that is "none surfaced", not "none exists" — it searched titles
   and bodies, not code).

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

## How to verify

```bash
R=civitai/civitai-app-starters
# 1. the guard ran in PUBLISH mode and asserted just-published versions
RUN=$(gh api "repos/$R/actions/runs?branch=main&per_page=6" \
  --jq '[.workflow_runs[]|select(.head_sha|startswith("aef91b3"))|select(.name=="Release")][0].id')
gh run view --repo $R --job "$(gh api repos/$R/actions/runs/$RUN/jobs --jq '.jobs[0].id')" --log \
  | grep -aE "New tag|package\(s\) from|confirmed"
# expect: New tag 0.34.0/0.42.0, then "5 package(s) from $GITHUB_SHA (aef91b3)", 5/5 confirmed

# 2. INDEPENDENT of the guard — ask npm directly, with a negative control
curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/@civitai/app-sdk/0.34.0   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/@civitai/app-sdk/99.99.99 # 404

# 3. the guard suite, in BOTH environments — a green run in only one is how defect 3 shipped
WT=/home/zach/workspace/civit/civitai-app-starters
pnpm --dir "$WT" test:guards                                   # expect 56/56
GITHUB_SHA=deadbeef NPM_REGISTRY=http://127.0.0.1:9 PUBLISH_CHECK_FROM_DISK=1 \
  pnpm --dir "$WT" test:guards                                 # expect 56/56

# 4. #230 — now verifiable; first-attempt runs must not park
gh api "repos/$R/actions/runs?branch=changeset-release/main&per_page=20" \
  --jq '.workflow_runs[]|"\(.created_at) attempt=\(.run_attempt) actor=\(.actor.login) \(.conclusion)"'
# expect recent first-attempt runs: actor=ZacxDev, NOT action_required
```
