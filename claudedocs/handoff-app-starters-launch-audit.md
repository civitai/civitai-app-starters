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
- **Branch:** `main` @ `503fe39`, clean, in sync with origin. No PR open from this session.
- **Published this session (3 releases, all verified against the registry by content, not by workflow status):**
  - `@civitai/app-sdk` 0.45.0 → 0.46.0 → 0.47.0 → **0.48.0**
  - `@civitai/blocks-react` 0.53.0 → 0.53.1 → 0.54.0 → **0.55.0**
- **Merged PRs:** #317, #319, #320, #321, #335, #336, #337, #338, #340, #341, #344, #351,
  #352, #353, #355 + version PRs #318, #339, #350, #354.
- **13 launch-blockers found; all 13 fixed and published.** Filed as issues #322–#334
  (five carry a `security` label created for the purpose).
- **Audits run:** round 0 on #340/#341/#344/#346/#351/#352/#353, round 1 on #340/#341/#344.
  Every round 0 found a real requirement problem. Three of them were defects in the
  *brief*, not the PR — see Gotchas.
- **IN FLIGHT:** nothing. All agents finished; no worktrees remain (`git worktree list`).
- **Deploy/verify status:** published AND verified by reproducing each defect's original
  failure path against the published tarballs — not by reading workflow status. See
  "How to verify".

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
1. **Decide `@civitai/elements` (PR #346, still open).** The web-components spike. Its
   headline byte case is RETRACTED — a per-component CSS split *inside the existing
   packages* measured 13,480 B against the custom element's 21,309 B, 37% better with
   identical JS. The architecture now rests on one-implementation / form-association /
   framework-independence, having closed 1 of 34 name collisions. Files:
   `packages/civitai-elements/`, `packages/civitai-elements-react/`.
   forcing: none
2. **Work the 22 HIGH audit findings.** Not yet filed as issues. The sharpest is a defect in
   the *published* `@civitai/blocks-react`: `internal/detector.js` reads
   `import.meta.env?.[key]` with a **variable** key, so Vite cannot statically replace it and
   inlines the entire `VITE_*` env — including `VITE_LIVE_BLOCK_TOKEN` — into every block
   app's production bundle. Fix is three literal `import.meta.env.VITE_…` reads.
   forcing: security
3. **Fix `civitai/cli`'s `page-money` template before anyone bumps its `^0.53.0` pin**
   (see Open investigations). Out of this tree.
   forcing: regression
4. **Issue #343 — the host forwards `err.message`, never `err.code`,** so the documented
   App Storage error codes never reach a block and `kv-storage`'s only error branch is
   unreachable in production. Docs and mock assert otherwise across ~18 sites.
   forcing: user
5. **Issues #345, #347, #348, #349** — mock/host divergences and unpinned constants, all
   filed with closing conditions during the audit.
   forcing: none
6. **`@civitai/app-sdk` peers `@civitai/client` at `^0.2.0-beta.98`** — a beta range shipping
   to external developers. Never decided.
   forcing: none

## Defects (batched)
- `packages/civitai-blocks-react/src/internal/detector.js` — variable-key `import.meta.env`
  inlines the whole `VITE_*` env into consumer bundles (see rank 2).
- 22 HIGH findings from the audit are unfiled; the artifact that held them was deleted twice
  and is not republished. They exist only in this session's transcript.
- `@civitai/blocks-react`'s `comment-peerDependencies` block still describes the peer-floor
  guard's old version-equality rule; #355 replaced it with a symbol-derived ledger. Not
  wrong, incomplete — deliberately untouched because editing it changes a published
  package's tarball.

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

## How to verify
Reproduce the published behaviour, not the workflow status:

```bash
cd "$(mktemp -d)" && printf '{"name":"v","private":true,"type":"module"}' > package.json
npm i @civitai/blocks-react@0.55.0 @civitai/app-sdk@0.48.0 react@19 ajv --silent

# #353 — createLiveHost moved off ./testing
node --input-type=module -e "
import * as t from '@civitai/blocks-react/testing';
import * as l from '@civitai/blocks-react/live';
console.log(Object.keys(t).sort().join(','));      // Harness,createMockHost,readMockHostUrlOptions,resetTransport
console.log('on ./testing:', 'createLiveHost' in t); // false
console.log('on ./live   :', typeof l.createLiveHost); // function"

# #352 — defineBlock derives from the canonical schema, both directions
node --input-type=module -e "
import { defineBlock } from '@civitai/app-sdk/manifest';
const b={blockId:'my-block',version:'1.0.0',name:'N',contentRating:'pg',scopes:[]};
const t=(l,m)=>{try{defineBlock({manifest:m});console.log(l,'ACCEPTED')}catch(e){console.log(l,'rejected:',e.message.split('\n')[0].slice(0,50))}};
t('5-field minimum  ', b);                                        // ACCEPTED (was rejected)
t('iframe.src set   ', {...b, iframe:{src:'https://x/',minHeight:300}}); // rejected: SERVER-OWNED
t('bad blockId      ', {...b, blockId:'Not-A-DNS-Label'});        // rejected by schema pattern"
```

⚠ `contentRating` is lowercase (`g|pg|pg13|r|x`) — a capitalised fixture fails for the
wrong reason and reads like a code defect.

Repo-side: `pnpm -r typecheck && pnpm -r test && pnpm test:guards && pnpm typecheck:readme`
— and separately `pnpm --filter @civitai/blocks-react test:browser` under
`nix-shell -p chromium`.
