---
'@civitai/sdk': minor
---

`AppClient.sharedStorage` — a generic cross-user key/value client over
`/blocks/shared-storage/*`, mirroring the per-viewer `AppClient.storage`.

Five methods: `list`, `get` (the `/item` route, matching its tRPC twin
`apps.shared.get`), `append`, `update`, `withdraw`.

**Minor, not patch or major.** Purely additive: one new property on `AppClient`
and six new exported types. No existing signature, type or behaviour changes, and
the regenerated `api/public-api.md` is an insertion with **zero deletions** —
which is the mechanical form of that claim, not a restatement of the intent.

⚠ One honest caveat on "additive": `AppClient` is an *interface*, so code that
**implements** it rather than consuming it — a hand-written test double, not a
normal app — must now supply `sharedStorage` or stop compiling. Consumers that
only call into it are unaffected.

## Deliberately five of eleven

The platform serves eleven shared-storage routes. This client wraps the five that
are key/value operations; **`vote`, `unvote`, `counts`, `top`, `increment` and
`report` are intentionally absent.** Shared storage is scoped to generic
key/value, and an app that needs voting, counters or reporting builds them at its
own layer on top of these five. The platform surface can expand later if demand
shows up. 🔴 The routes existing is not a reason to add a method — recorded in
`BREAKING.md` so the omission does not read as an oversight.

`SharedItem` still carries **`count` and `viewerVoted`** as the read routes
project them: reading a tally is exactly what makes an app-layer vote feature
possible, and only the vote-casting operation is out of scope.

## No app is unblocked by this yet — the port is what needs it

An earlier draft of this changeset claimed the surface unblocked a shipping
"Popular" rail in `civitai-app-playable-collections`. **That was false.** Measured
in that repo's `package.json`: its Civitai dependencies are `@civitai/app-sdk`
and `@civitai/blocks-react` — it does **not** depend on `@civitai/sdk` at all. It
is blocked on being *ported*, and the port is what needs this surface to already
exist. Nothing ships against it today.

The seam test's mirrored `PopularRailStore` slice went with that claim: a mirror
of a slice nobody declares reads as coverage while pinning nothing, and it froze a
shape (`vote`) this client does not even carry. `test/shared-storage/seam.test.ts`
now says so in place of the mirror, and records what to add when the first app is
actually ported.

## What the port off the bridge actually costs

`@civitai/blocks-react`'s `useSharedStorage` is what the fleet uses today, and it
is **the bridge** — it sends `SHARED_*` messages over `postMessage` and never
touches `/api/v1`; the host receives them and calls tRPC `apps.shared.*`, injecting
the credentials. So it is the LEFT column of `BREAKING.md`'s master table, not a
rival HTTP client of the right one.

The transport changes from `postMessage` to HTTP, but **the credential and the
CORS declaration are already handled by code that exists**: `createHttp` sends
`Authorization: Bearer <token>` on every request and retries once on a `401`, the
token still comes from the host over the bridge (`REQUEST_TOKEN` — the host keeps
minting and rotating it), all five routes declare `allowOpaqueOrigin`, and scopes
are identical on both transports. No token plumbing, no CORS work, no manifest
change.

The remaining work is at the call sites: narrow `value` from `unknown`, move
vote/counter/report logic into the app layer, branch on `ApiError.status` where
the bridge surfaced a message, and audit every `limit`.

⚠ `BREAKING.md` records that this section has had three framings and that two are
retracted — *"a second client for these same routes"* (false: different
transports) and *"budget for the token/CORS work"* (false: both already handled) —
so the ground is not re-walked.

Two divergences worth calling out among the five kept methods:

- **`list({ limit })` is validated, not normalised — three changes, not one.** The
  bridge *host* clamped out-of-range to 1…100, floored non-integers, and fell back
  to 50 for anything non-finite. The REST route's
  `z.coerce.number().int().min(1).max(100)` **`400`s on all three**. The sharp one:
  `Number(param)` on a missing value is `NaN`, which used to mean "give me the
  default" and is now a failed request. The `400` body is
  `{ error: 'Invalid query', details }`, so `ApiError.message` reads only "Invalid
  query" — the field-level reason is in `ApiError.body.details`. This client
  deliberately does not re-clamp: bounds stay the server's, and a guard here
  enforces that the module carries no numeric literal at all.
- **A listed row's `value` is `unknown`**, versus the hook's typed
  `SharedAppendValue`. Deliberate and wire-honest: the row was written by another
  viewer's copy of the app, possibly an older version, so its shape is a fact
  about stored data rather than a promise a client can keep.

## Four ways this is NOT a copy of the per-viewer client

Each would have been an invisible bug had the per-viewer shape been assumed, and
each is pinned by a mutant watched to go red:

- **The two reads are `GET` with a query string**, the three writes `POST`. The
  read routes answer `405` to a POST.
- **`list` is enveloped**: `{ items, metadata: { nextCursor } }`, so the cursor
  arrives one level deeper than the per-viewer client's top-level `nextCursor`.
  Reading the wrong level yields a well-formed page with pagination silently
  dead — caught by a fixture pair differing only in the cursor's location.
- **`append` accepts no key** — the server mints a ULID, so one viewer cannot
  overwrite another's row.
- **An anonymous viewer MAY read and may never write.** This inverts the
  per-viewer rule, where every call is refused without a subject. Signed-out
  browsing is supported; an anon write is a `403` from the scope binding, and a
  *signed-in* viewer below the server's minimum-trust gate is also refused.

## Guard philosophy, carried over verbatim

Every failure rejects; no path resolves to mean "not written" or "could not
read". A malformed 200 throws rather than manufacturing an empty store, because a
caller renders an empty page to every viewer as "this store is empty".

`list` guards **`metadata` symmetrically with `items`**, rather than defaulting it
to `{}`. `metadata` is where `nextCursor` lives and the cursor's absence is what
proves a scan completed, so a lenient default would turn a malformed envelope into
`nextCursor: undefined` — stopping a caller's paging loop after page one and
rendering 50 of 5,000 rows as the whole store, while the identical malformation of
`items` threw. A well-formed empty envelope still resolves; that is the last page.

Both
timestamps are revived through a type gate *and* a NaN gate, since
`new Date(null)` is the epoch rather than an Invalid Date and would sort wrong
forever without throwing.

The module contains **no numeric literal at all** — every bound (key length,
prefix, cursor, both list limits, the value byte cap) stays the server's, pinned
by a scanner with its own positive control.

## Verification

Re-measured after the surface cut; the earlier run covered methods that no longer
exist.

- `packages/civitai-sdk/vitest.config.ts` via `pnpm --filter @civitai/sdk test`:
  **19 files / 230 tests passed**, up from 17 / 187 at `origin/main` (203bcef),
  which was measured green first — so no failure here is attributed to a
  pre-existing red.
- **Mutation battery over the five surviving methods: 23 mutants, 23 killed, 0
  survived**, each by a test naming that guard. Harness validated with both
  controls: an unmutated tree green, and a known-bad mutant observed red before
  any result was believed. Counted from the runner's own per-test result lines,
  not an exit code.
- `pnpm --filter @civitai/sdk typecheck` and `check:layering` clean; `api:check`
  was **stale before regeneration**, which is the evidence that gate actually
  covers this package's surface.
- The two storage fakes' byte-identical wire helpers (`utf8`, `toBase64`,
  `fromBase64`, `jsonResponse`, `SEED_EPOCH_MS`) are now one copy in
  `test/support/wire.ts`.
