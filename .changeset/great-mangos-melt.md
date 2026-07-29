---
'@civitai/app-sdk': minor
---

Add the optional manifest `tagline` — a one-line store pitch.

Mirrors civitai/civitai#3441, which makes `tagline` a first-class OPTIONAL
manifest field. Previously the field existed only for off-site listings, so every
ONSITE app's `/apps` card + detail page rendered an empty tagline slot and
`/apps/my-submissions` warned about a field with no authoring surface anywhere.

- `BlockManifestV1` gains `tagline?: string`.
- New exported `BLOCK_TAGLINE_MAX_LENGTH` (140) — the same bound off-site
  listings use, so both store kinds render the same slot.
- `defineBlock` validates it: when present it must be a string whose **trimmed**
  length is 1..140, mirroring the server's authoritative check (which also
  trims), so a padded-but-fitting value is never rejected client-side and then
  accepted at submit.
- The vendored `schemas/app-block/v1.json` is re-vendored byte-identically from
  the canonical, and the schema-parity test ties the schema's `tagline.maxLength`
  to `BLOCK_TAGLINE_MAX_LENGTH`.

Backward-compatible: the field is optional, so every existing manifest still
validates and existing callers are unaffected.
