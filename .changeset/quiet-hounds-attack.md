---
'@civitai/app-sdk': minor
---

**`defineBlock` is a real gate now** — reconciled field-by-field with the canonical manifest schema, and actually wired into every block scaffold (#330).

It used to claim it was "a strict subset of what the civitai/civitai server enforces". It was not a subset in either direction: it required **11** fields where the canonical requires **5** (`appId` among them, which the canonical does not declare at all) while leaving `renderMode`, `buildCommand`, `outputDir`, `publicSettingsKeys`, `assetBundleUrl`, `repository`, `page`, `bootSkeleton` and `scopeJustifications` entirely unchecked. The clearest symptom: it **rejected every `block.manifest.json` this repo ships**, including the one `civitai app init` scaffolds, because it required `iframe.src` — the one field the platform assigns itself and refuses at submit.

**Breaking, if you were typing a manifest by hand**

- `$schema`, `appId`, `type`, `targets`, `iframe` and `minApiVersion` are now **optional** on `BlockManifestV1`, matching the canonical's five-field `required` array (`blockId`, `version`, `name`, `contentRating`, `scopes`). Widening — existing manifests keep type-checking.
- `iframe.src` and `trustTier` are typed `never` and **rejected at runtime**. Both are SERVER-OWNED; a manifest that declares either is refused at submit, so it is refused locally too. **If you were setting `iframe.src`, delete it** — the platform stamps `https://<blockId>.civit.ai/` at build/approve.
- `manifest.type` narrows to `'block'`. The canonical enum has exactly one member; `'embed'` was never valid there.
- `ManifestTarget.priority` is optional (not a canonical property).

**Relaxed**

- No 80-character cap on `name` — the canonical explicitly imposes none.
- An empty `scopes` or `targets` array is accepted — the canonical sets no `minItems`.
- `iframe` needs no sub-fields; `appId` is tolerated (it belongs in `civitai.app.json`) but never required.

**Newly enforced** — the canonical rules that were silently unchecked: `iframe` bounds (40–4000 px) and its `additionalProperties: false`; `minApiVersion` format; `targets` `maxItems: 16`; `renderMode`; `bootSkeleton`; `repository`; `buildCommand` allowlist + its `outputDir` requirement; `outputDir` traversal/absolute/drive-prefix rules; `publicSettingsKeys` bounds; `assetBundleUrl`; the `page` surface; `scopeJustifications` shape.

**Where it runs.** Every scaffold that ships a manifest (`starters/civitai-block-starter` and all six `starters/examples/*`) now registers `vite-plugin-block-manifest.ts`, which calls `defineBlock` from Vite's `configResolved` — so `pnpm dev`, `pnpm dev:harness` and `pnpm build` all fail on a bad manifest, with the offending field path. Previously `defineBlock` had **no caller outside markdown**.

The remaining deliberate extras are itemised in the `SCHEMA_DIVERGENCES` table in `src/blocks/defineBlock.ts` (each entry a server rule the canonical states only in prose, with its reason; not re-exported from `@civitai/app-sdk/blocks`, so the public surface is unchanged), and `KNOWN_GAPS` records what only the server can check — passing `defineBlock` is necessary, not sufficient. `test/blocks/schema-parity.test.ts` now runs Ajv over the vendored schema and fails if the two verdicts disagree anywhere the table does not name, so the hand-written mirror cannot drift again unnoticed.

> Maintainers: bump `starters/civitai-block-starter`'s `@civitai/app-sdk` pin to the version this changeset publishes. That starter is in `.changeset/config.json`'s `ignore` list, so `changeset version` will not rewrite it, and a `tiged`'d copy on an older SDK would fail its own scaffolded manifest. `pnpm check:starter-pins` goes red as soon as the new version is on npm.
