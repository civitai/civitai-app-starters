/**
 * Guards every published `exports` subpath of every `packages/*` package
 * against the source tree that has to produce it.
 *
 * ⚠️ THIS IS AN INVARIANT GUARD, NOT A REGRESSION GUARD. Every assertion below
 * is GREEN on `main` at the commit that introduced it; no shipped defect is
 * being pinned. It is here for one measured reason: a subpath's `exports` entry
 * has NO other coverage in this repo.
 *
 * WHY NOTHING ELSE COVERS IT — both halves measured, not assumed:
 *
 *   - `pnpm typecheck:readme` does NOT resolve through `package.json#exports`.
 *     `scripts/typecheck-readme-snippets.mjs` writes a tsconfig whose `paths`
 *     map `@civitai/blocks-react/*` straight at `dist/*`, so a subpath deleted
 *     from the exports map still typechecks there. (An earlier comment in that
 *     script claimed the opposite; it was wrong and has been corrected.)
 *   - The STARTERS do resolve through it — `moduleResolution: "Bundler"` over
 *     the workspace-linked package — but only for the subpaths they happen to
 *     import. Today that is `.`, `./ui` and `./live`. Nothing in the repo
 *     imports `@civitai/blocks-react/testing` by specifier, so its map entry
 *     is unexercised, and adding a subpath does not add an importer.
 *
 * The failure it prevents lands in a consumer's install, not here:
 *
 *     ERR_MODULE_NOT_FOUND: Cannot find module
 *       …/node_modules/@civitai/blocks-react/dist/live.js
 *
 * — a map entry naming an output `tsc` never emits, because no matching source
 * file exists; or one naming a path outside `files`, which is absent from the
 * tarball however correct the map looks.
 *
 * WHAT IT CHECKS, per declared target:
 *   1. It is inside a directory the package's `files` array publishes.
 *   2. If it is a JS or `.d.ts` target under the tsconfig `outDir`, it is
 *      DERIVABLE from a real source file under `rootDir` — `./dist/live.js`
 *      requires `src/live.ts` or `src/live.tsx` to exist. A source-tree check,
 *      so it needs no build and cannot be fooled by stale `dist` output left
 *      over from another branch. Non-TS assets a package emits by other means
 *      (`dist/tokens.css`, `dist/tokens.dtcg.json`, a checked-in JSON schema)
 *      get check 1 only; there is no source stem to compute for them.
 *
 * 🔴 WHAT IT DOES NOT CHECK — do not read a green run as wider than this:
 *   - **That a subpath a consumer needs is PRESENT in the map.** Deleting
 *     `"./testing"` outright makes this guard see one target fewer and pass.
 *     There is no general rule available for "which source files are entry
 *     points" (`@civitai/components-react` has 20 top-level modules and one
 *     entry), so inventing one would be a guess dressed as a check. In-repo,
 *     `.`, `./ui` and `./live` are covered against deletion by the block
 *     starter's own `typecheck`, which imports all three by specifier and
 *     resolves them through the real map; `./testing` has no in-repo importer
 *     and so no coverage for that case.
 *   - That the emitted module evaluates, or that its exports are what anyone
 *     expects. That is the per-package surface ledger's job
 *     (`packages/civitai-blocks-react/test/subpathSurfaces.test.ts`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** Strip `./` and any trailing `/`. */
const norm = (p) => p.replace(/^\.\//, '').replace(/\/$/, '');

/** Every workspace package that has a `package.json`. */
function packages() {
  return readdirSync(PACKAGES_DIR)
    .filter((d) => statSync(join(PACKAGES_DIR, d)).isDirectory())
    .map((d) => ({ dir: join(PACKAGES_DIR, d), name: d }))
    .filter((p) => existsSync(join(p.dir, 'package.json')));
}

/** Flatten an `exports` map to `[subpathKey, targetPath][]`. */
function exportTargets(exportsField) {
  const out = [];
  for (const [key, value] of Object.entries(exportsField ?? {})) {
    if (typeof value === 'string') {
      out.push([key, value]);
    } else if (value && typeof value === 'object') {
      for (const target of Object.values(value)) {
        if (typeof target === 'string') out.push([key, target]);
      }
    }
  }
  return out;
}

/**
 * JSON with line and block comments stripped: the tsconfigs in this repo are
 * plain JSON today, but tsc accepts JSONC and a future comment must not turn
 * this guard into a crash that reads as a real failure.
 */
function readJsonc(file) {
  const raw = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(raw);
}

test('every packages/* exports subpath is published AND derivable from src/', () => {
  const problems = [];
  let subpathsChecked = 0;

  for (const pkg of packages()) {
    const manifest = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8'));
    const targets = exportTargets(manifest.exports);
    if (targets.length === 0) continue;

    const files = (manifest.files ?? []).map(norm);
    const tsconfigPath = join(pkg.dir, 'tsconfig.json');
    const tsconfig = existsSync(tsconfigPath) ? readJsonc(tsconfigPath) : null;
    const outDir = norm(tsconfig?.compilerOptions?.outDir ?? 'dist');
    const rootDir = norm(tsconfig?.compilerOptions?.rootDir ?? 'src');

    for (const [key, target] of targets) {
      subpathsChecked += 1;
      const rel = norm(target);
      const where = `${manifest.name} "${key}" → ${target}`;

      // 1. inside a published `files` entry
      if (!files.some((f) => rel === f || rel.startsWith(`${f}/`))) {
        problems.push(`${where}: not under any "files" entry (${files.join(', ') || 'none'})`);
        continue;
      }

      // 2. derivable from a real source file — JS/.d.ts targets under outDir
      // only. A package may also publish assets it emits by other means
      // (CSS, generated JSON, a checked-in schema); those have no source stem.
      if (!/\.(d\.ts|js|mjs|cjs)$/.test(rel) || !rel.startsWith(`${outDir}/`)) continue;
      const stem = rel.slice(outDir.length + 1).replace(/\.(d\.ts|js|mjs|cjs)$/, '');
      const candidates = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) =>
        join(pkg.dir, rootDir, `${stem}${ext}`),
      );
      if (!candidates.some(existsSync)) {
        problems.push(
          `${where}: no source for it — none of ${candidates
            .map((c) => c.slice(pkg.dir.length + 1))
            .join(', ')} exists`,
        );
      }
    }
  }

  // Positive control: a zero here would be indistinguishable from a guard wired
  // to nothing. The repo has at least `.`, `./ui`, `./testing`, `./live` on
  // blocks-react plus the app-sdk subpaths, each with `types` + `import`.
  assert.ok(
    subpathsChecked >= 10,
    `expected to check at least 10 export targets, saw ${subpathsChecked} — the enumeration is broken`,
  );

  assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}\n`);
});
