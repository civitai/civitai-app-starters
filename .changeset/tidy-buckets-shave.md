---
'@civitai/sdk': minor
---

`AppClient.storage` — the viewer's own per-app key/value store, on the same
`http` instance `site` uses, so a `siteUrl` override redirects it too.

`get` / `set` / `delete` / `list` / `getQuota` over
`/api/v1/blocks/app-storage/*`. Three properties the surface is built around,
because five fleet apps depend on them and one of those dependencies is a money
decision:

- **Every failure rejects.** No path resolves to mean "not written", and none
  resolves to mean "could not read". A malformed 2xx throws a `CivitaiError`
  rather than degrading to `null` or an empty page — an app that writes an
  in-flight claim before spending Buzz stands its double-charge backstop down on
  a scan that completed, and a manufactured empty page is indistinguishable from
  one.
- **`nextCursor` is passed through untouched** — never defaulted, normalised, or
  re-derived from `keys.length`. Its absence is the caller's proof a scan
  finished.
- **`updatedAt` is revived to a `Date` once, here**, which is where
  `@civitai/blocks-react` already put it, so the consumers compile unchanged.

Also adds `isQuotaRefusal(error)` — the structural test for "this write can
never succeed as-is" (HTTP 413), so apps do not match on server prose — and
`createFakeAppStorage()` in `@civitai/sdk/testing`, a `fetch`-shaped stand-in
for the five routes whose page size defaults to 3 and whose ledger records what
the *client* sent.
