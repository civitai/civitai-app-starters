/**
 * Bundles the elements into a single self-contained module. jsDelivr ignores
 * package.json `exports`, so the one-script-tag form needs a real file at the
 * package root — the same reason `styles.css` is copied there.
 */
import { gzipSync } from 'node:zlib';
import { copyFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Two self-contained bundles, gzipped because that is what a CDN ships. A page
 * loads ONE: `elements.js` for the generic kit, `site-elements.js` for that
 * plus the civitai vocabulary. Measured: two disjoint bundles would duplicate
 * 8.5 kB of Lit in any page needing both, which is every page with a tag in it.
 */
const BUNDLES = [
  { entry: 'src/elements/register.ts', file: 'elements.js', budget: 25 * 1024 },
  { entry: 'src/elements/register-site.ts', file: 'site-elements.js', budget: 30 * 1024 },
] as const;

let over = false;

for (const { entry, file, budget } of BUNDLES) {
  await build({
    root: pkgRoot,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: { entry: join(pkgRoot, entry), formats: ['es'], fileName: () => file },
    },
  });

  const bundled = join(pkgRoot, 'dist', file);
  copyFileSync(bundled, join(pkgRoot, file));

  const raw = statSync(bundled).size;
  const gzipped = gzipSync(readFileSync(bundled)).length;
  const percent = Math.round((gzipped / budget) * 100);

  console.log(
    `[build-elements] dist/${file} + ${file} — ${(raw / 1024).toFixed(1)} kB raw, ` +
      `${(gzipped / 1024).toFixed(1)} kB gzip (${percent}% of the ${budget / 1024} kB budget)`
  );

  if (gzipped > budget) {
    console.error(
      `[build-elements] ${file} OVER BUDGET by ${((gzipped - budget) / 1024).toFixed(1)} kB gzip.`
    );
    over = true;
  }
}

if (over) process.exit(1);
