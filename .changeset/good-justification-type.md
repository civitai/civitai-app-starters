---
'@civitai/app-sdk': minor
---

Type `justification` on `BlockManifestGood`, and document the three extra rules
the platform applies to an `app_unlock` good.

**Minor, not patch**: `BlockManifestGood` gains a public optional field,
`justification?: string`. Without it a manifest the platform *requires* cannot be
written in TypeScript — `goods[].justification` is mandatory on an `app_unlock`
good server-side, so an author declaring a paid app would have had their
`defineBlock` call rejected at compile time for writing the field the submit
gate demands.

**This lands AHEAD of the schema bytes on purpose, and that ordering is the
point.** The canonical schema in `civitai/civitai` grows the matching
`justification` property in the same arc, and the re-vendor bot that pulls those
bytes in gates its PR on `pnpm --filter @civitai/app-sdk test`. That gate
includes `canonical-derivation.test.ts`'s nested-property guard, which fails on
any schema property not typed on the interface modelling it. Measured both arms
against the vendored schema with the property added:

- schema has `justification`, interface does not → **red**, with
  `goods.justification (missing on BlockManifestGood)`
- schema has it and the interface types it → **green**

So without this change the bot's gate fails, it opens no PR at all, and
`Canonical schema drift-check` stays red on every PR in this repo until someone
adds the field by hand. With it, the re-vendor is a clean byte-only follow-up.

**No schema re-vendor here.** `packages/civitai-app-sdk/schemas/app-block/v1.json`
is left byte-identical to the live canonical. The drift-check compares the
vendored copy against the **live published URL**, so vendoring the new bytes now —
before a `main` → `release` cut publishes them — would turn that job red
*immediately* rather than at the deploy. Verified green with the type change
alone: 429 tests across 27 files.

Existing manifests are unaffected: the field is optional, and the platform
requires it only for `kind: 'app_unlock'`, which no published app declares.

The `kind` doc comment now also records the three `app_unlock`-only rules the
platform validator enforces and the JSON Schema deliberately does not express —
`priceBuzz` at most 5000 (not the 50000 the general bound allows), at most one
`app_unlock` good per manifest, and the mandatory `justification` — so a local
validation pass is visibly necessary rather than sufficient.
