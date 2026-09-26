---
'@civitai/sdk': minor
---

`AppClient.sharedStorage` — a client for the eleven `/blocks/shared-storage/*`
routes, mirroring the per-viewer `AppClient.storage`.

**Minor, not patch or major.** Purely additive: one new property on `AppClient`
and eight new exported types. No existing signature, type or behaviour changes,
and the regenerated `api/public-api.md` is a 232-line insertion with **zero
deletions** — which is the mechanical form of that claim, not a restatement of
the intent. Not a major because nothing was removed or altered.

⚠ One honest caveat on "additive": `AppClient` is an *interface*, so code that
**implements** it rather than consuming it — a hand-written test double, not a
normal app — must now supply `sharedStorage` or stop compiling. Consumers that
only call into it are unaffected. That is the standard cost of widening a public
interface and is why this is a minor rather than a patch.

## The surface, and the route behind each method

Eleven methods, one per route. Every shape was read off the handler on
`civitai@origin/main` (`5c8386cf`) plus the single implementation each adapter
delegates to in `src/server/routers/apps-shared.router.ts` — not inferred from
the route name.

| Method | Route |
|---|---|
| `list(query?)` | `GET /list` |
| `get(key)` | `GET /item` |
| `counts(keys)` | `GET /counts` |
| `top(query?)` | `GET /top` |
| `append(value)` | `POST /append` |
| `update(key, value)` | `POST /update` |
| `vote(key)` | `POST /vote` |
| `unvote(key)` | `POST /unvote` |
| `withdraw(key)` | `POST /withdraw` |
| `report(key, reason?)` | `POST /report` |
| `increment(key)` | `POST /increment` |

Nothing was left out, and no method exists without a route behind it.

## Four ways this is NOT a copy of the per-viewer client

Each of these would have been an invisible bug had the per-viewer client's shape
been assumed, and each is pinned by a mutation that was watched to go red:

- **The reads are `GET` with a query string**, not `POST` with a body. The four
  read routes answer `405` to a POST. A uniform-POST copy fails 19 tests.
- **`list` is enveloped**: `{ items, metadata: { nextCursor } }`, so the cursor
  arrives one level deeper than the per-viewer client's top-level `nextCursor`.
  Reading the wrong level yields a well-formed page with pagination silently
  dead — the mutant is caught by a pair of fixtures that differ only in the
  cursor's location.
- **`top` answers a BARE ARRAY** — `[{ key, count }]`, with no `items` and no
  `metadata`, unlike `list` beside it.
- **An anonymous viewer MAY read and may never write.** This inverts the
  per-viewer client's rule, where every call is refused without a subject.
  Signed-out browsing is a supported path here; an anon write is a `403` from
  the scope binding, and a *signed-in* viewer below the server's minimum-trust
  gate is also refused. `viewer === null` gates the write affordances only.

## Guard philosophy, carried over verbatim

Every failure rejects; no path resolves to mean "not written" or "could not
read". A malformed 200 throws rather than manufacturing an empty feed, because a
caller renders an empty page to every viewer as "this feed is empty". `counts`
asserts one entry per requested key rather than defaulting to `0` — a silent `0`
reads as "nobody voted for this". `vote`/`unvote` assert the tally rather than
defaulting it, because a manufactured `0` reads to the viewer as "your vote did
not land" for a vote that did. Both timestamps are revived through a type gate
*and* a NaN gate, since `new Date(null)` is the epoch rather than an Invalid
Date and would sort wrong forever without throwing.

The module contains **no numeric literal at all** — every bound (key length,
prefix, cursor, counts batch, reason, both list limits, the value byte cap) stays
the server's, pinned by a scanner with its own positive control.

## Verification

- `packages/civitai-sdk/vitest.config.ts` via `pnpm --filter @civitai/sdk test`:
  **19 files / 244 tests passed**, up from 17 / 187 at `origin/main` (203bcef),
  which was measured green first — so no failure here is attributed to a
  pre-existing red.
- **Mutation battery, 32 mutants, 32 killed, 0 survived**, each by a test naming
  that guard. Harness validated with both controls: an unmutated tree green (57
  result lines), and a known-bad mutant observed red before any result was
  believed. Counted from the runner's own per-test result lines, not an exit
  code.
  - One mutant taught something and the test was fixed rather than the score
    accepted: `counts` comma-joining its keys was originally checked with a
    single `['a,b']` fixture, where the joined and unjoined spellings put the
    **same bytes** on the wire — so that guard could not see the mutation it
    named. It now uses two keys, one containing a comma.
- `pnpm --filter @civitai/sdk typecheck` and `check:layering` clean;
  `api:check` was **stale before regeneration**, which is the evidence that gate
  actually covers this package's surface.
