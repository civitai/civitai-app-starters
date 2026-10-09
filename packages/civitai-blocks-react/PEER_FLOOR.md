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

Declared today: `">=0.61.0 <1.0.0"`.

---

## 🔴 RAISED 0.57.0 → 0.61.0 (the seventh time), 2026-10-09 — the save-bytes cap

`hooks/useSaveImage.ts` and `internal/mockHost.ts` value-import one new peer
symbol from `@civitai/app-sdk/blocks`: `SAVE_BYTES_MAX_BYTES`, the 50 MiB cap on
`SAVE_IMAGE`'s `bytes` variant, from the new module
`src/blocks/saveImageLimits.ts` (#583). The hook refuses an over-cap buffer
before sending it, and the mock host refuses one with the host's string.

**`0.61.0` is a PREDICTION, pinned as one.** The symbol ships for the first time
in the app-sdk minor released with this change, so there is no tarball to probe
for a PRESENT reading. The number comes from the release plan: in-tree app-sdk is
`0.60.0`, this branch's changeset bumps app-sdk `minor`, and `pnpm exec changeset
status --verbose` prints `@civitai/app-sdk 0.61.0` (and `@civitai/blocks-react
0.66.0`). It is pinned via `PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH` plus the
`PREDICTED ENTRY` test, which re-derives the number from the tree on every run.

What *was* measured is that the symbol is absent from published versions, so the
run cannot start lower. Method: `npm pack` each tarball, untar it, then
`grep -l <symbol>` over `package/dist`. All rows were read 2026-10-09:

| version | `SAVE_BYTES_MAX_BYTES` | `BLOCK_SCOPES` (pos. ctrl) | `__NOPE_7f3a__` (neg. ctrl) |
|---|---|---|---|
| 0.60.0 (newest published on that date) | absent (0 files) | present (7 files) | absent |
| 0.59.0 | absent (0 files) | present (7 files) | absent |
| 0.57.0 (old floor) | absent (0 files) | present (7 files) | absent |

The rows are a sample. The claim that no published version has the symbol rests
on git history instead: `src/blocks/saveImageLimits.ts` is added by this branch.

🔴 **OWED AFTER THE RELEASE PUBLISHES:** empty
`PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH`. Then re-read the entry off the real
`0.61.0` tarball, using the newest version published below it as the ABSENT
control, and record both here.

---

## 🔴 RAISED 0.55.0 → 0.57.0 (the sixth time), 2026-10-03 — the nested-document helper

`hooks/useNestedDocument.ts` value-imports one new peer symbol from
`@civitai/app-sdk/blocks`: `fetchNestedDocument` — the `srcdoc` escape hatch for
embedding an app's own bundled document, new module
`src/blocks/nestedDocument.ts` (#532).

Why it was needed at all: a nested `<iframe src>` of the app's own content
cannot load and no manifest change fixes it. Two app versions shipped broken
before the cause was isolated. The derivation and the measured matrix are in one
place — the header of
[`packages/civitai-app-sdk/src/blocks/nestedDocument.ts`](../civitai-app-sdk/src/blocks/nestedDocument.ts).

**`0.57.0` is a PREDICTION, pinned as one.** The symbol ships for the first time
in the app-sdk minor released alongside this change, so there is no tarball to
probe for a PRESENT reading. Derived from the release plan: in-tree app-sdk
`0.56.0`; this branch's changeset bumps app-sdk `minor`; `pnpm exec changeset
status --verbose` prints `@civitai/app-sdk 0.57.0` (and
`@civitai/blocks-react 0.64.0`). It is pinned via
`PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH` plus the `PREDICTED ENTRY` test, which
re-derives the number from the tree on every run — so a rebase past another
app-sdk release goes **red** instead of drifting.

⚠ **The derivation above deliberately does NOT cite `npm view @civitai/app-sdk
version`,** and an earlier revision did — "in-tree app-sdk `0.56.0`, which is
also `npm view @civitai/app-sdk version`". That clause went false inside this
PR's own lifetime: `0.56.1` published 2026-10-03T23:43:58Z, about 71 minutes
before this branch's head commit. Nothing in the prediction depended on it —
`changeset status` computes the next version from the TREE, so the answer is
`0.57.0` whether the registry sits at `0.56.0` or `0.56.1` (re-run 2026-10-04
after `0.56.1` published: still `0.57.0` / `0.64.0`, exit 0). A figure a
conclusion does not rest on is pure decay surface, so it is gone rather than
re-dated.

What *was* measured, rather than predicted — that the symbol is absent from
every published version, so the run cannot start lower. `npm pack` of each
tarball, untarred, `grep -rl <symbol> package/dist`. **The `read on` column is
not decoration — only the `0.56.1` row was probed on 2026-10-04; the other two
are the earlier readings, carried forward unchanged and NOT re-run:**

| version | read on | `fetchNestedDocument` | `injectBaseHref` | `NestedDocumentError` | `BLOCK_SCOPES` (pos. ctrl) | `__NOPE_7f3a__` (neg. ctrl) |
|---|---|---|---|---|---|---|
| 0.56.1 (newest published as of that date) | 2026-10-04 | absent (0 files) | absent | absent | present (7 files) | absent |
| 0.56.0 | 2026-10-03 | absent (0 files) | absent | absent | present (7 files) | absent |
| 0.55.0 (old floor) | 2026-10-03 | absent (0 files) | absent | absent | present (7 files) | absent |

Both controls ran before those zeros were believed: the positive one shows the
probe can see this package's shipped code at all (a uniform "absent" is
otherwise indistinguishable from a probe wired to nothing), and the negative one
shows it can answer "no". The row for `0.56.1` is stamped with the date it was
read because "newest published" is a moving reading; the CONCLUSION it supports
is not, and was unaffected by the move.

`injectBaseHref` and `NestedDocumentError` ship in the same module and are
deliberately **not** ledgered: `src/` does not value-import them (the hook needs
only `fetchNestedDocument`), and the guard's `DERIVED FLOOR` test rejects an
entry for a symbol the package does not import. Same call as
`isValidBlockIdempotencyKey` below. `injectBaseHref` is additionally **not
exported from `./blocks` at all** — it stays module-internal, so it is not a
peer symbol any consumer could import; the rows above are a `grep` over the
tarball's `dist`, which sees a module-internal name just the same.

🔴 **OWED AFTER THE RELEASE PUBLISHES:** empty
`PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH`, re-read the entry off the real `0.57.0`
tarball with **the newest version published BELOW it** as the ABSENT control —
`0.56.1` as of 2026-10-04, but read the registry rather than trusting that — and
record both here. A list left populated pins the floor to the NEXT release
forever.

---

## 🔴 RAISED 0.49.0 → 0.55.0 (the fifth time), 2026-10-02 — the idempotency-key rule

`transport/transport.ts` began value-importing three new peer symbols from
`@civitai/app-sdk/blocks`: `BLOCK_IDEMPOTENCY_KEY_REGEX`,
`BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH` and `blockIdempotencyKeyRejection` — the
vendored host rule for a money-POST `idempotencyKey`, new module
`src/blocks/idempotency.ts`. They back `resolveIdempotencyKey`, the single
hook-boundary gate all three money hooks route their caller-supplied key through.

Why it was needed at all: a block sent `sheetId:panelId:nonce`, passed 201 local
tests, and then failed every production save with
`invalid_format` / `must match pattern /^[A-Za-z0-9_-]{1,64}$/` (400 on
`blocks.submitWorkflow`). The rule now lives in exactly one place.

**`0.55.0` is a PREDICTION, pinned as one.** These three ship for the first time
in the app-sdk minor released alongside this change, so there is no tarball to
probe. Derived from the release plan: in-tree app-sdk `0.54.0`, which was also
`npm view @civitai/app-sdk version` on the day (56 published versions); this
branch's changeset bumps app-sdk `minor`; so the release is `0.55.0`. It is
pinned via `PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH` plus the `PREDICTED ENTRY`
test, which re-derives the number from the tree on every run — so a rebase past
another app-sdk release goes **red** instead of drifting.

What *was* measured, rather than predicted — that the symbols are absent from
every published version, so the run cannot start lower. Three tarballs probed
with the standard recipe (`npm pack`, untar, resolve `exports['./blocks']` out of
the tarball's own `package.json`, `import()` it, read `Object.keys`):

| version | exports | the three symbols | `BLOCK_SCOPES` (pos. ctrl) | `__NOPE_7f3a__` (neg. ctrl) |
|---|---|---|---|---|
| 0.49.0 (old floor) | 34 | absent | present | absent |
| 0.53.0 | 34 | absent | present | absent |
| 0.54.0 (newest published on 2026-10-02) | 34 | absent | present | absent |

Both controls ran before the numbers were believed: the positive one shows the
probe can read this subpath's exports at all (a uniform "absent" is otherwise
indistinguishable from a probe wired to nothing), and the negative one shows it
can answer "no".

`isValidBlockIdempotencyKey` ships in the same module and is deliberately **not**
ledgered: `src/` does not value-import it (only tests do, and those resolve the
workspace copy), and the guard's `DERIVED FLOOR` test rejects an entry for a
symbol the package does not import.

✅ **SETTLED, AND THE PREDICTION WAS CORRECT — nothing is owed here.** The
release published, `PEER_SYMBOLS_PREDICTED_BY_THIS_BRANCH` was emptied, and the
three entries were re-read off the real tarballs (`npm pack @civitai/app-sdk@V`,
untar, `grep -rl <symbol> package/dist`) rather than off the workspace copy. The
registry was asked first each time it was re-read; **as of 2026-10-04 the top of
the line is `0.56.1`** (59 published versions), one more than the `0.56.0` an
earlier revision of this paragraph recorded as the top. Again, only the `0.56.1`
row was probed on 2026-10-04 — the three below it are earlier readings carried
forward, not re-run.

| version | read on | the three symbols | `BLOCK_SCOPES` (pos. ctrl) | `__NOPE_7f3a__` (neg. ctrl) |
|---|---|---|---|---|
| 0.54.0 (the version below) | 2026-10-03 | **absent** (0 files) | present (7 files) | absent |
| 0.55.0 (the floor) | 2026-10-03 | **present** (4 files each) | present (7 files) | absent |
| 0.56.0 | 2026-10-03 | **present** (4 files each) | present (7 files) | absent |
| 0.56.1 (newest published as of that date) | 2026-10-04 | **present** (4 files each) | present (7 files) | absent |

Which is what makes `>=0.55.0` **EXACT, not merely sufficient**: 0.54.0 cannot
start the run, and the run is unbroken from 0.55.0 to the newest version
published at the time of each reading. Both controls ran before the readings were
believed — the positive one shows the probe can see this package's shipped code
at all, the negative one shows it can answer "no". The floor is left where it is,
per the `PREDICTION HAS COME TRUE` test's own step 2.

⚠ **"Unbroken to the top" is a claim that EXPIRES, and that is the point of the
dates.** Every row above is a reading of one tarball and stays true forever; the
word "newest" is not a property of a tarball and goes stale on the next publish —
which it did, twice, within three days. When you extend this table, add a dated
row rather than re-labelling an existing one.

⚠ This paragraph read "🔴 **OWED AFTER THE RELEASE PUBLISHES**" until
2026-10-03, a day after the conversion had in fact completed (recorded in the
guard, not here). A settled item labelled as outstanding is the same defect as a
prediction labelled as a measurement, with the sign flipped.

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

- published **`0.49.0` exports ALL four** (34 symbols on `./blocks`) and was the
  newest published version on 2026-09-21, so the contiguous run was unbroken to
  the top as of that reading;
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
