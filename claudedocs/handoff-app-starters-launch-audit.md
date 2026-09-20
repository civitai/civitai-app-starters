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

- **DoD VERDICT (round 1 closing-condition): ADDRESSED — but the check that says so is VACUOUS.**
  `gh issue list --repo civitai/civitai-app-starters --state open --label bug` returns 9 issues,
  none containing "launch-blocking" ⇒ literally green. It is green for the wrong reason: the
  string **appears in ZERO issues in the repo, including all 13 the doc designates blockers
  (#322–#334)**, so the grep cannot fail. Instrument control: grepping a known-present string in
  #343 returned 16 hits, so the zero is real. Substance verified BY HAND instead — all 13 were
  filed as #322–#334 and every one spot-checked (#322, #327, #333, #343) carries a
  `## Closing condition` section. The condition is an OR (*published OR filed with a closing
  condition*), so the 9 still-open issues do not violate it. **The round-1 arc is CLOSED.**
  Everything in Next steps is a NEW arc.
- **Branch:** `main` @ `503fe39`, unchanged this session (untracked `.venv/`, `opencode.json` only).
- **This doc** lives on `docs/handoff-app-starters-launch-audit` = **PR #356**, not on `main`.
- **PR #346 decision made and EXECUTED (disposition (a)): keep the two new packages, strip the
  strangler seam.** Commit **`4a359be`** pushed to `feat/civitai-elements-phase1`; PR #346 remains
  **OPEN / MERGEABLE**, not merged, not closed. PR body + a comment record why.
  - Removed: `@civitai/elements: workspace:*` from `packages/civitai-blocks-react/package.json`,
    the lockfile edge, `src/ui/Stack.tsx` reverted to `main`'s `<div>` (byte-identical, verified),
    `test/Stack.strangler.test.tsx` deleted, and the two `pnpm --filter @civitai/elements build`
    steps in `ci.yml` that existed only for the seam. Prose corrected in `AGENTS.md`,
    `packages/civitai-elements/README.md`, `packages/civitai-elements/docs/DECISIONS.md` (§10
    retitled REVERSED).
  - **Independently re-verified (not from the subagent's self-report):** head of #346 is `4a359be`;
    `blocks-react` dependencies are now exactly `{@civitai/components, @civitai/theme}`;
    `Stack.tsx` diff vs `main` is empty; #346 state OPEN/MERGEABLE.
  - Enumerated grep (NOT `grep -r`, which honours `.gitignore`):
    `find packages/civitai-blocks-react -type f -not -path '*/node_modules/*' -print0 | xargs -0 grep -n '@civitai/elements'`
    → **0 lines over 498 files**; positive control with `@civitai/components` over the same
    enumeration → **69 lines**.
- **Issue #357 filed** — `blocks-react/ui` `Stack` types `gap` as `string | number`, so `gap="md"`
  typechecks and silently renders 12px when the author asked 16px. The removed shim was quietly
  fixing this; reverting restores it. Has a `## Closing condition`.
- **IN FLIGHT:** branch **`zach/components-css-split`** (pushed, `756192e`) — a subagent landing the
  per-component CSS split inside `@civitai/components`, lifting the already-lossless-asserted
  `sliceComponentsCss()` from `packages/civitai-elements/scripts/measure-bundle.mjs`. Deliberately
  does NOT rewire `blocks-react`'s `useBlocksStyles()` (see Gotchas). Worktree
  `/home/zach/workspace/civit/civitai-app-starters-cssplit`.
- **Worktrees created this session, to remove when done:** `-launchaudit` (holds this doc's branch),
  `-seamcut` (holds `feat/civitai-elements-phase1`), `-cssplit`.
- **Deploy/verify status:** nothing published this session. `4a359be` is verified LOCALLY only —
  1508 unit + 73 browser + 98 guards + 18/18 typechecks + 7/7 builds green — but **CI has not run on
  it and the branch is 4 commits behind `main`, so none of it was measured on a merged tree.**

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

1. **🔴 `detector.js` leaks the whole `VITE_*` env into every block app's production bundle.**
   VERIFIED AGAINST THE PUBLISHED TARBALL this session, not inferred: install
   `@civitai/blocks-react@0.55.0`, then `dist/internal/detector.js:33` reads
   `import.meta.env?.[key]` with a **variable** key. Vite cannot statically replace that, so it
   inlines the entire `VITE_*` env — including `VITE_LIVE_BLOCK_TOKEN`. Fix is three literal
   `import.meta.env.VITE_…` reads in `packages/civitai-blocks-react/src/internal/detector.ts`.
   Needs its own branch + changeset; do NOT run it concurrently with another agent editing
   `blocks-react`.
   forcing: security
2. **Review/merge the CSS-split PR** on `zach/components-css-split` once CI is green.
   IN FLIGHT: civitai/civitai-app-starters — branch pushed, PR number not yet known at write time.
   Files: `packages/civitai-components/scripts/build-css.ts`, `src/components.css`, generated
   per-component artifacts, `package.json` `exports`.
   forcing: none
3. **Fix `civitai/cli`'s `page-money` scaffold template before anyone bumps its `^0.53.0` pin**
   (see Open investigations). Out of this tree.
   forcing: regression
4. **Issue #343 — the host forwards `err.message`, never `err.code`,** so the documented App Storage
   error codes never reach a block and `kv-storage`'s only error branch is unreachable in
   production. Docs and mock assert otherwise across ~18 sites.
   forcing: user
5. **Decide `@civitai/elements` on its architectural merits (PR #346).** No longer a release
   hazard, so it can sit open. The byte case is retracted AND the control beats it by 37%; the
   decision now rests on one-implementation (**by the PR's own admission unmet — 33 of 34 name
   collisions still stand**), form-association (real, no React-only equivalent), and
   framework-independence (real but currently unconsumed — the Svelte starters do not use
   `blocks-react/ui`). Files: `packages/civitai-elements/`, `packages/civitai-elements-react/`.
   forcing: none
6. **Batch: the filed-with-closing-condition issues** — #345, #347, #348, #349 (mock/host
   divergences, unpinned constants), #357 (Stack `gap="md"`), and the undecided
   `@civitai/app-sdk` peer on `@civitai/client` at `^0.2.0-beta.98`, a beta range shipping to
   external developers.
   forcing: none

## Defects (batched)

- 22 HIGH audit findings remain UNFILED and exist only in a prior session's transcript — the
  artifact holding them was deleted twice and never republished. They will age out.
- `4a359be` was never tested on a merged tree: branch is 4 commits behind `main` and CI has not run
  on it. This repo's own history includes a merge that broke `main` with zero file overlap.
- `pnpm lint` exits 1 repo-wide (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` — root script exists, no package
  implements it). Pre-existing on `main`, no CI job runs it.
- `@civitai/blocks-react`'s `comment-peerDependencies` block still describes the peer-floor guard's
  old version-equality rule; #355 replaced it with a symbol-derived ledger.

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
