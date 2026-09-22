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
  🔴 **REPAIRED 2026-09-21. The previous wording grepped issue bodies for the token
  `launch-blocking`, which nobody ever wrote — it could only ever return green.** Re-measured
  before replacing it: **0** hits for the token against **11** open bug issues as the positive
  control. The working check does not depend on a token at all:

  ```bash
  # The 13 audited blockers are #322–#334. The condition is that NONE is still open.
  gh issue list --repo civitai/civitai-app-starters --state open --limit 100 \
    --json number -q '[.[] | select(.number >= 322 and .number <= 334)] | length'
  # => 0  ⇒ every audited blocker is closed.
  # POSITIVE CONTROL, run it in the same breath or the zero means nothing:
  gh issue list --repo civitai/civitai-app-starters --state open --limit 100 \
    --json number -q 'length'        # => non-zero, so the query CAN return rows
  ```
  🔴 **When you write a closing-condition that greps for a token, grep for it once at write
  time and confirm a non-zero count** — otherwise the condition is decorative. That is the
  mistake this entry is repairing.

  🔴 **ON REPAIR IT RETURNED 8 — AND 7 OF THOSE 8 WERE ALREADY FIXED IN CODE, MERELY NEVER
  CLOSED.** This is the trap worth carrying forward: **an open-issue count is not a defect count**,
  and the repaired check measures tracker hygiene, not the tree. Each of the 8 was re-measured
  against `eed2df5` and 7 were found fixed by a dedicated PR that never said "Closes #N":

  | issue | fixed by | verified how |
  |---|---|---|
  | #322 `scryptSync` per call | `d4f9da9` (#320) | `keyCache` memoizes derived keys by secret |
  | #323 refresh in a Server Component | `3524fd6` (#336) | moved to `proxy.ts` middleware; docblock names the mechanism |
  | #324 self-fetch → fd exhaustion | `4a3dd95` (#337) | module-relative `DIST_DIR`, boot-time read, `exit(1)`; its own grep returns 0 (control: 4 `fetch` hits) |
  | #325 no `Secure`/HSTS | `c68cea4` (#338) | `production` from `APP_URL.startsWith('https://')`; `NODE_ENV` now in 4 docs (was 0 of 20) |
  | #327 `useBlockResize` | `2ffdbc3` (#321) | dep array removed on purpose + `el === observedRef.current` |
  | #329 `WorkflowStatus` twice | `b3e4f35` (#335) | renamed `OrchestratorWorkflowStatus` |
  | #333 AES-256-CTR in docs | `d3f4296` (#319) | 0 files say CTR, 8 say GCM (enumerated — a recursive `grep` is `.gitignore`-blind here) |

  All 7 were closed 2026-09-21 with that evidence attached. **The check now returns 1: only #328**
  (34 duplicate export names) is a live blocker, and it is a design decision rather than a patch —
  #346 was the attempt and was closed with 33 of 34 collisions standing. Controls on the re-run:
  21 open issues total (positive), an impossible number range returns 0 (negative), and each
  closure was confirmed by reading back `state == CLOSED` rather than by trusting an exit code.

  Read "Round-1 DoD: ADDRESSED" below as *the round-1 write-up was addressed*, never as *the
  blockers are fixed* — though as of this repair they very nearly are.

## State now

- **Branch/PR:** base clone on `main` @ `38a0b5d`, clean. One open PR of mine from this
  session: **#400** (`zach/blocks-client-react` → **`feat/blocks-client`**, not `main`).
  Worktree `civitai-app-starters-clientreact` holds it, clean.
- ✅ **The launch-audit arc is one item from its closing condition.** The repaired check
  returns **1**: only **#328** remains of the 13 audited blockers. Control: 48 open issues
  total, so the query does return rows.
- ✅ **Seven blockers closed 2026-09-21** — #322, #323, #324, #325, #327, #329, #333 — each
  already fixed in code by a PR that never wrote "Closes #N", each traced to its fixing sha,
  re-measured against `eed2df5`, and closed with that evidence attached. Closures confirmed
  by reading back `state == CLOSED`, not by exit codes.
