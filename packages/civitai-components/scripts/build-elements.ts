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

/** Gzipped, because that is what a CDN actually ships over the wire. */
const BUDGET_BYTES = 25 * 1024;

await build({
  root: pkgRoot,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: join(pkgRoot, 'src/elements/register.ts'),
      formats: ['es'],
      fileName: () => 'elements.js',
    },
  },
});

const bundled = join(pkgRoot, 'dist', 'elements.js');
copyFileSync(bundled, join(pkgRoot, 'elements.js'));

const raw = statSync(bundled).size;
const gzipped = gzipSync(readFileSync(bundled)).length;
const percent = Math.round((gzipped / BUDGET_BYTES) * 100);

console.log(
  `[build-elements] dist/elements.js + elements.js — ${(raw / 1024).toFixed(1)} kB raw, ` +
    `${(gzipped / 1024).toFixed(1)} kB gzip (${percent}% of the ${BUDGET_BYTES / 1024} kB budget)`
);

if (gzipped > BUDGET_BYTES) {
  console.error(
    `[build-elements] OVER BUDGET by ${((gzipped - BUDGET_BYTES) / 1024).toFixed(1)} kB gzip.`
  );
  process.exit(1);
}
