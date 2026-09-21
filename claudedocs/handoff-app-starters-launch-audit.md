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

- **DoD VERDICT (round-1 closing-condition): ADDRESSED, and the check that says so is VACUOUS.**
  It greps open `bug` issues for "launch-blocking"; that string appears in **ZERO** issues repo-wide,
  including all 13 the doc designates blockers. Control: a known-present string in #343 returned 16
  hits, so the zero is real. Substance verified by hand — all 13 filed, each with a
  `## Closing condition`. **That arc is CLOSED.** Everything below belongs to the follow-on arc.

### Merged this session
| PR | squash commit | what |
|---|---|---|
| **#361** | `b22670b` | `detector.ts` env-inlining security fix (leak + silent miss) |
| **#359** | `e06173f` | per-component CSS slices, `./css/*` export surface HELD |

🔴 **Verified by CONTENT, never ancestry** — a squash merge never makes the branch head an ancestor,
so `git merge-base --is-ancestor` reports "not merged" forever. `origin/main` now has: zero computed
env accesses in `detector.ts` **once comment lines are stripped** (5 literal reads found by the same
search as the positive control); `@civitai/components` `exports` still exactly `.` + `./styles.css`;
`files` carrying `"!dist/css"`; slicer, guards and `measure-css-split.mjs` present.

- 🔴 **NOTHING IS PUBLISHED YET.** The merges opened **Version Packages PR #365**, which plans
  `@civitai/blocks-react@0.55.1` (patch) and `@civitai/components@0.4.2` (patch). **Merging #365 is
  what publishes.** Until then the env leak is still live in the published `0.55.0`.
- **#346 remains OPEN** (`4a359be`) — seam stripped, no longer a release hazard, awaiting the
  architectural decision. 🔴 It is now **4+ commits behind `main`** and CI has never run on it.
- **Issues filed this session:** #357 (`Stack gap="md"` silently 12px), #358 (the whole-pack contract
  question — title and body corrected to carry both figures with their precondition), #360 (the env
  leak), #362 (`PUBLIC_` SvelteKit reader never resolved), #363 (nothing observes the property on
  built `dist/`), #364 (598 lines of TS outside every typecheck gate).
- **Audit ladder on #359: round 0 → round 1 → round 2, ENDED at round 2.** Claims blocks posted as
  PR comments (issue comments, not review comments — the assembler reads only the former).
  Round 0 and round 1 each produced findings that were fixed; round 2 returned **safe to merge, no
  🔴**, and its findings were fixed prose-only. Payload ledger: round 1 = 246, round 2 = 40, so the
  attribution gate never fired. **#361 had round 0 only** — its round 1 was never run.
- **IN FLIGHT:** nothing. All agents finished; all session worktrees removed; base clone re-synced
  `--ff-only` to `e06173f`.

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

1. **Decide whether to merge Version Packages PR #365 — this is the publish.** The `detector.ts`
   leak (`VITE_LIVE_BLOCK_TOKEN` inlined into every block app's production bundle) is **live in the
   published `0.55.0`** and stays live until `0.55.1` ships. Verify the changelog text and the
   planned bumps before merging, never `mergeStateStatus`: a Version PR can be STALE and still read
   MERGEABLE (measured on #350 this arc).
   forcing: security
2. **Run round 1 (the nine correctness axes) on #346 if it is to be considered at all** — it has had
   no correctness audit, is 4+ commits behind `main`, and CI has never run on `4a359be`.
   Then decide `@civitai/elements` and #358 together (see rank 4).
   forcing: gate
3. **Fix `civitai/cli`'s `page-money` scaffold template before anyone bumps its `^0.53.0` pin**
   (see Open investigations). Out of this tree.
   forcing: regression
4. **Issue #343 — the host forwards `err.message`, never `err.code`,** so the documented App Storage
   error codes never reach a block and `kv-storage`'s only error branch is unreachable in
   production. Docs and mock assert otherwise across ~18 sites.
   forcing: user
5. **Decide `@civitai/elements` (#346) and the contract question (#358) together.** #359 banked the
   enabling split WITHOUT adopting elements, so the elements case rests solely on one-implementation
   (**by the PR's own admission unmet — 33 of 34 collisions stand**), form-association (real, no
   React-only equivalent) and framework-independence (real but unconsumed). 🔴 **#358's 13,480 B
   figure is correct FOR #358's question** — a per-component injector in `blocks-react` would slice
   `INTERACTIVE_STYLES` too — but today's split alone gives 25,518 B; the remaining 12,038 B needs
   the `blocks-react` change #358 is deciding.
   forcing: none
6. **Batch: the filed-with-closing-condition issues** — #345, #347, #348, #349, #357, #362, #363,
   #364, and the undecided `@civitai/app-sdk` peer on `@civitai/client` at `^0.2.0-beta.98`.
   forcing: none

## Defects (batched)

- 22 HIGH audit findings remain UNFILED, surviving only in a prior session's transcript.
- `#346` (`4a359be`) has never been tested on a merged tree and CI has never run on it.
- `pnpm lint` exits 1 repo-wide (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`). Pre-existing on `main`.
- The Playwright browser tier does not start unaided on this host — it wants
  `chromium_headless_shell-1223`, `PLAYWRIGHT_BROWSERS_PATH` supplies `-1228`. **Confirmed
  pre-existing by discriminating control** (same failure in the unmodified base clone on `main`),
  so it is not a regression from anything this arc merged. CI installs Playwright explicitly.
- `styles.generated.ts`'s `.d.ts` is un-annotated, so tsc inlines the sheet as a string-literal type
  (33 KB). The new slices annotate `: string` (99,780 B → 6,570 B across 14). Left alone because
  changing it would break the byte-identity contract.

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
