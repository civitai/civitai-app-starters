---
'@civitai/app-sdk': minor
---

**`defineBlock` now validates against the canonical schema itself, instead of a hand-written copy of it** — and it finally runs somewhere (#330).

It used to claim it was "a strict subset of what the civitai/civitai server enforces". It was not a subset in either direction: it required **11** fields where the canonical requires **5** (`appId` among them, which the canonical does not declare at all) while leaving `renderMode`, `buildCommand`, `outputDir`, `publicSettingsKeys`, `assetBundleUrl`, `repository`, `page` and `bootSkeleton` entirely unchecked. The clearest symptom: it **rejected every `block.manifest.json` this repo ships**, including the one `civitai app init` scaffolds, because it required `iframe.src` — the one field the platform assigns itself and refuses at submit.

The fix is the one #330 proposed: **derive the rules from the schema.** `defineBlock` compiles the vendored `schemas/app-block/v1.json` (byte-identical to https://civitai.com/schemas/app-block/v1.json, CI drift-checked) with Ajv and validates against that. There is no parallel rule set left to diverge.

**Moved — update your imports**

- `defineBlock`, `DefineBlockConfig` → **`@civitai/app-sdk/manifest`** (was `@civitai/app-sdk/blocks`). The new subpath is **Node-only**: it reads the schema with `node:fs` and needs the optional peer `ajv` (`pnpm add -D ajv`). `./blocks` keeps **zero runtime dependencies** — it ships into sandboxed browser iframes and every app inherits its install graph, so a JSON-Schema engine has no business there. `BlockManifestError` is still exported from `./blocks` (same class, so `instanceof` is unchanged).
- New: **`@civitai/app-sdk/vite`** exports `blockManifestPlugin()`, the same gate as a Vite plugin. Optional peers `ajv` (runtime) and `vite` (types only).

**Removed**

- `ManifestAsset` and `BlockManifestV1['assets']`. Not a canonical property, used by no manifest, no doc and no starter; the canonical's `assetBundleUrl` is its successor. The canonical top level is not `additionalProperties: false`, so the server ignored `assets` — meaning the rule could only ever reject a manifest the platform accepts.

**Breaking, if you were typing a manifest by hand**

- `$schema`, `appId`, `type`, `targets`, `iframe` and `minApiVersion` are **optional** on `BlockManifestV1`, matching the canonical's five-field `required` array (`blockId`, `version`, `name`, `contentRating`, `scopes`). Widening — existing manifests keep type-checking.
- `iframe.src` and `trustTier` are typed `never` and **rejected at runtime**. Both are SERVER-OWNED; a manifest that declares either is refused at submit, so it is refused locally too. **If you were setting `iframe.src`, delete it** — the platform stamps `https://<blockId>.civit.ai/` at build/approve.
- `manifest.type` narrows to `'block'`. The canonical enum has exactly one member; `'embed'` was never valid there.

**Rules that are gone, because the platform does not apply them**

- `$schema` no longer has to equal the canonical URL. The canonical types it as a plain string and its own description says it is *"ignored by the platform validator"* — so pointing it at a vendored copy or a `v2` preview is fine, and used to fail your build.
- `appId` is not validated at all. It is not a manifest property; it lives in `civitai.app.json`. The old "non-empty string when present" rule could not catch the one realistic mistake anyway — all seven shipped scaffolds carry `"app_REPLACE_ME"`, which it accepted.
- `targets[].priority` is not validated (also not a canonical property).
- `tagline` now takes the schema's verdict (`maxLength: 140` on the **raw** string) rather than measuring the trimmed one. The canonical documents that asymmetry as deliberate; trim your tagline.

**Newly enforced, for free** — every canonical rule that was silently unchecked, now enforced because Ajv reads it out of the schema rather than because someone wrote it down: `iframe` bounds (40–4000 px) and its `additionalProperties: false`; `minApiVersion` format; `targets` `maxItems: 16`; `renderMode`; `bootSkeleton`; `repository`; `buildCommand` allowlist + its `outputDir` requirement; `outputDir` traversal rules; `publicSettingsKeys` bounds; `assetBundleUrl`; the `page` surface; `scopeJustifications` values.

**Where it runs.** Every scaffold that ships a manifest (`starters/civitai-block-starter` and all six `starters/examples/*`) registers `blockManifestPlugin` in its `vite.config.ts`, firing from Vite's `configResolved` — so `pnpm dev`, `pnpm dev:harness` and `pnpm build` all fail on a bad manifest, with the offending field path. Previously `defineBlock` had **no caller outside markdown**.

On top of the schema, `defineBlock` applies exactly five extra rules, each mirroring a server rejection the canonical states only in prose, each an entry in `SCHEMA_DIVERGENCES` with the prose it mirrors: rejecting a dev-set `iframe.src` and `trustTier`, rejecting `allow-same-origin`/`allow-top-navigation*` sandbox tokens, requiring `scopeJustifications` keys to be declared scopes, and validating `settings` against the W3 settings meta-schema. Every one is **strictly additive** — it can only reject something the schema accepted, never relax a canonical rule.

`KNOWN_GAPS` records what only the server can check, including one that cuts the other way: the canonical's sandbox description is an *allowlist* (unverified tier allows only `allow-scripts`, `allow-forms`) while the rule above is a denylist, so `allow-popups` and friends pass locally and may be refused at review. Passing `defineBlock` is necessary, not sufficient, and it is **not** a replacement for `civitai app validate`.

> 🔴 **Maintainers — release sequencing.** `starters/civitai-block-starter` pins `@civitai/app-sdk` at a published caret and is in `.changeset/config.json`'s `ignore` list, so `changeset version` will not rewrite it. Its `vite.config.ts` now imports `@civitai/app-sdk/vite`, a subpath that does not exist in the currently-published version. **Merge → publish → bump the pin, in that order**, and do not leave a gap: between merge and the pin bump, a `tiged` / `civitai app init` copy resolves the old SDK and `pnpm build` fails on `Cannot find module '@civitai/app-sdk/vite'`. In-repo CI cannot see this — root `pnpm.overrides` redirects the caret to `workspace:*`, so the `Starter` matrix always exercises the new SDK. The same applies to the six examples after the `pnpm add @civitai/app-sdk` swap that `starters/examples/README.md` documents.
