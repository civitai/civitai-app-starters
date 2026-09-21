# Handoff: app-starters-launch-audit — 2026-09-20

## Run this first — the index, one command
```bash
cairn recall --repo /home/zach/workspace/civit/civitai-app-starters
```
Terse pointers this doc does not carry, curated by past sessions and outliving it.
🔴 RECALL, NOT LIVE OBSERVATION — every line is a pointer to VERIFY, never a current
reading, and it may describe a gotcha already fixed. `scope-absent`/`scope-empty` means
nothing is recorded yet: ordinary, not an error, and not a clean bill of health.
Non-blocking: if it exits non-zero, print the stderr line and carry on.

## Goal
Audit `civitai-app-starters` before the Apps Platform launch distributes `@civitai/app-sdk`
and `@civitai/blocks-react` to many external developers, then fix what blocks launch.
Audited for code quality, dead code, over-exporting, comment rot, and bloat.

- **closing-condition:** `check` — every finding the audit classified launch-blocking is
  either published to npm or filed as a GitHub issue with its own closing condition.
  Verify: `gh issue list --repo civitai/civitai-app-starters --state open --label bug`
  returns no issue whose body says "launch-blocking" and is unreferenced by a merged PR.

## State now

- **Round-1 DoD: ADDRESSED (its check is vacuous — see Gotchas). That arc is CLOSED.**
- **Published 2026-09-21T02:44Z and verified three ways with controls:**
  `@civitai/blocks-react@0.55.1`, `@civitai/components@0.4.2`, `@civitai/components-react@0.4.2`.
  Merged #361 (`b22670b`), #359 (`e06173f`), Version PR #365 (`8971ba3`). No partial publish.

### Open now
| PR | head | state | what |
|---|---|---|---|
| **#366** | `c58038d` | OPEN/MERGEABLE/CLEAN, CI 13/13 | App Storage error fidelity (#343) — **round 0 done, round 1 NOT run** |
| **#356** | — | OPEN | this handoff doc |

