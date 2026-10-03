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
