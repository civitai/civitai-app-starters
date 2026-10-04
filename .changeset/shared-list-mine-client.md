---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

`useSharedStorage().list({ mine: true })` — narrow the shared board to the
viewer's own rows.

**The server half already shipped and nothing could reach it.** `mine` landed in
civitai/civitai#5361 (squash `1d758251b9` on `main`) on three server surfaces at
once: `apps.shared.list`'s tRPC input, `GET /api/v1/blocks/shared-storage/list`,
and both bridge hosts (`PageBlockHost.tsx`, `IframeHost.tsx`), which already
forward it from a `SHARED_LIST` postMessage to tRPC. No published client could
spell it, so the parameter existed and was unreachable from a block. This is the
client half.

**`@civitai/app-sdk`** — the `SHARED_LIST` message payload gains
`mine?: boolean`, so the field is now part of the bridge contract a block
compiles against. Additive and optional; a payload without it is unchanged.

**`@civitai/blocks-react`** — `UseSharedStorage.list`'s `opts` gains
`mine?: boolean` and the hook forwards it, plus both in-repo hosts:

- **`liveHost`** forwards it to `apps.shared.list` only when it is a real
  `boolean`, following the same shape as the existing `prefix`/`cursor` guards.
  🔴 As a **boolean**, not a string: the tRPC input is
  `mine: z.boolean().optional()`. The `'true'`/`'false'` literal union is the
  REST route's shape, not tRPC's, and the two must not be conflated. A
  non-boolean (the `'true'` string a careless caller sends) is dropped rather
  than passed through.
- **`mockHost`** filters the in-memory board by author when `mine` is `true`, so
  a block author can exercise the "my published" path under `dev:mock` instead of
  discovering it only against a live host. It composes with `prefix` and the
  cursor rather than replacing them — a filter applied to page one only would
  surface another author's row on page two, which is what the paged test asserts.
  No new scope: `SHARED_LIST` is already gated by `apps:storage:shared:read`.

**An anonymous viewer asking for `mine` gets an EMPTY page** — not an error and
not the whole board — and the mock now mirrors that. Server-side it falls out of
`s.author_user_id = $4::int` being UNKNOWN for a NULL subject. 🔴 In the mock it
needs an explicit flag, because `mockUserId` falls back to `0` for an anonymous
viewer and `0` is *also* the `authorUserId` a seeded row defaults to in that same
case — so a filter keyed on `mockUserId` would hand an anonymous caller the whole
seeded board under a flag whose entire purpose is to narrow it. The test fixture
for that case is deliberately authorless, because it is the only shape that can
see that bug; it carries a positive control showing the same two rows ARE readable
without `mine`, so a mock that simply refused every anonymous read could not pass.

**`mine` is a BOOLEAN rather than a user id, and the reason is YAGNI, not a
capability boundary.** Every listed item already carries `authorUserId`, so
singling out one author is **already** possible by paging the board — which is
the exact cost this parameter removes. A `mine=<userId>` form would make that
*cheap*, not *possible*, and rows are world-readable either way, so this adds no
read reach. The surviving argument is narrower and sufficient: nothing asks for
it, and widening a boolean to an id later is easy where narrowing an id back to a
boolean after clients depend on it is not. Authoritative prose lives on
`listSharedRows`' JSDoc in civitai/civitai
`src/server/routers/apps-shared.router.ts`; the doc comments here point at it
rather than restating it.

**Back-compat on an OLDER host.** A host predating civitai/civitai#5361 does not
read the field, so it returns the whole board. That is why
`UseSharedStorage.list`'s own JSDoc says a block rendering "my published" from
this should still compare `authorUserId` before trusting the page on an unknown
host — the flag is an optimisation of a filter the block can already perform, so
degrading to it is correct rather than broken.

**The waiting consumer.** `ZacxDev/civitai-app-custom-generators`
`src/App.tsx:407` does `shared.filter((s) => s.authorUserId === viewer.id)` over
a **single page** (`App.tsx:385`, no pagination loop), so its "my published" list
is silently incomplete today for any author whose rows have scrolled past the
newest page.

**Coverage — every new test was watched RED on pre-change code.**

- `@civitai/app-sdk` `test/blocks/shared-messages.test.ts` — the `SHARED_LIST`
  fixture gains `mine: true`, plus a case pinning the payload's argument key set
  as a ledger (so it fails when the args grow *or* shrink) and the omitted case.
  This is a **TYPE** claim: before `mine` existed on the payload the literal did
  not compile, and `tsc -p tsconfig.typecheck.json` runs as part of
  `pnpm --filter @civitai/app-sdk test`. A published client that cannot SPELL the
  field cannot send it, which is the whole defect.
- `@civitai/blocks-react` `test/useSharedStorage.test.tsx` — the hook forwards
  `true`, `false` and absent. `false` must survive as `false` rather than
  collapsing to absent.
- `@civitai/blocks-react` `test/liveHost.test.tsx` — the tRPC input carries the
  real boolean for `true`/`false`, and the key is ABSENT for both an omitted
  value and a `'true'` string.
- `@civitai/blocks-react` `test/mockHostShared.test.tsx` — the author filter with
  its paired whole-board control, composition with `prefix` + a second page, and
  the anonymous-viewer-empty-page case with its positive control.

🔴 **Every "the field is absent" assertion is a KEY-PRESENCE test (`'mine' in …`,
or whole-object equality against the recorded query), never
`toHaveBeenCalledWith({ …, mine: undefined })`.** That matcher uses `toEqual`
semantics, so `{ mine: undefined }` **equals** an object with no `mine` key — a
test written that way passes against a client that never forwards the field at
all, which is precisely the pre-change state. It cost a round on the server side
of this same arc before being written down.

**One type widening worth knowing about.** Both hosts cast the inbound
`postMessage` to one union-of-all-payload-fields object, and `mine` is declared
there as `unknown`, not `boolean` — matching the existing treatment of `sources`
and `idempotencyKey`. The handlers' `typeof … === 'boolean'` / `=== true` tests
are what decide whether the value is honoured, and a `boolean` annotation would
assert the property under test and make those tests look redundant to a later
reader.