- **#346 CLOSED** (not merged) with reasoning + 3 checkable reopen conditions; branch preserved.
- **Issues open:** #343 (being closed by #366), #345, #347, #348, #349, #357, #358, #362, #363,
  **#367** (no CI `changeset status`), **#368**, **#369** (the two mock divergences), #364.
  Plus 6 dependabot PRs including `zod 3 → 4` (a major on a published SDK's dep).
- **IN FLIGHT:** nothing. Worktree `civitai-app-starters-storagefidelity` still exists for #366.

### Rank 1 of the previous list turned out to be ALREADY DONE
`civitai/cli`'s `page-money` templates no longer import `createLiveHost` or `mockParentMessage`;
the pin is `^0.55.0`, not `^0.53.0`. Verified by typechecking the exact template import set against
published `0.55.1` (clean) with a negative control importing `mockParentMessage` (fails with
`has no exported member`). **The investigation block for it is retired below.**

## Open investigations — live diagnosis state

### #334 item 3 — getting the `./testing` code out of the tarball (the only thing that moves install bytes)
- as-of: 2026-09-20
- **Symptom + exact repro:** `@civitai/blocks-react`'s tarball ships ~265 KB of testing-only
  JS to every production install. `npm pack @civitai/blocks-react@0.55.0 --dry-run --json`
  then sum `dist/internal/{mockHost,liveHost,pickerOverlay,catalog,consent}.js`.
- **Observed (with values):** published `0.55.0` still contains `dist/internal/liveHost.js`
  86,688 B · `pickerOverlay.js` 29,508 B · `catalog.js` 15,351 B · `consent.js` 4,697 B.
  Measured tarball delta across the `./live` split: **319 → 323 entries, 1,590,099 →
  1,597,161 B — net +4,447 B, the wrong direction.**
- **Ruled out:** "moving `createLiveHost` to its own subpath removes its module subtree
  from the tarball" — FALSE. `package.json` `files` is `["dist","README.md"]` and
  `tsconfig` `include` is `["src/**/*"]`, so the `exports` map governs only what a consumer
  can *name*, never what ships. `via: measurement` (two independent `npm pack` runs).
- **Ruled out:** "`consent.js` is exclusive to the live host" — FALSE, `mockHost.ts:74`
  imports it too. `via: code`.
- **Leading hypothesis:** only a second published artifact (a `-testing` package as a
  devDependency) or a `files`/build change that excludes the harness from `dist` moves the
  number. Nobody has costed either.
- **Next probe:** `node -e "const f=require('child_process').execSync('npm pack @civitai/blocks-react@0.55.0 --dry-run --json').toString();const j=JSON.parse(f)[0].files;const t=j.filter(x=>/internal\/(mockHost|liveHost|pickerOverlay|catalog|consent)\./.test(x.path));console.log(t.length, t.reduce((n,x)=>n+x.size,0))"`

### `civitai/cli`'s `page-money` scaffold template imports two symbols that no longer exist
- as-of: 2026-09-20
- **Symptom + exact repro:** `dev-transport.ts.tmpl:13` imports `createLiveHost` and
  `mock-buzz.ts.tmpl:33` imports `mockParentMessage`, both from
  `@civitai/blocks-react/testing`. Neither is exported there as of `0.55.0`.
- **Observed (with values):** `createLiveHost` moved to `./live` (#353); `mockParentMessage`
  was removed entirely (#351). Published `./testing` now exports exactly four values:
  `Harness, createMockHost, readMockHostUrlOptions, resetTransport` — read from the
  registry, not the workspace.
- **Ruled out:** "new scaffolds break today" — FALSE. The template pins `^0.53.0`, and a
  caret on a `0.x` version locks the minor, so `civitai app init` keeps resolving `0.53.x`.
  `via: measurement`.
- **Leading hypothesis:** latent. It breaks the first time someone bumps that pin.
- **Next probe:** in the `civitai/cli` repo (out of tree, not audited here):
  `find . -name '*.tmpl' -print0 | xargs -0 grep -n "blocks-react/testing"`

## Next steps (ranked)

1. **Run round 1 (the nine correctness axes) on #366 before merging.** Round 0 REPORTS and does not
   move the ladder, so #366 has had no correctness audit. Precedent from this arc: round 1 on #359
   found that its headline measurement credited the components split with deleting another
   package's CSS — not reachable from a requirements pass.
   `python3 ~/workspace/devrc/scripts/audit-dispatch.py 366 --round 1`
   forcing: gate
2. **Then merge #366 and publish.** It takes `@civitai/app-sdk` and `@civitai/blocks-react` both
   `minor`. 🔴 **Re-run `changeset status --verbose` immediately before merging** — the peer floor
   `>=0.49.0` is a PREDICTION about a version that does not exist on npm, and #367 exists because no
   CI job checks it. The new `PREDICTED ENTRY` guard reds if the base moved, but read the number
   yourself too.
   forcing: gate
3. **Issue #343 closes when #366 merges** — verify by the issue's own condition (mock emits no
   string the host cannot produce; the contract doc describes a message; kv-storage's branch is
   reachable), not by the merge.
   forcing: user
4. **Batch: everything filed with a closing condition** — #367, #368, #369, #358, #362, #363, #364,
   #345/#347/#348/#349/#357, and the undecided `@civitai/app-sdk` peer on `@civitai/client` at
   `^0.2.0-beta.98`.
   forcing: none
5. **The 22 HIGH audit findings that were never filed** — they survive only in a prior session's
   transcript. Reconstruct them or accept the loss explicitly.
   forcing: none

## Defects (batched)

- 22 HIGH audit findings remain UNFILED (rank 5).
- `pnpm lint` exits 1 repo-wide (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`). Pre-existing; no CI job gates it.
- `#361` shipped with round 0 only — the nine correctness axes never ran on it.
- `styles.generated.ts`'s `.d.ts` is un-annotated, so tsc inlines the sheet as a string-literal type
  (33 KB); the new slices annotate `: string`.
- `#366`'s fix commit `4266263` says "three genuinely different remedies" where `App.tsx` has four
  non-default arms. **Deliberately NOT corrected** — rewording it means force-pushing and detaching
  the PR's review threads. The correction is in the later commit message, the PR comment and the
  in-tree README.

## Gotchas / decisions / dead-ends

- 🔴 **`changeset version` will NOT raise a peer floor that is merely too LOW.**
  `onlyUpdatePeerDependentsWhenOutOfRange: true` means it never widens a range the new
  version already satisfies. This class has shipped broken **three times** (#309, #312,
  #344). If a package starts value-importing a new peer symbol, raise the floor **by hand
  in the same PR**.
- 🔴 **The `exports` map does not govern tarball contents** — `files` and `tsconfig include`
  do. Moving a symbol to a new subpath removes nothing from the install.
- 🔴 **A Version Packages PR can be STALE and still `MERGEABLE`.** Measured: #350 sat green
  showing `0.46.1` from one merge earlier, because #341's Release run had been **cancelled**
  by #344's push and only #340's succeeded. **Verify the bumps and changelog text, never
  `mergeStateStatus`.**
- 🔴 **A squash merge orphans a stacked PR.** #353 was stacked on #351; after #351
  squash-merged, retargeting #353 to `main` turned it `CONFLICTING` because the parent's
  commits are not ancestors. Rebase is required. And never
  `gh pr merge --delete-branch` a stacked parent — GitHub auto-closes the child and
  refuses to reopen it.
- 🔴 **Three of this session's briefs dropped the issue's own proposed fix**, and round 0
  caught each: #346 mandated a measurement that could not fail; #352's brief said
  "reconcile field-by-field" where #330 had asked to *derive from the schema with Ajv*;
  #351's brief said "keep `createLiveHost`" where #334's closing condition was to *remove*
  it. **Quote the issue verbatim into a brief; do not paraphrase its fix.**
- 🔴 **`pnpm -r test` runs only blocks-react's `unit` project.** The browser tier is a
  separate 73 tests needing `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` from
  `nix-shell -p chromium`. A green `pnpm -r test` says nothing about it.
- 🔴 **`gh api repos/<r>/actions/jobs/<id>/logs` returns ZERO BYTES** even with
  `--allow-escape-sequences`. Use `gh run view <run> --log-failed`, and assert a non-zero
  byte count before believing any grep over a CI log.
- **Dead end:** the audit artifact was published twice to claude.ai and deleted both times.
  Not republished. The 13 blockers survive as issues #322–#334 because they were written
  self-contained; the 22 HIGH findings did not survive.
- **Decision:** `./testing` is a normal `0.x` subpath — a minor may break it — with the
  symbol *set* ledgered so it cannot change silently. Type *shapes* are explicitly not
  frozen. (#334 item 4's first branch, chosen deliberately over semver-protection.)
- **Decision:** `defineBlock` derives every rule from the vendored canonical schema via Ajv,
  behind node-only `./manifest` and `./vite` subpaths with `ajv`/`vite` as optional peers.
  `./blocks` keeps zero runtime dependencies. 906 hand-written rule lines deleted.

- 🔴 **This doc's own round-1 closing condition is a NON-INSTRUMENT.** It greps issue bodies for
  `launch-blocking`, a marker **nobody ever wrote** — zero occurrences repo-wide, including in the
  13 issues the doc itself calls blockers. It can only ever return green. When writing a
  closing-condition that greps for a token, **grep for it once at write time and confirm a
  non-zero count**, or the condition is decorative. Verified here with both controls (16 hits on a
  known-present string; 0 on the token).
- 🔴 **`workspace:*` from a PUBLISHED package to an UNPUBLISHED one is a release hazard, and
  `pnpm` makes it sharper: on pack it rewrites `workspace:*` to an EXACT pin.** Measured:
  `@civitai/elements` and `@civitai/elements-react` both 404 on the registry;
  `@civitai/blocks-react` and `@civitai/components` both 200 (the control). Neither new package is
  `private`; neither is in `.changeset/config.json`'s `ignore`. This is why #346's seam was cut.
- 🔴 **CORRECTION made this session: "an eight-instance history of partial publishes" OVERSTATES
  the record.** That conflated eight RED `assert-published-versions` runs (the propagation-lag
  saga) with consumer-facing partial publishes, of which `RELEASING.md:110-200` documents **two**
  (2026-09-02, 2026-09-03). The hazard above stands on its own mechanism; do not re-cite the
  eight.
- 🔴 **happy-dom and Chromium disagree about invalid inline style values, and the unit tier is the
  misleading one.** For `<Stack gap="md">`: happy-dom yields `style="gap: md"`; **real Chromium
  writes no style attribute at all** (`getAttribute('style') === null`, `el.style.length === 0`)
  and computed gap falls back to `12px`. A unit-tier assertion on `style="gap: md"` measures
  happy-dom, not the bug. Both rows are in #357.
- 🔴 **The `@civitai/elements` byte case, with the numbers, so they survive this doc's next status
  replace.** esbuild, minified, ESM, React external, every row bundled identically
  (`pnpm --filter @civitai/elements measure`):
  **A.** `blocks-react/ui` Button, un-split baseline — total 52,568 B · JS 2,417 · CSS 50,151 ·
  gzip 12,478. **B.** the same Button with `@civitai/components`' sheet split in place (the
  CONTROL) — total **13,480** · JS 2,417 · CSS 11,063 · gzip 3,525. **C.** `@civitai/elements`
  custom element — total 21,309 · JS 11,154 · CSS 10,155 · gzip 6,247.
  **95.4% of the baseline is stylesheet text**; the control beats the custom element by **37%**
  (43% gzipped) with an IDENTICAL JS column, and the element's JS costs **4.6×** more
  (`@lit/reactive-element`, base classes, style adoption). So on bytes the control wins and the
  elements case must rest on one-implementation / form-association / framework-independence alone.
- **Decision: `useBlocksStyles()` injecting the WHOLE pack is a documented CONTRACT, not an
  oversight** — `packages/civitai-components/MARKUP.md` promises that rendering any `/ui`
  component also styles hand-written `data-civitai-ui="…"` markup elsewhere on the page, and
  `test/Stack.styles.test.tsx` exists because an earlier draft broke exactly that. So the CSS
  split lands as an ENABLING change (per-component exports, `componentsCss`/`injectStyles()` kept
  byte-identical) and the win is MEASURED but not realized; rewiring `/ui` onto per-component CSS
  breaks the contract and is a separate decision, filed as its own issue.
- **Decision: `Stack.styles.test.tsx` KEPT after the revert**, mutation-tested against the reverted
  `Stack.tsx` rather than assumed: commenting out `useBlocksStyles()` fails its 2 behavioural cases
  with **their own** assertions and they are the only 2 failures in 1508 tests; deleting call+import
  fails all 3. Its docblock now records the honest limit found on the way — the file-scan ledger
  greps for the *string* `useBlocksStyles()` and therefore SURVIVES mutant 1, so it is recorded
  rather than counted as behavioural coverage.
- **Dead end:** a concurrent session overwrote a file in the shared scratchpad mid-run. Name scratch
  files per-agent; subagents share one scratchpad path.

- 🔴 **A PR here can show a GREEN ROLLUP WITH NO CI RUN AT ALL.** On #359 the `opened` event did
  NOT trigger `ci.yml` — only CodeQL ran, and `GET /actions/runs?head_sha=<sha>` returned just the
  CodeQL run. No code was involved: closing and reopening the PR fired `reopened` and CI ran
  normally on the **same commit**, no rebase, no force-push. **Check that `ci.yml` actually ran for
  the head sha; do not read a green rollup as "CI passed".**
- 🔴 **`wc -c` and `String.length` disagree on this sheet — 31,970 vs 31,900 — because of em
  dashes.** A byte-count assertion must read `statSync().size`, never a re-encode of a JS string,
  or it pins the wrong number and a lossy slicer can satisfy it.

- 🔴 **`globalThis.process` and the bare `process` identifier are DIFFERENT THINGS to a bundler,
  and the distinction is load-bearing.** webpack/Next `DefinePlugin` replaces the literal member
  expression `process.env.NEXT_PUBLIC_FOO` and nothing else — `globalThis.process?.env?.[k]` is not
  a DefinePlugin key, so hoisting the key to a literal while KEEPING the `globalThis.` prefix
  leaves the bug intact and looks like a fix. Measured on Next 15.5.25, webpack and Turbopack.
- 🔴 **THE SHEET HAS TWO CROSS-SECTION CSS DEPENDENCIES, so "import one slice" is false.**
  Measured, three passes each with a positive control: (a) `components.css:477`
  `[data-civitai-ui='button'] [data-civitai-ui='loader']` plus the loader's base sizing live in the
  **Loader** section, so a Button-only slice renders `<Button loading>` as a 0×0 invisible element;
  (b) **Checkbox/Radio** depend on `[data-civitai-ui-label]`'s base typography (`:129`) which lives
  in the **TextInput** section. `@keyframes` coupling: 0 (`civitai-ui-spin` is defined and used in
  Loader only). A measurement of THIS sheet, not a general guarantee.
- 🔴 **A PUBLIC EXPORT VOCABULARY DERIVED FROM COMMENT PROSE IS A TRAP.** #359 originally derived
  export slugs from the English inside `/* ----- X ----- */` titles plus a hand alias table, which
  minted `./css/tabs` — a subpath for a component that does not exist (`COMPONENT_NAMES` has 20
  entries, no `tabs`; the sheet has exactly 20 `data-civitai-ui` values, no `tabs`). Retitling a
  section to be MORE accurate would have removed a published export. Fixed structurally by deriving
  from the selectors each section contains. **The guard that missed it checked one direction only**
  ("every COMPONENT_NAME has a subpath"), so an EXTRA subpath was invisible — assert set EQUALITY,
  and watch it fail on GROW *and* SHRINK.
- 🔴 **ROUND 0 CHANGED AN OUTCOME HERE — record it for the trial-record pair.** On #359 it asked
  whether the `./css/*` export surface should EXIST yet, which no correctness axis asks: 42
  irreversible export keys, zero importers, on a package at ~1,451 downloads/month, freezing a
  vocabulary before #358 picks one. Operator held the exports. `ran: 1 · changed the outcome: 1`.
- **Decision (operator, this session): HOLD the `./css/*` export block.** The asymmetry that
  decided it — `dist/css/*.css` artifacts are reversible, `exports` keys on a published package are
  not. Land the slicer, `assertLossless`, the artifacts, the tests and the whole-pack pin; ship the
  subpaths once #358 picks a vocabulary.

- 🔴 **THIS REPO HAS NO COMMIT-STATUS PRODUCERS, so that surface is structurally empty and must not
  be read as a signal.** `gh api repos/<r>/commits/<sha>/status` returns `state=pending statuses=0`
  for **`main` itself** and for a PR that merged cleanly minutes earlier — the control that proves
  it. Read the **check-runs** rollup here (16/16 SUCCESS on #359's head). The general rule still
  holds elsewhere: the two surfaces are not supersets of each other and `CLEAN` is not a CI settle
  signal — get the terminal state from `actions/runs?head_sha=<sha>`.
- 🔴 **A MUTANT THAT FAILS TO APPLY REPORTS AS A CLEAN PASS.** While negative-controlling the
  merged tree I patched `detector.ts` with a string taken from memory; it matched 0 times, and the
  test run afterwards reported a reassuring **1520 passed** against the *unmutated* file. Only an
  `assert count == 1` before writing caught it. **Assert the occurrence count inside the mutation
  script, and treat a green mutant run as unproven until the mutation is confirmed applied.**
  (The same run also showed a vitest path filter silently not applying — 1520 tests ran, not 7.)
- 🔴 **zsh eats `:s` after an unbraced variable as a history modifier.** `git show "$B:scripts/x.mjs"`
  returned the **commit** instead of the file, silently and with rc 0. `git show "${B}:scripts/x.mjs"`
  works. Any conclusion drawn from that first read would have been wrong.
- 🔴 **`grep` over a source file cannot tell CODE from a DOCBLOCK QUOTING that code.** Verifying #361
  landed, a grep for `import.meta.env?.[` hit 1 and read as "🔴 the defect is still in `main`" — the
  match was line 42 of the explanatory comment. Strip comment lines first, and keep a positive
  control that finds the real reads.
- 🔴 **A clean git merge is not a clean merge, and the shared file here was `pnpm-lock.yaml`.** #359
  and #361 touch otherwise disjoint files but both added a devDependency. The discriminating check
  is `pnpm install --frozen-lockfile` on the merged tree (rc 0), not the absence of conflict markers.
- **Merged-tree evidence, recorded because each PR's own green was a claim about a tree that would
  not exist after the other landed:** integration branch off `503fe39` + #361 + #359 →
  `--frozen-lockfile` rc 0, build/typecheck rc 0, tests theme 25 · sdk 373 · components **21** ·
  components-react 50 · blocks-react **1520** (both PRs' fingerprints present together), guards
  `fail 0`, readme 53/1/0. **Negative control:** reintroducing the computed key on that merged tree
  turned **2 of 7** bundle tests red with their own assertions; restore verified byte-identical by
  sha256 and the file re-ran 7/7 green.
- **Decision (operator): HOLD the `./css/*` export block.** `dist/css/*` artifacts are reversible;
  `exports` keys on a published package are not. Ship the subpaths once #358 picks a vocabulary.
- 🔴 **Round 0 changed the outcome on BOTH PRs it ran on** (`ran: 2 · changed the outcome: 2`).
  On #359 it questioned whether the export surface should exist yet — 42 irreversible keys, zero
  importers — and the operator held them. On #361 it found the `PUBLIC_` reader has never resolved
  and is referenced nowhere but its own docstring (#362). Neither finding is reachable from a
  diff-scoped correctness round.

- 🔴 **`globalThis.process.env.X` IS NOT A `DefinePlugin` KEY — only the bare `process.env.X` member
  expression is.** This is the trap that makes the obvious fix inert: hoisting a computed key to a
  literal while keeping the `globalThis.` prefix looks correct, type-checks, and changes nothing.
  Measured on Next 15.5.25, webpack AND Turbopack, read after hydration (`typeof globalThis.process
  === 'undefined'` in the client bundle). Symmetrically, Vite substitutes `import.meta.env.LITERAL`
  and cannot analyse `import.meta.env[k]`, so a computed key makes it emit the ENTIRE env object.
- 🔴 **VERIFY A PUBLISH BY THREE SEPARATE CLAIMS, each with its own control:** the registry HAS it
  (parse the packument with `json.loads(strict=False)`; `jq` lies here), it RESOLVES
  (`npm install --dry-run --prefer-online`, with a known-good version as positive control and a
  non-existent one as negative), and the DEFECT IS GONE (reproduce the original failing path against
  the published tarball, with the OLD version bundled alongside as the control that proves the
  harness can still see the bug). A release run reporting success is a claim about the RUN.
- 🔴 **A "sentinel absent" assertion is worthless without three things:** a sentinel that cannot
  occur by coincidence (random hex, sharing no substring with any legitimate value), a non-empty
  artifact (assert the byte count — an empty build satisfies "absent" trivially), and a control
  build where the sentinel IS present.
- **Decision (operator): `@civitai/elements` (#346) CLOSED, not merged.** #359 shipped the control
  that retired its byte case; one-implementation is unmet by the PR's own admission (33 of 34
  collisions stand); form-association and framework-independence are real but unconsumed. Three
  checkable reopen conditions are on the PR; the branch is preserved.
- **Decision (operator): the `./css/*` export surface stays HELD** until #358 picks a vocabulary.
  `dist/css/*` artifacts are reversible; `exports` keys on a published package are not.

- 🔴 **RETRACTED — "the Playwright browser tier does not start on this host" IS FALSE.** An earlier
  entry in this doc claimed it was broken "pre-existing, confirmed by discriminating control". It is
  not: the tier passes **7 files / 73 tests**. What I actually hit was **an unbuilt workspace** —
  `--ff-only` merging into the base clone without reinstalling, then diagnosing with
  `pnpm --filter @civitai/blocks-react build`, **which does not build workspace dependencies** and
  emits 17 TS errors (`has no exported member`, `cannot find module @civitai/components`) that read
  exactly like a broken base branch. **Run the ROOT `pnpm build` before believing any red here.**
- 🔴 **A LEDGER ENTRY FOR AN UNPUBLISHED VERSION IS A PREDICTION WEARING A MEASUREMENT, AND THE
  OBVIOUS GUARD FOR IT DISENGAGES EXACTLY WHEN NEEDED.** `blocks-react`'s peer floor on
  `@civitai/app-sdk` is `>=0.49.0`; **`0.49.0` does not exist on npm** (latest `0.48.0`). If another
  app-sdk `minor` publishes first it takes `0.49.0`, these symbols land in `0.50.0`, and a consumer
  installing `app-sdk@0.49.0` + `blocks-react@0.56.0` gets **no peer warning** and dies at module
  evaluation. That is #309/#317/#344 for a fourth time. 🔴 The proposed fix — *detect a prediction
  by `entry == next`, then assert `floor === next`* — **is wrong**: after the rebase `next` becomes
  `0.50.0` while the entry stays `0.49.0`, so the detector stops firing at the moment it matters.
  The shipped guard instead **declares** the predicted entries and asserts both that each names the
  tree-derived version and that `floor === next`. Durable gap filed as **#367**: no CI job runs
  `changeset status`, so prose in a comment is otherwise the only protection.
- 🔴 **A `git grep` for a symbol counts DECLARATIONS, not CONSUMERS — and a guard that imports a
  module BY FILE PATH does not justify that module's barrel export.** Round 0 on #366 found four of
  nine new public exports with zero consumers; one, a frozen message array, invited
  `MESSAGES.includes(err.message)` — equality against a snapshot, the exact matcher shape the PR
  exists to eliminate. Not shipping a public export is free; removing one later costs a `minor`.
- **Decision: do NOT force-push to correct a commit message on a PR with review threads.** Record
  the correction in a later commit and a PR comment instead.

- 📍 **Where the `0.55.1` / `0.4.2` release evidence LIVES, since this doc's status section is
  replaced on every update.** The three-stage validation — registry resolve with positive *and*
  negative controls, published-tarball bundle repro, and a real `civitai-block-starter` `vite build`
  — was measured on 2026-09-21 and the full tables are a **comment on issue #360**, which is durable
  and will outlive any rewrite here. The headline pair, so a reader knows what they are looking for:
  the decoy sentinel appears in **0** files at `0.55.1` and **1** file at `0.55.0`, in both the
  direct bundle and the real starter build, with both artifacts non-empty. The *method* is the
  "VERIFY A PUBLISH BY THREE SEPARATE CLAIMS" entry above; the *numbers* are on #360.

## How to verify

`4a359be` — that the release hazard is actually gone (the point of the change):

```bash
R=/home/zach/workspace/civit/civitai-app-starters
git -C $R show origin/feat/civitai-elements-phase1:packages/civitai-blocks-react/package.json \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['dependencies'])"
# => {'@civitai/components': 'workspace:*', '@civitai/theme': 'workspace:*'}  — no elements

git -C $R diff --stat main..origin/feat/civitai-elements-phase1 \
  -- packages/civitai-blocks-react/src/ui/Stack.tsx      # => empty (identical to main)
```

Registry state, with its control (a 404 alone cannot distinguish "unpublished" from "probe broken"):

```bash
for p in @civitai/elements @civitai/elements-react @civitai/blocks-react @civitai/components; do
  printf '%s -> %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' \
    "https://registry.npmjs.org/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$p")")"
done   # => 404 404 200 200
```

Rank 1, reproduce the leak against the PUBLISHED tarball (not the workspace):

```bash
cd "$(mktemp -d)" && printf '{"name":"v","private":true,"type":"module"}' > package.json
npm i @civitai/blocks-react@0.55.0 --silent --prefer-online
find node_modules/@civitai/blocks-react/dist -name 'detector*' -print0 \
  | xargs -0 grep -nE 'import\.meta\.env'
# => dist/internal/detector.js:33:  const fromImportMeta = import.meta.env?.[key];
```

Repo-side, and note `pnpm -r test` runs ONLY blocks-react's `unit` project:

```bash
pnpm -r typecheck && pnpm -r test && pnpm test:guards && pnpm typecheck:readme
nix-shell -p chromium --run 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
  pnpm --filter @civitai/blocks-react test:browser'
```
