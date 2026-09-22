import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** `core` is the bottom layer: domains build on it, never the other way round. */
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });

const offenders = walk('src/core')
  .map((file) => ({ file, bad: [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/(?!\.)([a-z-]+)\//g)] }))
  .filter(({ bad }) => bad.length > 0);

if (offenders.length > 0) {
  for (const { file, bad } of offenders) {
    console.error(`${file} imports from ${bad.map((m) => m[1]).join(', ')} — core must not depend on a domain.`);
  }
  process.exit(1);
}
console.log('layering ok: core depends on no domain.');