- ✅ **All 28 recovered audit findings resolved; 25 filed as #374–#398.** 1 was already fixed
  (#16 → #361/0.55.1), 1 already filed (#26 → #328/#247), 0 left unverified.
- ✅ **Merged this session:** #372 (peer-floor ledger → measurement), #356 (this doc onto
  `main`), #373 (recovery record + repaired closing condition), #399 (filing record).
- 🔴 **NEW ARC OPENED, and it now dominates: Koen's SDK/components consolidation** on
  `origin/feat/blocks-client` (34 ahead of `main`, **36 behind**, author Koen, **no PR**).
  Reviewed in full; review filed as **#402**, sunset blocker as **#401**.
- **#400 is red on 3 checks and NONE is attributable to it** — proven, see the investigation
  block. Its own package: typecheck 0, build 0, **20 tests**, **6/6 mutants killed**.
- **Deploy/verify status:** `@civitai/app-sdk@0.49.0` + `@civitai/blocks-react@0.56.0`
  published 2026-09-21T15:33:32Z and verified by three claims with controls (registry
  packument, `--dry-run` resolve, symbols read off the tarball). Nothing else deployed.
- **IN FLIGHT:** nothing of mine. Everything now waits on Koen.

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

### ✅ RETIRED 2026-09-21 — the four `APP_STORAGE_ERROR_*` peer-floor entries, converted to measurement
**Outcome, so the numbers outlive this block.** #371 merged `10db006`; app-sdk `0.49.0` published
15:33:32Z; the four symbols were read off the published tarball with `0.48.0` as the control:

| symbol | `0.48.0` | `0.49.0` |
|---|---|---|
| `APP_STORAGE_ERROR_REQUEST_FAILED` | ABSENT | **PRESENT** |
| `APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED` | ABSENT | **PRESENT** |
| `APP_STORAGE_ERROR_USER_ROW_LIMIT` | ABSENT | **PRESENT** |
| `APP_STORAGE_ERROR_VALUE_TOO_LARGE` | ABSENT | **PRESENT** |
| total exports on `./blocks` | 29 | 34 |

🔴 **The `0.48.0` column is the load-bearing half and is easy to skip.** Measuring only `0.49.0`
proves the floor SUFFICIENT while leaving open that it is too HIGH — which is #309/#317/#344 with
the sign flipped (a floor above the truth excludes a good release: spurious peer warnings,
`--strict-peer-deps` install failures). `0.48.0` exporting none of the four is what makes
`>=0.49.0` **EXACT**. Controls: the `29 → 34` delta is the probe moving (positive); an impossible
symbol read ABSENT on both (negative); published `blocks-react@0.56.0` declares
`>=0.49.0 <1.0.0` and `--dry-run` resolves app-sdk `0.49.0` under it (cross-check).
Landed as **#372**, comment-only, guards 158/0 unchanged. **The prediction never materialised into
harm** — no other app-sdk minor took `0.49.0`.

<details><summary>Original investigation block (superseded — kept for the reasoning trail)</summary>

- as-of: 2026-09-21
- **Symptom + exact repro:** `packages/civitai-blocks-react/package.json` declares
  `"@civitai/app-sdk": ">=0.49.0 <1.0.0"`, and `PEER_VALUE_SYMBOL_SINCE` in
  `tests/guards/blocks-react-peer-floor.test.mjs` records four symbols at `0.49.0`:
  `APP_STORAGE_ERROR_{REQUEST_FAILED,USER_QUOTA_EXCEEDED,USER_ROW_LIMIT,VALUE_TOO_LARGE}`.
  Every OTHER entry in that ledger was read off a published tarball. These four could not be —
  `0.49.0` did not exist when they were written.
- **Observed (with values):** `npm view @civitai/app-sdk version` → **0.48.0**; `0.49.0` is absent
  from the registry. `changeset status --verbose` on `#371`'s base computes `@civitai/app-sdk
  0.49.0` / `@civitai/blocks-react 0.56.0`, which is what the floor was set to match.
  `via: measurement`.
- **Ruled out:** "the release-ordering risk materialised" — FALSE. The hazard was that another
  app-sdk `minor` publishes first, takes `0.49.0`, and pushes these symbols to `0.50.0` while the
  floor still says `>=0.49.0` (that is #309/#317/#344 a fourth time). It did not happen: `origin/main`
  carried no other pending changeset and `#371` bumps app-sdk to exactly `0.49.0`. `via: measurement`.
