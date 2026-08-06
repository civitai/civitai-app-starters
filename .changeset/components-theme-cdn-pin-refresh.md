---
'@civitai/components': patch
'@civitai/theme': patch
---

Refresh the stale CDN version pins in the shipped docs (`MARKUP.md`, both
`README.md`s, `demo/index.html`) to the currently-published versions —
`@civitai/theme@0.2.0` and `@civitai/components@0.3.0`.

Both links were still pinned at `@0.1.1` (published 2026-07-22), two minors
behind `components@0.3.0` (2026-07-29) and one behind `theme@0.2.0`
(2026-07-23). That URL still resolves — jsDelivr serves every published version
forever — so this never surfaced as a broken link. It silently served an old
stylesheet: `components@0.1.1/styles.css` is 8,713 B and carries rules for **10**
distinct `data-civitai-ui` values; `@0.3.0` is 28,042 B and carries **20**.

`MARKUP.md` documents 19 component sections. So an external HTML author
following the markup contract verbatim wrote correct, contract-shaped markup for
`checkbox`, `image`, `radio`, `radio-group`, `segmented-control`, `select`,
`slider`, `toast`, `toast-region` and `tooltip` against CSS that has no rules for
any of them — they render as unstyled bare elements, with no console error and no
failed request to notice. The theme pin was stale the same way: 17 `--civitai-*`
tokens at `0.1.1` vs 27 at `0.2.0`, so every token added since resolved to
nothing.

**These packages version INDEPENDENTLY — there is no shared version number.**
`@civitai/theme` has never published a `0.3.0`. Applying one version across both
links (the obvious-looking "bump them all to 0.3.0" fix) produces
`…/@civitai/theme@0.3.0/styles.css`, which is a hard 404 — and a stylesheet that
404s renders an unstyled page with no error either, so the wrong fix fails the
same silent way as the stale pin it replaces. `demo/index.html`'s comment now
says so at the point of copy-paste.

Every URL written here was verified to return 200 before commit, with the check
first validated against known-bad inputs (`theme@0.3.0` and `components@0.9.9`
both correctly reported 404).

Docs-only, but it needs a release: `MARKUP.md`, `README.md` and `demo/` are all
in `@civitai/components`'s `files`, and `README.md` is in `@civitai/theme`'s, so
the corrected copy only reaches npm — and the docs generated from it — on a
publish.
