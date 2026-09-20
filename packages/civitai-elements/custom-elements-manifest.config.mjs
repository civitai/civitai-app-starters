/**
 * Custom Elements Manifest is the SINGLE SOURCE OF TRUTH for this package's
 * public surface. Everything downstream is generated from `custom-elements.json`:
 *
 *   custom-elements.json ──┬─> @civitai/elements-react/src/generated/jsx.ts
 *                          ├─> api-snapshot.json   (the CI diff gate)
 *                          └─> README's API tables
 *
 * The analyzer reads the TS sources and the JSDoc tags on each class
 * (`@element`, `@attr`, `@prop`, `@fires`, `@cssprop`). The tags are the
 * authoritative part: `static properties = { ...Base.properties, … }` uses a
 * spread the static analyzer cannot follow, so a property documented ONLY in
 * the object literal would be missing from the manifest and therefore from the
 * React types. `test/generation-parity.test.ts` ("the manifest describes every
 * reactive property") fails when a reactive property has no matching manifest
 * entry, so that gap cannot open silently.
 *
 * 🔴 `outdir: '.'` means `cem analyze` OVERWRITES the committed
 * `custom-elements.json`. The committed copy is what npm ships (it is in
 * `files` and named by the `customElements` field), and CI runs `analyze`
 * before every test — so nothing in the suite can see the committed file
 * having gone stale. The gate is a `git diff --exit-code custom-elements.json`
 * step immediately after `analyze` in `.github/workflows/ci.yml`. Change this
 * config and that step is the thing to check.
 */
export default {
  globs: ['src/**/*.ts'],
  exclude: ['src/generated/**', 'src/index.ts'],
  outdir: '.',
  litelement: true,
  dev: false,
};