- **Ruled out:** "the floor should be raised to `0.50.0` now that the guard is red" — FALSE and
  actively harmful. `0.49.0` genuinely exports all four, so a floor above it excludes a good release
  and causes spurious peer warnings and `--strict-peer-deps` install failures — the same family with
  the sign flipped. The guard's own remedy text says this in capitals. `via: doc`.
- **Leading hypothesis:** nothing is wrong; the prediction is simply unconverted. `PREDICTION HAS
  COME TRUE` fired on `#371` exactly as designed (its first real occasion), `75c711a` emptied
  `PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH`, and the floor and ledger were deliberately left alone.
  What remains is to read the four symbols off the real tarball.
- **Next probe** — run AFTER `#371` merges and the release job publishes; before that the first
  command answers `E404`, which is the CORRECT answer in that state and not something to chase:
  ```bash
  npm view @civitai/app-sdk@0.49.0 version
  cd "$(mktemp -d)" && printf '{"name":"v","private":true,"type":"module"}' > package.json
  npm i @civitai/app-sdk@0.49.0 --silent --prefer-online
  node --input-type=module -e "
  import * as b from '@civitai/app-sdk/blocks';
  for (const s of ['APP_STORAGE_ERROR_REQUEST_FAILED','APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED',
                   'APP_STORAGE_ERROR_USER_ROW_LIMIT','APP_STORAGE_ERROR_VALUE_TOO_LARGE'])
    console.log(s, s in b ? 'PRESENT' : '🔴 ABSENT');"
  ```
  All four PRESENT ⇒ the ledger entries are measurements; retire this block. Any ABSENT ⇒ the floor
  is wrong and the entries must be corrected to the version that does export them.

</details>

### `feat/blocks-client`'s `buzz` and `orchestration` are NON-FUNCTIONAL — no host handlers exist
- as-of: 2026-09-21
- **Symptom + exact repro:** the new client's two most important domains cannot work against
  production. Read it from the branch itself:
  `git show origin/feat/blocks-client:packages/civitai-blocks-client/BREAKING.md | sed -n '/Not yet spoken/,/^## /p'`
- **Observed (with values):** Koen's own words — *"`buzz` and `orchestration` were rebuilt on a
  protocol this package owns (`BUZZ_*`, `ORCHESTRATION_*`). **No host handler exists for any of
  it**, so both domains are non-functional against production until the host implements them."*
  20 of the host's 46 block→host messages are carried; 9 of those (4 buzz + 5 orchestration)
  await host work. `storage` (5), `viewer` (4), `host` lifecycle and `media.SAVE_IMAGE` work
  today. `via: doc` (his file), cross-checked against the protocol files themselves.
- **Ruled out:** "a starter can be ported end-to-end now" — FALSE. Every OAuth starter's demo is
  login → balance → estimate → generate; balance is buzz, estimate/submit are orchestration.
  `via: code`.
- **Ruled out:** "port `react-pwa` as the proof" — FALSE, and it was the plan until measured.
  `react-pwa` imports `@civitai/blocks-react` in **0** files; so do `next-app`,
  `sveltekit-app`, `svelte-pwa`. Only `civitai-block-starter` does (6 files). Positive control:
  `react-pwa` imports `@civitai/app-sdk` in **14**. `via: measurement`.
- **Leading hypothesis:** nothing is wrong with the branch; the host simply has not implemented
  the new protocol. The consequence is about SEQUENCING, not correctness — "declare the API
  stable by Friday" cannot cover the two domains an app author cares about most.
- **Next probe:** `cd packages/civitai-blocks-client && npm run check:parity` — his own guard
  against a committed snapshot of the host's `hostHandlerParity.ts`. When buzz/orchestration
  stop being listed as awaiting a host, that half is real.

### #400's three red checks are the BASE branch's, caused by this session's own publish
- as-of: 2026-09-21
- **Symptom + exact repro:** PR #400 shows 3 FAILURE checks. `feat/blocks-client` has no PR, so
  CI has never run on it and there is no rollup to compare against.
