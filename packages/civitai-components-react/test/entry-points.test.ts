/**
 * The `.` entry is what every existing consumer imports. Lit reaching it would
 * put a renderer in their bundle for components that do not use one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Both `import x from 'y'` / `export … from 'y'` AND a bare `import 'y'`, which
// is how a register entry pulls its side effect in.
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s*(?:[^'"]*from\s*)?['"]([^'"]+)['"]/g;

function reachableSpecifiers(entry: string): Set<string> {
  const seen = new Set<string>();
  const external = new Set<string>();
  const queue = [resolve(pkgRoot, entry)];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(IMPORT_RE)) {
      if (specifier!.startsWith('.')) queue.push(resolve(dirname(file), specifier!));
      else external.add(specifier!);
    }
  }
  return external;
}

describe('entry points', () => {
  it('the `.` entry reaches no element module and no renderer', () => {
    const external = [...reachableSpecifiers('dist/index.js')];
    expect(external.filter((s) => s === 'lit' || s.startsWith('lit/'))).toEqual([]);
    expect(external.filter((s) => s.startsWith('@civitai/components/civitai-'))).toEqual([]);
    expect(external).not.toContain('@civitai/components/register');
  });

  it('the `./elements` entry is where the elements enter', () => {
    const external = [...reachableSpecifiers('dist/elements/index.js')];
    expect(external).toContain('@civitai/components/register');
  });
});
