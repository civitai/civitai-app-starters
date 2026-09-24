---
'@civitai/app-sdk': minor
---

Re-vendor the canonical App Block manifest schema, which has grown a top-level
`auth` property, and add it to `BlockManifest`.

The live canonical at `https://civitai.com/schemas/app-block/v1.json` now
declares:

```json
"auth": {
  "type": "string",
  "description": "Which credential the host hands the block: \"block-token\" (default when omitted) is the block-scoped JWT; \"oauth\" opts the block into a real OAuth access token for its own OauthClient, accepted unchanged by /api/v1, the orchestrator and the MCP.",
  "enum": ["block-token", "oauth"]
}
```

That one property is the **entire** delta between the vendored mirror and the
live canonical — measured with a full `diff -u`, not a spot check.

**Minor, not patch**, for two consumer-visible reasons:

- `BlockManifest` gains a public optional field, `auth?: 'block-token' |
  'oauth'`. Before this release the schema and the types disagreed: the canonical
  already tolerated `auth` (the top-level object declares no
  `additionalProperties`, so it accepted *any* value), while `BlockManifestV1`
  rejected the property outright at compile time. A manifest that the platform
  accepts could not be written in TypeScript.
- `defineBlock` derives its runtime check from the vendored schema via Ajv, so
  re-vendoring **tightens** validation: `auth` is now constrained to the two
  enum members. `auth: "api-key"` was silently accepted locally and refused by
  the server; it is now refused locally too, on the `auth` field path.

Optional on purpose — the canonical does not list `auth` in `required`, and its
own description states that omitting it means `"block-token"`. Existing
manifests are unaffected.

This also unbreaks the `Canonical schema drift-check` CI job, which byte-compares
the mirror against the live URL and had been red on every PR in the repo since
the canonical changed.
