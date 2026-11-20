/**
 * Build writer for @civitai/theme. Runs the pure `buildArtifacts()` generator
 * and writes the three artifacts:
 *   - src/tokens.generated.ts  (typed JS export; compiled by tsc -> dist)
 *   - dist/tokens.css          (link-able stylesheet)
 *   - dist/tokens.dtcg.json    (W3C DTCG interop export)
 *   - styles.css               (package-root copy of tokens.css)
 *
 * The package-root `styles.css` exists so a LITERAL CDN path
 * `cdn.jsdelivr.net/npm/@civitai/theme/styles.css` resolves to a real file:
 * jsDelivr ignores package.json `exports`, so the `./styles.css` export alias
 * alone 404s there (unpkg honors exports, hence it worked). Shipping a real
 * root file (added to `files`) fixes every CDN uniformly; the `exports` alias
 * keeps bundler `import '@civitai/theme/styles.css'` working too.
 *
 * dist/ is created up-front; tsc (run after this in `build`) emits the JS/d.ts
 * alongside without clobbering the css/json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArtifacts } from '../src/generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const srcDir = join(pkgRoot, 'src');
const distDir = join(pkgRoot, 'dist');

const artifacts = buildArtifacts();

mkdirSync(srcDir, { recursive: true });
mkdirSync(distDir, { recursive: true });

writeFileSync(join(srcDir, 'tokens.generated.ts'), artifacts['tokens.generated.ts']);
writeFileSync(join(distDir, 'tokens.css'), artifacts['tokens.css']);
writeFileSync(join(distDir, 'tokens.dtcg.json'), artifacts['tokens.dtcg.json']);
// Package-root copy so a literal CDN path `@civitai/theme/styles.css` resolves
// on jsDelivr (which ignores `exports`). Byte-identical to dist/tokens.css.
writeFileSync(join(pkgRoot, 'styles.css'), artifacts['tokens.css']);

console.log(
  '[build-tokens] wrote src/tokens.generated.ts, dist/tokens.css, dist/tokens.dtcg.json, styles.css'
);
