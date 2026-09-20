/**
 * Custom Elements Manifest is the SINGLE SOURCE OF TRUTH for this package's
 * public surface. Everything downstream is generated from `custom-elements.json`:
 *
 *   custom-elements.json ──┬─> @civitai/elements-react/src/generated/jsx.d.ts
 *                          ├─> api-snapshot.json   (the CI diff gate)
 *                          └─> README's API tables
 *
 * The analyzer reads the TS sources and the JSDoc tags on each class
 * (`@element`, `@attr`, `@prop`, `@fires`, `@cssprop`). The tags are the
 * authoritative part: `static properties = { ...Base.properties, … }` uses a
 * spread the static analyzer cannot follow, so a property documented ONLY in
 * the object literal would be missing from the manifest and therefore from the
 * React types. `test/manifest-completeness.test.ts` fails when a reactive
 * property has no matching manifest entry, so that gap cannot open silently.
 */
export default {
  globs: ['src/**/*.ts'],
  exclude: ['src/generated/**', 'src/index.ts'],
  outdir: '.',
  litelement: true,
  dev: false,
};
