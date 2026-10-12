---
'@civitai/app-sdk': patch
---

Re-vendor the canonical App Block manifest schema from
https://civitai.com/schemas/app-block/v1.json.

The vendored schema is published — it ships in the tarball, is exported as
`./schemas/app-block/v1.json`, and `defineBlock` validates against it at
runtime — so mirroring the bytes only takes effect once the package is
released. This changeset is what releases them.

`patch` is the automated default for a vendored-schema parity fix, correct when
the re-vendor is permissive-only, which the reviewer checks before merging. The
rule and what counts as a tightening are in `RELEASING.md`:
https://github.com/civitai/civitai-app-starters/blob/main/RELEASING.md

(That is an absolute URL on purpose: this text is copied verbatim into the
published CHANGELOG, where a relative repo path resolves to nothing — and
`RELEASING.md` is not in the npm tarball.)