- **Observed (with values):** failing steps are `scripts/check-starter-pins.mjs`,
  `scripts/check-orchestrator-catalogs.mjs`, and `@civitai/components test:contract` — none
  touches `packages/civitai-blocks-client-react`. Checked out base `587764a` with none of my
  commits and ran them directly: **both exit 1**. The pin failure names the cause:
  `@civitai/app-sdk: "^0.42.0" does NOT admit published 0.49.0` and
  `@civitai/blocks-react: "^0.51.0" does NOT admit published 0.56.0`. `via: measurement`.
- **Ruled out:** "PR #400 broke them" — FALSE, they are red on the base without it.
  `via: measurement`.
- 🔴 **Instrument trap hit here:** piping either script to `tail` reports `rc=0`, because that is
  `tail`'s status. Both nearly recorded as passing. Capture the rc with a redirect, not a pipe.
- **Leading hypothesis:** the branch is 36 commits behind `main`, and **#371 — the publish
  merged earlier in this same session** — is what made its starter pins stale. Two of three go
  green on a sync; the third (`@civitai/components` cross-browser contract) is the Lit rewrite
  and needs a decision, not a sync.
- **Next probe:** after Koen syncs — `git merge-tree --write-tree origin/main origin/feat/blocks-client`
  must exit **0** (it exits **1** today), then re-read #400's rollup.

### #328 — the last live launch blocker, and it needs a DIRECTION, not a patch
- as-of: 2026-09-21
- **Symptom + exact repro:** `blocks-react/ui` and `@civitai/components-react` export 34
  identical names with drifted contracts.
- **Observed (with values):** computed on `eed2df5` — ui exports **62**, components-react
  **64**, intersection **34**. Control: `ui ∩ ui == |ui|` → true. `via: measurement`.
- **Ruled out:** "reopen #346 (`@civitai/elements`)" — its conditions 1 and 3 ARE met (the
  orchestration dashboard is a real non-React consumer; the one-implementation plan exists), but
  reopening would stand a SECOND web-components implementation beside Koen's, which is the exact
  failure #328 describes. Recorded on #346 as **superseded, not reversed**; branch preserved.
  `via: code`.
- **Leading hypothesis:** `feat/blocks-client` resolves it — `@civitai/components` becomes Lit
  elements, `components-react` becomes `@lit/react` bindings of the same elements, so the 34
  names stop being two implementations. Blocked on the branch being reconciled with `main`.
- **Next probe:** re-run the intersection against the branch after it syncs; and re-measure
  #247 rather than assuming shadow DOM closed it.

## Next steps (ranked)

