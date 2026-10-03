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

**Why `patch` when the script now defaults to `minor`.** That default is for a
change whose direction the script cannot classify, and it is deliberately the
breaking level because the only canonical changes that reach the automated path
are constraint-*tightening* ones. This change was read and is the opposite: it
ADDS an optional property under `goods.items`, which has
`additionalProperties: false`, so it can only make a manifest that previously
FAILED start validating. No manifest that validated before this change fails
after it, so nothing moves under a consumer and `patch` is correct.
