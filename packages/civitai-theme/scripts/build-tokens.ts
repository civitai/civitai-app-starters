/**
 * Build writer for @civitai/theme. Runs the pure `buildArtifacts()` generator
 * and writes the three artifacts:
 *   - src/tokens.generated.ts  (typed JS export; compiled by tsc -> dist)
 *   - dist/tokens.css          (link-able stylesheet)
 *   - dist/tokens.dtcg.json    (W3C DTCG interop export)
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

console.log('[build-tokens] wrote src/tokens.generated.ts, dist/tokens.css, dist/tokens.dtcg.json');
