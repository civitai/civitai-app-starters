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

The public surface this adds is exactly `AppClient.storage` plus its six types
(`StorageClient`, `StorageCallOptions`, `StorageKeyEntry`, `StorageListQuery`,
`StorageListResult`, `StorageQuota`). Nothing else.

No `isQuotaRefusal` helper: a size or quota refusal arrives as the already-public
`ApiError` carrying `status`, so `error instanceof ApiError && error.status ===
413` is the same one-liner at the call site, and no consumer in the fleet
branches on a storage status today. `@civitai/sdk/testing` is unchanged — the
app-storage fake stays in this package's own test suite, because four of the five
apps that store per-viewer state need knobs it does not have. Either can be
promoted later; neither can be un-shipped.