1. **#402 / #328 — hand back to Koen; we are not blocked on ourselves.** The review is filed
   and @-mentions him. The branch must come up to `main` before anything else: it is 36 behind,
   `git merge-tree --write-tree origin/main origin/feat/blocks-client` exits **1**, and 8 files
   are touched by both sides including `packages/civitai-components/scripts/build-css.ts` (the
   #359 slicer). The textual conflict is the small half — both sides changed what
   `@civitai/components` *is*.
   IN FLIGHT: civitai/civitai-app-starters#400 (targets that branch), #401, #402.
   forcing: gate — it is the last item between this arc and its closing condition.
2. **Fix the filed findings, starting #375 and #383** — both are deletions of prose this arc
   itself wrote: the published `package.json` is **79%** internal post-mortem narrative (up from
   the audited 67%), and the README still asserts a peer floor that #371 contradicted.
   🔴 Several of the 25 ask for a test **watched to fail** first; #394 is the cautionary case —
   it *looked* fixed from a CHANGELOG line and was not.
   forcing: none
3. **Batch: the pre-arc filed issues, plus the block-starter port once the branch is green.**
   #358, #362, #363, #364, #367, #368, #369, #370, #345/#347/#348/#349/#357, #305. And
   `civitai-block-starter` is the right proof port (5 src files; uses 3 hooks, all
   host-functional today) — **not** `react-pwa`, which never used the bridge.
   forcing: none

## Defects (batched)

- **#400 carries 3 red checks that are the base branch's**, not its own — diagnosed above;
  a reader who trusts the rollup will misattribute them.
- **`feat/blocks-client` has no PR**, so nothing runs CI on it and nobody has seen it red.
- 25 filed findings (#374–#398) are all unfixed; 22 confirmed live, 3 live-but-partial.
- `pnpm lint` exits 1 repo-wide (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`). Pre-existing, ungated.
- **#372, #373, #399 and #400 all merged or shipped with round 0 only** — the nine correctness
  axes never ran on any of them.

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

- ✅ **REPAIRED 2026-09-21 — and the repair taught a second lesson the first one hid.** The
  replacement (in Goal) is number-range based, needs no token, and was validated with both controls
  before being written down. It returned **8**, not 0 — so the broken instrument really had been the
  only reason the arc looked closeable.
  🔴 **But 8 open issues turned out to be 1 real defect.** Seven were fixed in code and never
  closed, because their fixing PRs never wrote "Closes #N". Acting on that 8 as though it were a
  defect count would have meant re-fixing seven solved problems — and in this session it briefly
  did: the count was reported as "eight live blockers, five of them security" before any of the
  eight had been read against the tree. **A tracker query answers a question about the TRACKER.
  Re-measure each item against the code before believing the total**, and prefer closing-conditions
  that read the tree over ones that count issues. The original entry follows, because the lesson in
  it is also still reusable:
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

- 🔴 **A GUARD WRITTEN FOR A FUTURE STATE MUST BE WATCHED IN THAT STATE, AND THIS ONE WAS.**
  `PREDICTION HAS COME TRUE` exists because round 3 found the peer-floor guard claimed *"it retires
  itself"* and did not — it stayed **green** on the Version Packages PR, the exact moment cleanup
  becomes possible. Round 5 then found its first remedy step would have raised the floor, excluding
  a good release. Both fixes are visible in the message it actually printed on #371: the runnable
  steps lead, and it says in capitals **DO NOT raise the floor**. The retirement is `75c711a`.
- 🔴 **A "prediction that came true" is still not a measurement.** ✅ **CONVERTED 2026-09-21 in
  #372** — the four ledger entries were re-read off the published `0.49.0` tarball. The entry stands
  as the general rule: a number derived from `changeset status` reads exactly like one read off a
  tarball, and the ledger's own docblock calls a guess worse than no ledger *because* of that.
  Converting it was rank 2, not a formality.
- 🔴 **MEASURING ONLY THE TARGET VERSION PROVES A FLOOR *SUFFICIENT*, NEVER *EXACT* — YOU MUST ALSO
  MEASURE THE VERSION BELOW IT.** Reading the four symbols off `0.49.0` and stopping would have
  confirmed `>=0.49.0` admits nothing broken while leaving *too high* wide open — and too-high is a
  real defect with the sign flipped (excludes a good release ⇒ spurious peer warnings,
  `--strict-peer-deps` install failures), the shape #309/#317/#344 keeps regenerating. `0.48.0`
  exporting **none** of the four is the half that makes the floor exact. Generalise: **a
  one-sided read of a boundary cannot tell you the boundary is in the right place** — and the
  export-count moving (29 → 34) is what proves the probe was even looking at two different tarballs.
- 🔴 **`grep` PATTERNS ARE A DEPENDENCY YOU DID NOT PIN — TWO INSTRUMENT FAILURES THIS SESSION, BOTH
  RETURNING A CLEAN-LOOKING ZERO.** (a) A positive control searched `"try reloading"` against a file
  containing `"Try reloading"` — a **case** mismatch — and returned 0 right beside the result it was
  meant to validate; the pair would have read as "claim gone, control fine". (b) A results grep used
  TAP's `^# pass` against `node --test`, which prints `ℹ pass 158` — so BOTH the clean run and the
  mutant printed nothing, which would have read as "the negative control did not fire". **Validate
  the pattern against known-present text before reading any zero, and read the runner's actual
  output format rather than assuming TAP.**
- 🔴 **`gh api …/actions/runs?head_sha=` NEEDS THE FULL SHA.** A short sha returns
  `total_count=0` — reproduced — which is indistinguishable from "CI never ran" and would send you
  to close/reopen a PR whose CI was fine.
- **Decision: do NOT force-push to correct a commit message on a PR carrying review threads.**
  Record the correction in a later commit and a PR comment instead.

- 📍 **THE 28 RECOVERED AUDIT FINDINGS — WHERE THEY LIVE. Moved here from `State now`, which is
  REPLACED on every update; it would have been deleted by this one.**
  **Recovered to `/home/zach/workspace/civit/audit-findings-app-starters-2026-09-19.md`** (~172 KB:
  six sub-audits verbatim + the triage + the filing map), from Claude Code transcript
  `c5ec3943-03ce-4e46-8c4d-b1a8518411e6`, lines `[372, 413, 434, 450, 474, 497]`.
  🔴 **DELIBERATELY OUTSIDE THIS REPO and it must stay outside** — the repo is PUBLIC and the file
  holds unfiled security findings in raw form. Filing them as curated issues is the plan; bulk
  pasting 172 KB is not the same act. 🔴 **It is on ONE host's disk and this bullet is the only
  pointer** — if it is gone, the transcript above is the re-derivation path, but transcripts age
  out, so re-recover before relying on it.
  **Filed 2026-09-21, 25 of 27 distinct findings** (28 numbered, 20 duplicates 13):
  1→#374 · 2→#375 · 3→#376 · 4→#377 · 5→#378 · 6→#379 · 7→#380 · 8→#381 · 9→#382 · 10→#383 ·
  11→#384 · 12→#385 · 13(=20)→#386 · 14→#387 · 15→#388 · 17→#389 · 18→#390 · 19→#391 · 21→#392 ·
  22→#393 · 23→#394 · 24→#395 · 25→#396 · 27→#397 · 28→#398. Not filed: **16** FIXED by #361 →
  0.55.1; **26** already filed as #328 + #247.
  🔴 Two corrections the triage made to the audit, carried into the issues: **#392 is SEVEN hooks,
  not eight** (`useTipAllowance` already sequences via `inFlight: Set<AbortController>`), and
  **#394 was NOT already fixed** though both CHANGELOGs' mutation-sweep line makes it look so —
  the `default:` arm still returns `null`, a structural pass.
- 📍 **THE RELEASE LEDGER, moved here because `State now` is REPLACED on every update and this
  is the third time these facts have been at risk of deletion.** Published from this arc:
  `@civitai/blocks-react` **0.55.1** (2026-09-21T02:44Z, detector env-inlining security fix) ·
  `@civitai/components` + `-react` **0.4.2** (same run, per-component CSS slices with the
  `./css/*` exports HELD) · `@civitai/app-sdk` **0.49.0** + `@civitai/blocks-react` **0.56.0**
  (2026-09-21T15:33:32Z, from #371 `10db0064`, release run `35619202423`, verified by three
  claims with controls). Merged along the way: **#366 `d057664`** (App Storage error fidelity,
  auto-closed #343), **#372 `24db9c3`**, **#356 `eed2df5`**, **#373 `6be8ed5`**, **#399 `38a0b5d`**.
- 📍 **The #366 audit ladder, rounds 0–5, CLOSED** — findings 5 → 4 → 5 → 3 → 2 → 2; payload
  324 → 269 → 256 → 122 → 75; scaffolding 0 for the last two. Every round's claims block is a PR
  comment on #366. It ended on a STATED criterion (round 5's own), not on a round count.
  The three-stage `0.55.1` release validation lives as a comment on issue **#360**, which outlives
  this doc.
- 🔴 **AN OPEN-ISSUE COUNT IS A FACT ABOUT THE TRACKER, NOT THE TREE — and this session
  reported eight live launch blockers, five of them "security", before reading one against the
  code.** Seven of the eight were already fixed by PRs that never wrote "Closes #N". The
  repaired closing condition is a better instrument than the token-grep it replaced and still
  measures issue hygiene. **Re-measure every item against the code before believing a total.**
- 🔴 **`git merge-tree --write-tree <a> <b>` — BRANCH ON THE EXIT CODE.** It prints only a tree
  OID on success and emits no conflict markers, so grepping for `<<<<<<<` finds nothing whether
  or not a conflict exists. Used correctly here it exits **1** on `main` vs `feat/blocks-client`.
- 🔴 **A PIPE EATS THE EXIT CODE, AND IT NEARLY INVERTED A DIAGNOSIS.** `node script.mjs 2>&1 |
  tail -6; echo rc=$?` prints **`rc=0`** for a script that exits **1** — that is `tail`'s status.
  Both CI scripts were briefly recorded as passing on the base branch. Redirect to a file and
  read `$?` immediately.
- 🔴 **A MUTATION SWEEP'S SURVIVORS ARE THE POINT — two of six were real, and one killed a
  guard rather than a test.** (a) The `mountedRef` check that all 38 old hooks carry SURVIVED
  deletion with every test green: React 18 makes `setState` after unmount a silent no-op, so it
  pins a hazard that no longer exists. **Deleted, not test-justified.** (b) `useAsyncIterable`'s
  `cancelled` flag was UNREACHABLE — not via unmount (same React no-op) and not via a fixture
  that honours its `AbortSignal` and stops on its own. **Breakability is not reachability: ask
  which case executes the guard.** The reaching case is supersede-while-mounted by a
  signal-ignoring generator.
- 🔴 **`BlockTransport.snapshot` is `{ get(), subscribe() }` and `Live<T>` is an `EventTarget`
  dispatching `change` with stable identity — both are `useSyncExternalStore` stores already.**
  Koen does not use React and built this by accident of good design. Consequence: read
  `value`/`error`/`loading` through THREE stores, never one composed snapshot — a composed
  object is a fresh identity per `getSnapshot`, never `Object.is`-equal, and re-renders forever.
- 🔴 **`@civitai/app-sdk` CANNOT BE SUNSET — `blocks-client` replaces the BRIDGE half only.**
  Files matching `exchangeCode|refreshToken|sealCookie|pkce`: `blocks-client` **0**, `app-sdk`
  **5** (control). The four OAuth starters import `blocks-react` in **0** files (control:
  `react-pwa` imports `app-sdk` in 14) across 26 sites in `app-sdk`, `/orchestrator`, `/scopes`.
  `app-sdk/vite`'s `blockManifestPlugin` has no equivalent either. Filed as **#401**.
- **Decision: NO per-endpoint React shims.** Measured, not preferred: the only first-party
  consumer of the blocks hooks is `starters/civitai-block-starter/src`, using **3** of 36
  (`useBlockContext`, `useBlockResize`, `useViewer`), each a one-line port. A 38-hook shim layer
  for three call sites rebuilds the surface the consolidation exists to delete. The migration is
  a map, not a shim.
- **Decision: FOUR React primitives, not three.** `useBlockSnapshot` (handshake store),
  `useBridgeCall` (promise), `useLive` (`Live<T>`), `useAsyncIterable`. The snapshot is a
  genuinely distinct shape and the one a block touches first.
- 🔴 **A hook count from `grep` over a starter counts its README.** The block starter's *docs*
  name 10 hooks; its *code* uses 3. Scope the grep to `src/`.
- **Dead end:** `find-session --arc` exited 5 on this doc until #356 merged — the doc was only
  in a worktree, and `--arc` resolves against repo handles. Merging it fixed that.

## How to verify

The arc's own closing condition, with both controls in the same breath:

```bash
gh issue list --repo civitai/civitai-app-starters --state open --limit 200 \
  --json number -q '[.[] | select(.number >= 322 and .number <= 334)] | length'   # => 1 (only #328)
gh issue list --repo civitai/civitai-app-starters --state open --limit 200 \
  --json number -q 'length'                                                        # => non-zero (positive control)
```

That #400's red is the base branch's, not its own — run from a checkout of `587764a`:

```bash
R=/home/zach/workspace/civit/civitai-app-starters
git -C $R worktree add --detach /tmp/basectl origin/feat/blocks-client
cd /tmp/basectl
node scripts/check-starter-pins.mjs >/tmp/pins.out 2>&1;  echo "pins rc=$?"   # => 1
node scripts/check-orchestrator-catalogs.mjs >/tmp/cat.out 2>&1; echo "cat rc=$?" # => 1
# 🔴 do NOT pipe to tail — that reports rc=0, which is tail's status
```

The React primitives, including the sweep:

```bash
cd /home/zach/workspace/civit/civitai-app-starters-clientreact/packages/civitai-blocks-client-react
npx tsc -p tsconfig.json --noEmit && npx vitest run --project unit   # => 20 passed
# mutation sweep (6/6 killed, tree restored byte-identical):
python3 /tmp/claude-1000/-home-zach-workspace-civit-civitai-app-starters/\
e358e8a1-b161-4d89-8516-b730681b6b6d/scratchpad/mutate_react.py
```

The branch conflict, by exit code rather than a marker grep:

```bash
git -C $R merge-tree --write-tree origin/main origin/feat/blocks-client >/dev/null; echo "rc=$?"  # => 1
```
