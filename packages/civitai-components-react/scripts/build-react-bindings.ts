import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bindingSources, pkgRoot } from './bindings.js';

const outDir = join(pkgRoot, 'src', 'elements');

for (const name of readdirSync(outDir)) {
  if (name.startsWith('civitai-') || name === 'index.ts') rmSync(join(outDir, name));
}

const sources = bindingSources();
for (const [name, contents] of sources) writeFileSync(join(outDir, name), contents);

console.log(`[build-react-bindings] wrote ${sources.size - 1} bindings + index.ts`);
