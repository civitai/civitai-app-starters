/**
 * Entry-point shape.
 *
 * The `.` entry used to be asserted element-free, because it carried a
 * hand-written React layer and pulling Lit into it would have put a renderer
 * in the bundle of consumers who used none. That premise died with the
 * supersession: the custom elements are now the only implementation, so the
 * root necessarily reaches Lit and every element it re-exports.
 *
 * What replaces it is the invariant that actually holds now — the root IS the
 * presentational barrel and nothing besides. That still fails loudly if a
 * second implementation is re-added to the root, or if the root starts
 * reaching something the barrel deliberately keeps out (notably `@civitai/sdk`,
 * which the two viewer-bound elements pull in behind their own entry).
 * Per-element bundle discipline is pinned by the single-binding test below.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { elements, usesSdk } from '../scripts/bindings.js';

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
  it('the `.` entry is the presentational barrel and nothing besides', () => {
    const root = [...reachableSpecifiers('dist/index.js')].sort();
    const barrel = [...reachableSpecifiers('dist/elements/index.js')].sort();
    // Set equality both ways: a second implementation re-added to the root
    // shows up as an extra, a barrel export dropped from the root as a gap.
    expect(root).toEqual(barrel);
    expect(root).not.toContain('@civitai/components/register');
  });

  it('the `.` entry reaches no SDK — the viewer-bound elements stay behind their own entry', () => {
    const root = [...reachableSpecifiers('dist/index.js')];
    expect(root.filter((s) => s === '@civitai/sdk' || s.startsWith('@civitai/sdk/'))).toEqual([]);
    for (const { specifier } of elements().filter(usesSdk)) {
      expect(
        root.filter((s) => s.startsWith(`@civitai/components/${specifier}`)),
        `the root must not reach ${specifier}, which pulls @civitai/sdk in`
      ).toEqual([]);
    }
  });

  it('the `./elements` barrel registers every presentational element, and reaches no SDK', () => {
    const external = new Set(reachableSpecifiers('dist/elements/index.js'));
    for (const entry of elements().filter((e) => !usesSdk(e))) {
      expect(external, `the barrel must pull ${entry.specifier}/define`).toContain(
        `@civitai/components/${entry.specifier}/define`
      );
    }
    for (const { specifier } of elements().filter(usesSdk)) {
      expect(
        [...external].filter((s) => s.startsWith(`@civitai/components/${specifier}`)),
        `the barrel must not reach ${specifier}, which pulls @civitai/sdk in`
      ).toEqual([]);
    }
  });

  it('binds the elements that act as the viewer, behind their own entry', () => {
    const sdkBound = elements().filter(usesSdk);
    expect(sdkBound.map((e) => e.tag)).toContain('civitai-sign-in-button');
    for (const { specifier } of sdkBound) {
      expect(reachableSpecifiers(`dist/elements/${specifier}.js`)).toContain(
        `@civitai/components/${specifier}`
      );
    }
  });

  it('a single binding reaches its own element and nothing else', () => {
    // The whole point of per-element modules: importing one button must not
    // drag in thirty-two elements behind it.
    const external = [...reachableSpecifiers('dist/elements/civitai-button.js')]
      .filter((s) => s.startsWith('@civitai/components'))
      .sort();
    expect(external).toEqual([
      '@civitai/components/civitai-button',
      '@civitai/components/civitai-button/define',
    ]);
  });
});
