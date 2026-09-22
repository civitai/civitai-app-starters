# How the `@civitai/app-sdk` peer floor was derived

Maintainer notes for `peerDependencies["@civitai/app-sdk"]` in this package's
`package.json`. Not published — this package's `files` field is
`["dist", "README.md"]`, so this file stays in the repo and out of the tarball.
It was moved here out of a `comment-peerDependencies` array that had grown to
142 lines — 10,574 B of a 12,734 B published `package.json`, 83% of it (#375).

**The floor is DERIVED, not chosen: it is the lowest published version that
exports every symbol this package imports from the peer.** The machine-readable
half of that lives in [`tests/guards/blocks-react-peer-floor.test.mjs`](../../tests/guards/blocks-react-peer-floor.test.mjs)
— `PEER_VALUE_SYMBOL_SINCE`, `PEER_SUBPATH_SINCE`, and the assertions over them.
This file is the prose half: why the number is what it is, and how to move it.

Declared today: `">=0.49.0 <1.0.0"`.

---

## 🔴 RAISED 0.47.0 → 0.49.0 (the fourth time: #309, #317, #344, then #366)

`internal/mockHost.ts` began importing four new peer VALUE symbols —
`APP_STORAGE_ERROR_VALUE_TOO_LARGE`, `APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED`,
`APP_STORAGE_ERROR_USER_ROW_LIMIT` and `APP_STORAGE_ERROR_REQUEST_FAILED`, the
host's own storage-rejection messages, which it now emits instead of the
invented `PAYLOAD_TOO_LARGE` / `STORAGE_UNAVAILABLE` (#343).

`0.49.0` was a **prediction** when #366 shipped it: those four symbols ship for
the first time in the app-sdk minor released alongside that change, so there was
no tarball to probe. It was derived from the release plan (in-tree app-sdk
`0.48.0`, which was also `npm view @civitai/app-sdk version`; no pending
changesets on `main`; `pnpm exec changeset status --verbose` printing
`@civitai/app-sdk 0.49.0`), and it was **pinned as a prediction** —
`PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH` plus the `PREDICTED ENTRY` test in the
guard re-derived the number from the tree on every run, so a rebase past another
app-sdk release would have gone red instead of drifting.

**That is settled now, and the prediction was correct.** #371 merged
(`10db006`), the release job published app-sdk `0.49.0` at 2026-09-21T15:33:32Z,
and #372 (`24db9c3`) re-read the four entries off the real tarballs;
`75c711a` emptied `PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH`. Nothing is owed here.

Measured, both sides of the boundary:

- published **`0.49.0` exports ALL four** (34 symbols on `./blocks`) and is the
  newest published version, so the contiguous run is unbroken to the top;
- published **`0.48.0` exports NONE of them** (29 symbols on `./blocks`), so the
  run cannot start lower.

Which is what makes `>=0.49.0` **EXACT, not merely sufficient**. Controls were
run before those numbers were believed: the 29 → 34 export-count delta is the
probe moving (positive — a reading identical on both versions would be
indistinguishable from a probe wired to one tarball twice), and an impossible
symbol (`NO_SUCH_SYMBOL_ff3a9c`) read ABSENT on both (negative — the probe can
say "no"). Cross-check: the published `@civitai/blocks-react@0.56.0` tarball
declares `">=0.49.0 <1.0.0"`, and `npm install --dry-run --prefer-online
@civitai/blocks-react@0.56.0` resolves `@civitai/app-sdk 0.49.0`.

---

## 🔴 RAISED 0.45.0 → 0.47.0 (the third time this class bit: #309, #317, then #344)

`internal/mockHost.ts` began importing three new peer VALUE symbols —
`APP_STORAGE_MAX_BYTES`, `APP_STORAGE_MAX_ROWS` and
`APP_STORAGE_MAX_VALUE_BYTES`, the App Storage ceilings, which it assigns to its
mock storage defaults. All three shipped for the first time in the app-sdk minor
released alongside that change.

**How `0.47.0` was derived** (computed, not predicted from release ordering):

- in-tree `packages/civitai-app-sdk/package.json` was `0.46.0`, and `0.46.0` was
  also `npm view @civitai/app-sdk version` — the tree sat at the last published
  version, so nothing was mid-flight;
- the pending changeset set was exactly one file,
  `.changeset/app-storage-real-ceilings-2026-09-19.md`, declaring
  `@civitai/app-sdk: minor`; `git ls-tree -r origin/main .changeset/` showed
  `main` carried no others;
- `pnpm exec changeset status --verbose` on that branch printed
  `@civitai/app-sdk 0.47.0` (and `@civitai/blocks-react 0.54.0`). That is the
  tool that actually runs, answering with the number it actually writes.

**Measured, both directions, against the REAL tarballs** (not the workspace
copy):

- published `0.46.0` — which the OLD `>=0.45.0` range SATISFIED, installing with
  no peer warning at all — exports none of the three. `node -e` on a scratch
  `npm i @civitai/app-sdk@0.46.0`:

  ```
  SyntaxError: The requested module '@civitai/app-sdk/blocks'
    does not provide an export named 'APP_STORAGE_MAX_BYTES'
  ```

  Controls were run BOTH ways before that zero was believed: an impossible
  symbol reported absent (the probe can go red) and `BrowsingLevel` /
  `SFW_LEVELS` resolved (the probe can see a symbol that IS there).
- blast radius is the `./testing` subpath ONLY, and that was measured too, by
  `pnpm pack`ing this package and importing both entries against `0.46.0`:
  `@civitai/blocks-react` resolved 61 exports fine; `@civitai/blocks-react/testing`
  threw the `SyntaxError` above out of `dist/internal/mockHost.js`.
  `src/testing.tsx` reaches `mockHost`, `src/index.ts` does not — so the block
  boots and every dev harness and downstream test suite dies instead.
- with the floor at `0.47.0`, that same install is refused: npm reports
  `ERESOLVE` against `@civitai/app-sdk@0.46.0`.

### ⚠️ The residual risk is release ordering, and it is not removable from here

A floor named for an unpublished release is a measurement **of a base**, and a
rebase invalidates the base. If another app-sdk minor merges and publishes
first, the number the branch predicted ships WITHOUT the new symbols, the
branch's own changeset publishes the next one up, and the range admits a broken
version — #309's shape exactly. So: re-run `changeset status --verbose` after any
rebase onto a moved `main`, and re-read the range.

---

## 🔴 `changeset version` WILL NOT FIX A STALE FLOOR — it is not a backstop

`.changeset/config.json` sets `onlyUpdatePeerDependentsWhenOutOfRange: true`, so
a peer range is rewritten ONLY when the computed version falls OUT of it. A floor
that is too LOW is, by construction, still satisfied — so it is left exactly as
it is and ships stale.

The flag does bite in the other direction, which an earlier note recorded: run
before a rebase, when the computed version is BELOW the declared floor, it
rewrites the range DOWNWARD and drops the upper bound. Both readings say the
same thing — never let this number be the flag's problem.

Related: **no CI job runs `changeset status`** — tracked as **#367**. The guard
is the tree-local mitigation, not a fix.

---

## 🔴 A peer range is metadata and nothing checks it against the code

`0.49.0`–`0.51.0` of this package declared `>=0.29.0` while importing
`effectiveBrowsingCeiling` (app-sdk `0.39.0`) and the create-post types
(`0.40.0`). The range was SATISFIED, so no install warned; the failure landed at
module evaluation in a consumer's tests, where 27 of 43 test files collected ZERO
tests — 292 tests stopped running and the summary line reported no failures. See
**#309**.

**No build or typecheck can catch this**: `pnpm.overrides` maps the peer to the
workspace copy, so every in-repo typecheck, test and build resolves the symbol
from `packages/civitai-app-sdk` and is structurally blind to whatever the range
says.

### 🔴 Since #344 one gate does see part of it

`tests/guards/blocks-react-peer-floor.test.mjs` fails when the range admits an
app-sdk version measured NOT to export the App Storage constants, and when the
derivation stops being recorded in this file. Read its KNOWN LIMITS before
relying on it: CI checks out at `fetch-depth: 1` and the guard job has no
registry access, so it is offline and tree-local — it re-asserts a measurement
taken by hand, it does not take one. The recipe below is still the only way to
MAKE the measurement.

### 🔴 And #309's own suggested floor (`>=0.39.0`) was wrong

`effectiveBrowsingCeiling` arrives in `0.39.0`, but `BlockCreatePostRequest`,
`BlockCreatePostResult`, `BlockCreatePostHostError` and `BlockPostSource` arrive
in `0.40.0`, and there is no `0.39.x` patch between them. Landing the issue's
number would have closed it and stayed broken. **Do not take a floor from a
ticket.**

---

## To re-derive the floor

Do this when this package starts importing a new peer symbol.

1. **Collect the symbols** — every named `import` / `export … from
   '@civitai/app-sdk*'` clause in `src/`, plus bare and star forms, which name a
   SUBPATH and no symbols but still have to resolve. Measured at #344: 64
   distinct symbols over 2 subpaths (`/blocks` and `/safe-storage`), counting
   unique names across every named import clause in `src/**/*.ts{,x}`. An earlier
   derivation recorded 62; **re-count rather than trusting either figure.**
2. **In a scratch dir OUTSIDE this workspace** (pnpm would resolve the peer to
   the workspace copy and measure nothing), `npm i @civitai/app-sdk@<version>`
   and typecheck a file importing all of them — each in the POSITION it is
   imported in here, since a type-only export satisfies a plain value import and
   that is the #309 failure mode itself.
3. **The floor is the lowest version with zero missing.** Confirm the version
   BELOW it is missing something, or the floor is higher than it needs to be.
4. **Include a symbol you know does not exist, and check it reports.** A run
   that finds nothing is indistinguishable from one wired to nothing.

### Why there is no script for this

A 584-line script that automated the above was written and then cut: three audit
rounds found defects in the SCRIPT while the floor value it derived never
changed, and nothing in the repo ran it. The derivation is rare and the number is
recorded here; the tool was the expensive half.
