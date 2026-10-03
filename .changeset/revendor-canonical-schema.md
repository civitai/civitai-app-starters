---
'@civitai/app-sdk': patch
---

Publish the re-vendored canonical App Block manifest schema, which now carries
`goods[].justification`.

The bytes were mirrored by #529 but never released, and the vendored schema is
**published**: it ships in the tarball, is exported as
`./schemas/app-block/v1.json`, and `defineBlock` validates against it at
runtime. So every installed copy of this package was still validating manifests
against the previous schema.

That was not a cosmetic lag. `goods.items` sets `additionalProperties: false`,
so the stale copy **rejected** `justification` rather than merely failing to
check it — while the server **requires** that field when `kind` is
`"app_unlock"`. An author declaring the first paid app therefore had a manifest
the platform demands and this SDK refused.

The TypeScript side of the field shipped separately in `0.56.0`; this releases
the schema that validates it.

**Why `patch`.** This is a vendored-schema parity fix and it is permissive-only,
which `RELEASING.md` now names as a `patch` carve-out. The change ADDS an optional
property under `goods.items`, which has `additionalProperties: false`, so it can
only make a manifest that previously FAILED start validating — no manifest that
validated before this change fails after it. And pre-1.0 a caret pins the minor,
so a `minor` here would withhold the corrected schema from every caret-pinned
consumer, leaving them with a package that rejects manifests the platform
requires. That is the opposite of the fix.
