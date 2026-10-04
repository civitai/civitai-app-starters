---
'@civitai/sdk': minor
---

`sharedStorage.list({ mine: true })` — narrow the shared board to the viewer's
own rows, over the REST route.

The sibling of the `@civitai/blocks-react` change in this release, against the
other transport. The server half shipped in civitai/civitai#5361 (squash
`1d758251b9` on `main`) as `GET /api/v1/blocks/shared-storage/list?mine=true`;
`SharedListQuery` could not express it, so no app on this client could send it.

`SharedListQuery` gains `mine?: boolean`, passed through to the query string
beside `prefix`/`limit`/`cursor`.

🔴 **The SERIALISATION is the load-bearing part, and it has exactly one correct
shape.** The route's schema is
`z.union([z.literal('true'), z.literal('false')]).optional()` — deliberately not
`z.coerce.boolean()`, which maps the string `"false"` to **true** — and an
unrecognised value **400s** rather than defaulting. So:

| `mine` | wire |
|---|---|
| `true` | `?mine=true` |
| `false` | `?mine=false` |
| `undefined` | the param is **omitted entirely** |
| `''` / anything else | `?mine=` → **400 Invalid query** |

`?mine=` is the standard rendering of an unset form field, which is exactly why a
`String(query.mine)` or a `?? ''` in this client would look harmless and then
break **every** default listing. The boolean is handed to `urlFor` unchanged —
it renders a boolean with `String()` and drops `null`/`undefined` before
appending — and the comment at the call site says not to normalise it or give it
a fallback.

All four wires are pinned in `test/shared-storage/shared-storage.test.ts`,
watched red before the change. The omitted cases assert **key presence** against
the recorded query (which is built from `searchParams`, so an emitted `?mine=`
reads as `{ mine: [''] }` and fails a whole-object `toEqual({})`) rather than
comparing a value to `undefined` — the comparison that cannot distinguish
"omitted" from "emitted empty", nor a dropped field from one the client never
sends.

**`mine` is a BOOLEAN rather than a user id, and the reason is YAGNI, not a
capability boundary.** `SharedItem` already carries `authorUserId`, so singling
out one author is already possible by paging; this removes the cost, not a
restriction. Rows are world-readable either way. 🔴 An **anonymous** viewer —
who may read this store — gets an EMPTY page under `mine`, so an empty result
there is not evidence the store is empty. Authoritative prose lives on
`listSharedRows`' JSDoc in civitai/civitai
`src/server/routers/apps-shared.router.ts`.

`api/public-api.md` is regenerated (`pnpm --filter @civitai/sdk api`), which is
what `api:check` gates in CI.
