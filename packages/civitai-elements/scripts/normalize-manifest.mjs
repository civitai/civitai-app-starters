#!/usr/bin/env node
/**
 * Make `custom-elements.json` byte-stable across runs.
 *
 * 🔴 WHY THIS EXISTS. `cem analyze` walks the source tree asynchronously and
 * emits `modules` in WHATEVER ORDER THE READS FINISH. Measured on this repo:
 * two consecutive runs over an unchanged tree produced
 *
 *     run 1  … civitai-button.ts | civitai-select.ts | internal/… | …
 *     run 2  … civitai-button.ts | internal/…        | civitai-select.ts | …
 *
 * — identical content, different order, a ~19 KB textual diff. Without this
 * step the `git diff --exit-code custom-elements.json` gate in CI would fail
 * on roughly every other run regardless of whether anything changed, which is
 * the worst kind of gate: permanently red trains everyone to click through it,
 * and the drift it exists to catch then ships anyway.
 *
 * Sorting `modules` by `path` is semantically neutral — the array is a SET of
 * modules, and nothing downstream (the API snapshot, the JSX-type generator,
 * the README tables) reads it positionally. Nothing else is reordered:
 * `declarations` and `members` follow source order, which IS meaningful.
 *
 * Run automatically as the last step of `pnpm --filter @civitai/elements analyze`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(pkgRoot, 'custom-elements.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.modules)) {
  throw new Error('[normalize-manifest] custom-elements.json has no `modules` array');
}
const before = manifest.modules.length;
manifest.modules.sort((a, b) => String(a.path).localeCompare(String(b.path)));
if (manifest.modules.length !== before) {
  throw new Error('[normalize-manifest] sorting changed the module COUNT — refusing to write');
}

// `cem` writes 2-space JSON with a trailing newline; match it exactly so the
// only difference this step can ever introduce is the ordering.
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[normalize-manifest] ${before} modules, sorted by path`);
