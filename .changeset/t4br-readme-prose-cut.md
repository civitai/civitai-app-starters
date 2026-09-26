---
'@civitai/blocks-react': patch
---

README: delete the rotted per-module byte table, the `pnpm pack` diff, and the
section re-arguing the `./live` split.

Documentation only — no API, type or behaviour change. The README ships inside the
published tarball and reaches the npm package page and IDE hover, so a stale
hand-typed figure there is a defect a consumer reads.

The byte table and the pack diff were **deleted rather than refreshed**: a
hand-typed byte count in prose is unguarded by every check in this repo and rots
again on the next build. The facts a reader needs — that these modules ship in
every install, that they are tree-shaken out of application bundles, and that
`files` plus `tsconfig` (not the `exports` map) decide tarball contents — survive
without naming a number. The measured figures remain on the record in
`CHANGELOG.md` for `0.55.0`.
