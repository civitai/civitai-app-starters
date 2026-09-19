import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BRIDGE = '@civitai/blocks-client';

/**
 * The arrow only points one way: these elements build on @civitai/components,
 * and @civitai/components must stay usable by an external OAuth app that has no
 * host frame to talk to — so it can never reach for the bridge.
 */
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(path) ? [path] : [];
  });

const FORBIDDEN = /from\s*'(@civitai\/blocks-client[^']*)'|import\s*'(@civitai\/blocks-client[^']*)'/g;
const componentsRoot = join('..', 'civitai-components');
const componentsSrc = join(componentsRoot, 'src');

// The manifest is the cheaper truth: a source regex only sees a DIRECT import,
// while a declared dependency is what actually makes the bridge reachable.
const manifest = JSON.parse(readFileSync(join(componentsRoot, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  if (manifest[field]?.[BRIDGE]) {
    console.error(`@civitai/components declares ${BRIDGE} in ${field} — it must not depend on the bridge.`);
    process.exit(1);
  }
}

const offenders = walk(componentsSrc)
  .map((file) => ({ file, bad: [...readFileSync(file, 'utf8').matchAll(FORBIDDEN)] }))
  .filter(({ bad }) => bad.length > 0);

if (offenders.length > 0) {
  for (const { file, bad } of offenders) {
    const names = bad.map((m) => m[1] ?? m[2]).join(', ');
    console.error(`${file} imports ${names} — @civitai/components must not depend on the bridge.`);
  }
  process.exit(1);
}
console.log('layering ok: @civitai/components reaches no bridge.');
