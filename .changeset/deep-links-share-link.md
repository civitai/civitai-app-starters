---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': patch
---

**Deep links into app state, a share link, and a working Back button inside an app.** All additive: an older host sends none of the new fields and answers `SHARE_LINK` with its generic unsupported-message error.

- **`search` and `hash` reach the app.** `PageSlotContext` gains optional `search` (`''` or `'?…'`) and `hash` (`''` or `'#…'`), and `ROUTE_CHANGED` carries both. The host reads them from its own URL, strips its launch-origin `from` pair, and sends `''` for a value over 2048 chars.
  - `@civitai/blocks-react`: **`useCivitaiLocation()`** returns `{ subPath, search, hash }` and follows every `ROUTE_CHANGED`, including a search-only or hash-only move. `useCivitaiRoute()` is unchanged and still returns the bare `subPath` string.
- **`SHARE_LINK { requestId, subPath, search?, hash? }` → `SHARE_LINK_RESULT { requestId, result?: { url, copied, method }, error? }`.** The host builds the canonical `https://civitai.com/apps/run/<slug>/<subPath><search><hash>` URL from its own origin and slug. It then copies the URL, or opens the native share sheet on a phone.
  - `copied` is `true` only when the clipboard write resolved. `method` is `'clipboard'`, `'share'` or `'none'`. With `'none'`, show `url` as selectable text.
  - A view that would leave the app (`..`, `//host`, a scheme) is refused with `'invalid share link'`. The other refusals are `'sharing is not available here'`, `'the app is not ready yet'` and `'rate_limited'` (one share at a time, at most one per second).
  - The copy needs the viewer's click, so call `share()` from the click handler.
  - `@civitai/app-sdk` adds `BlockShareLinkRequest`, `BlockShareLinkResult` and `BlockShareLinkMethod` on `./blocks`. The pinned `./blocks` export count moves from 236 to 239.
  - `@civitai/blocks-react`: **`useShareLink()`** returns `{ share, isPending, error, lastResult }`. `share()` with no argument links to the view showing now. A malformed reply rejects instead of hanging. The request waits the human bound (10 min), because a share sheet answers only when the viewer acts.
- **Back and Forward.** An app-scoped navigate is a real history entry on the host page. A navigate to the view already showing adds none. The host sends `ROUTE_CHANGED` when the viewer presses Back or Forward. `NAVIGATE` gains `replace?: boolean`, and `useCivitaiNavigate().navigate(path, { replace: true })` replaces the entry instead of pushing a new one. An app that switches views with local state alone gets no history entries, so Back leaves the app. The blocks-react README shows the pattern.
- **Mock host:** `SHARE_LINK` answers with the canonical URL, built from the context slug, and refuses escapes. The `shareLink: { copied: false }` and `shareLink: { method: 'share' }` options and the `shareLinkError` option simulate the other outcomes. An app-scoped `NAVIGATE` now moves the mock's route and pushes `ROUTE_CHANGED` with `search` and `hash`.
- **dev:live:** `ROUTE_CHANGED` carries `search` and `hash`. A `?query#hash` in a navigate path no longer ends up inside `subPath`. `replace: true` replaces the history entry, and a navigate to the current view adds none. `SHARE_LINK` builds the URL on the backend origin and writes the clipboard.
- `@civitai/sdk`: the host reply ledger lists `SHARE_LINK`, so `request('SHARE_LINK', …)` settles with `{ url, copied, method }`.
- ⚠️ After upgrading, reinstall in every checkout. A stale `node_modules` reports type errors in your own source files that look like a broken main.
