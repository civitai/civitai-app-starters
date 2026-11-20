import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 THE BUILT entries vs `@civitai/app-sdk/save-zip`.
 *
 * That subpath first ships in app-sdk 0.85.0; this package's peer floor is lower
 * (package.json). A STATIC import of it anywhere an entry loads fails that entry at
 * module load (`ERR_PACKAGE_PATH_NOT_EXPORTED`) on every older app-sdk the floor
 * admits: from the main graph, `import '@civitai/blocks-react'` for every app, zip or
 * not; from the `./testing` graph, every downstream test suite. So:
 *   - `.`, `./ui`, `./live` do not reach it at all, statically or dynamically;
 *   - `./testing` reaches it ONLY through a dynamic `import()` (createMockHost's zip
 *     validation, loaded on the first zip save) — and it MUST reach it, which is this
 *     file's positive control: a walker that never finds the specifier would pass the
 *     main-entry assertion for the wrong reason.
 *
 * Reads `dist/` (what is published), following every relative import from each
 * `exports` entry. Needs `pnpm build` first; CI builds every package before the
 * test steps. A missing `dist` FAILS, it does not skip.
 */

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_ZIP = '@civitai/app-sdk/save-zip';

// Statement-anchored, so a JSDoc `@example` line (` * import … from '…'`) is not an import.
// `from` is required unless the quote follows `import` directly (a bare side-effect import), so a
// line like `export const X = './y'` is not read as an import of './y'.
const STATIC_IMPORT = /(?:^|;)[ \t]*(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(source: string): { spec: string; dynamic: boolean }[] {
  const out: { spec: string; dynamic: boolean }[] = [];
  for (const m of source.matchAll(STATIC_IMPORT)) out.push({ spec: m[1]!, dynamic: false });
  for (const m of source.matchAll(DYNAMIC_IMPORT)) out.push({ spec: m[1]!, dynamic: true });
  return out;
}

/**
 * Every module reachable from `entry` through relative imports (static or dynamic),
 * and every bare specifier they import — `bare` all of them, `staticBare` only the
 * ones a module-load-time `import`/`export … from` names.
 */
function graphOf(entry: string): { files: Set<string>; bare: Set<string>; staticBare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const staticBare = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (files.has(file)) continue;
    if (!existsSync(file)) throw new Error(`import graph reached a file that does not exist: ${file}`);
    files.add(file);
    for (const { spec, dynamic } of specifiersOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) todo.push(resolve(dirname(file), spec));
      else {
        bare.add(spec);
        if (!dynamic) staticBare.add(spec);
      }
    }
  }
  return { files, bare, staticBare };
}

const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
  exports: Record<string, { import: string }>;
};
const entryFile = (key: string) => join(PKG, pkg.exports[key]!.import);

describe('built entries vs @civitai/app-sdk/save-zip', () => {
  it('dist exists (build ran first)', () => {
    expect(existsSync(entryFile('.')), 'dist/index.js missing — run `pnpm build` before this test').toBe(true);
  });

  it('enumerates exactly the entries this file judges', () => {
    // A new entry must be classified here deliberately, not slip past the loop below.
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './live', './testing', './ui']);
  });

  it.each(['.', './ui', './live'])('%s does not reach @civitai/app-sdk/save-zip at all', (key) => {
    const { files, bare } = graphOf(entryFile(key));
    expect(files.size, 'the walker followed nothing').toBeGreaterThan(key === '.' ? 20 : 1);
    expect([...bare].filter((s) => s === SAVE_ZIP)).toEqual([]);
  });

  it('./testing reaches it ONLY dynamically — never at module load (POSITIVE CONTROL: it does reach it)', () => {
    const { files, bare, staticBare } = graphOf(entryFile('./testing'));
    expect(bare.has(SAVE_ZIP)).toBe(true);
    expect(staticBare.has(SAVE_ZIP)).toBe(false);
    // The static set is not empty — the static walk works, so `false` above is a real absence.
    expect(staticBare.has('@civitai/app-sdk/blocks')).toBe(true);
    // …and via the mock-only module, not something the main entry also loads.
    expect([...files].some((f) => f.endsWith('/internal/saveBytesPrepare.js'))).toBe(true);
    expect([...graphOf(entryFile('.')).files].some((f) => f.endsWith('/internal/saveBytesPrepare.js'))).toBe(false);
  });
});
