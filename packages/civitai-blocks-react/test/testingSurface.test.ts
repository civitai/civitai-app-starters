/**
 * LEDGER of the `@civitai/blocks-react/testing` subpath's public surface.
 *
 * WHY THIS EXISTS (#334): the subpath grew to 46 exports — 41 of them
 * undocumented, including `createLiveHost`, which talks to the real Civitai
 * backend and spends real Buzz — while `AGENTS.md` described it as two
 * "test-only helpers". Nothing anywhere asserted what the subpath exported, so
 * it grew silently. This file is the asserted set.
 *
 * WHAT EACH TEST ACTUALLY COVERS — read this before citing a green run:
 *
 *  1. `runtime value exports` imports the module namespace and compares
 *     `Object.keys` to {@link VALUE_EXPORTS}. It sees VALUES only (types are
 *     erased before this file runs) and it fails on GROWTH and on SHRINKAGE.
 *     It also proves the module EVALUATES — a broken import inside
 *     `src/testing.tsx` fails here rather than in a consumer's install.
 *
 *  2. `declared surface (values + types)` re-reads `src/testing.tsx` with the
 *     TypeScript compiler API and compares the checker's own
 *     `getExportsOfModule` to {@link VALUE_EXPORTS} ∪ {@link TYPE_EXPORTS}.
 *     This is the half that sees TYPE exports — `tsconfig.json` EXCLUDES
 *     `test/`, so a type annotation written in this file would never be
 *     checked by `pnpm typecheck` and would assert nothing.
 *
 *  3. `exports map` pins `package.json`'s `./testing` subpath to the build
 *     output of `src/testing.tsx`. It is a tree-local mapping check; it does
 *     NOT prove the published subpath resolves. The thing that exercises the
 *     REAL resolution is `pnpm typecheck:readme` (CI job "README snippets"),
 *     which typechecks the README's `./testing` snippet against the built
 *     `dist/testing.d.ts`.
 *
 * TO CHANGE THE SURFACE: edit `src/testing.tsx` AND the ledgers below, and
 * write a changeset naming every symbol you added or removed. Removing one is
 * a BREAKING change for block authors — see `README.md` § "Stability".
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as testingNamespace from '../src/testing.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every VALUE `@civitai/blocks-react/testing` exports. Five, and every one has
 * a measured consumer in the App Block fleet (#334).
 */
const VALUE_EXPORTS = [
  'Harness',
  'createLiveHost',
  'createMockHost',
  'readMockHostUrlOptions',
  'resetTransport',
].sort();

/**
 * Every TYPE it exports. `HarnessProps`, `MockHostOptions` and `MockSharedSeed`
 * have direct fleet consumers; the rest are the transitive closure that makes
 * those five values NAMEABLE — each one appears in the signature of a kept
 * value or as the type of a property of a kept type, so a consumer hoisting a
 * sub-object out of an options literal can name it.
 */
const TYPE_EXPORTS = [
  'CannedPick',
  'CostSpec',
  'HarnessProps',
  'ImageSpec',
  'LiveHostOptions',
  'MockBuzzBalance',
  'MockBuzzHandle',
  'MockBuzzScenario',
  'MockCannedImageScan',
  'MockGenerationScenario',
  'MockHost',
  'MockHostFailMode',
  'MockHostOptions',
  'MockHostScenarioPatch',
  'MockSharedScenario',
  'MockSharedSeed',
  'MockStorageScenario',
].sort();

const DECLARED_EXPORTS = [...VALUE_EXPORTS, ...TYPE_EXPORTS].sort();

describe('@civitai/blocks-react/testing surface ledger', () => {
  it('runtime value exports match the ledger exactly (grows OR shrinks → red)', () => {
    expect(Object.keys(testingNamespace).sort()).toEqual(VALUE_EXPORTS);
  });

  it('every ledgered value is actually importable and defined', () => {
    for (const name of VALUE_EXPORTS) {
      expect(
        (testingNamespace as Record<string, unknown>)[name],
        `${name} is exported but undefined`,
      ).toBeDefined();
    }
  });

  it('declared surface (values + types) matches the ledger exactly', () => {
    // Resolve `typescript` from THIS package (it is a devDependency here).
    const require = createRequire(path.join(PKG_ROOT, 'package.json'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require('typescript') as typeof import('typescript');

    const entry = path.join(PKG_ROOT, 'src/testing.tsx');
    const configPath = path.join(PKG_ROOT, 'tsconfig.json');
    const parsed = ts.parseJsonConfigFileContent(
      ts.readConfigFile(configPath, ts.sys.readFile).config,
      ts.sys,
      PKG_ROOT,
    );
    const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(entry);
    expect(source, 'src/testing.tsx must be in the program').toBeDefined();
    const moduleSymbol = checker.getSymbolAtLocation(source!);
    expect(moduleSymbol, 'src/testing.tsx must resolve as a module').toBeDefined();

    const declared = checker
      .getExportsOfModule(moduleSymbol!)
      .map((s) => s.name)
      .sort();

    expect(declared).toEqual(DECLARED_EXPORTS);
  }, 60_000);

  it('the ./testing exports map points at the build output of src/testing.tsx', () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; import: string }>;
      files: string[];
    };
    const tsconfig = JSON.parse(
      readFileSync(path.join(PKG_ROOT, 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions: { outDir: string; rootDir: string } };

    // `src/testing.tsx` under rootDir `./src` emits to outDir `./dist` as
    // `testing.js` / `testing.d.ts`. Assert the map names exactly that.
    const outDir = tsconfig.compilerOptions.outDir.replace(/^\.\//, '');
    expect(pkg.exports['./testing']).toEqual({
      types: `./${outDir}/testing.d.ts`,
      import: `./${outDir}/testing.js`,
    });
    expect(pkg.files).toContain(outDir);
  });
});
