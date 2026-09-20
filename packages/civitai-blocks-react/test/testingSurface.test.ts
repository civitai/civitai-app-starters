/**
 * LEDGER of the `@civitai/blocks-react/testing` subpath's public surface, and
 * the tie between that surface and the ONE document that describes it.
 *
 * WHY THIS EXISTS (#334): the subpath grew to 46 exports — 41 of them
 * undocumented, including `createLiveHost`, which talks to the real Civitai
 * backend and spends real Buzz — while `AGENTS.md` described it as two
 * "test-only helpers" and named a file that does not exist. Nothing anywhere
 * asserted what the subpath exported, so it grew silently, and nothing tied the
 * prose to the code, so the prose rotted.
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
 *  3. `README enumerates exactly this surface` parses the two marked regions of
 *     `README.md` § "The `/testing` subexport" and compares them to the two
 *     ledger arrays in THIS file. Read the direction precisely: it ties the
 *     README to the LEDGER, not directly to the module — tests 1 and 2 tie the
 *     ledger to the module, and the ledger array is the hub of the triangle. So
 *     editing `src/testing.tsx` alone reddens 1 and 2 (not 3); editing the
 *     ledger alone reddens 1/2 AND 3; editing the README alone reddens 3. There
 *     is no edit to any one of the three that leaves all four tests green.
 *
 *     This is the guard that stops #334 recurring. The ledger alone pins the
 *     surface against an array inside a test file and never reads the
 *     documents, so a surface change would turn the ledger red and leave the
 *     prose stale — the original failure, reproduced. The README is now the
 *     single canonical enumeration; `AGENTS.md` and the module docblock point
 *     at it instead of repeating it.
 *
 *  4. `AGENTS.md names files that exist` walks every `src/…` path `AGENTS.md`
 *     mentions and stats it. #334's closing condition asks for exactly this
 *     (`ls packages/civitai-blocks-react/src/testing.tsx` matching the path
 *     named in `AGENTS.md`); it is written for every path in the file rather
 *     than that one, because a rule about one path regrows at the next.
 *
 * NOT COVERED HERE: whether the PUBLISHED subpath resolves. `package.json`'s
 * `exports` map is exercised for real by `pnpm typecheck:readme` (CI job
 * "README snippets"), which typechecks the README's `./testing` snippets
 * against the BUILT `dist/testing.d.ts` from outside the package. A string
 * comparison against the exports map was deleted from this file in favour of
 * that: one rule, one place, and the real resolver is the stronger of the two.
 *
 * TO CHANGE THE SURFACE: edit `src/testing.tsx`, the ledgers below, AND the
 * README section test 3 parses, then write a changeset naming every symbol you
 * added or removed.
 */
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Slice the text between a `<!-- MARKER:BEGIN -->` / `<!-- MARKER:END -->` pair.
 * Throws rather than returning empty: an absent marker must not read as an
 * empty enumeration that happens to match an empty expectation.
 */
function markedRegion(doc: string, marker: string): string {
  const begin = `<!-- ${marker}:BEGIN -->`;
  const end = `<!-- ${marker}:END -->`;
  const from = doc.indexOf(begin);
  const to = doc.indexOf(end);
  if (from === -1) throw new Error(`README.md is missing the marker ${begin}`);
  if (to === -1) throw new Error(`README.md is missing the marker ${end}`);
  if (to < from) throw new Error(`README.md has ${end} before ${begin}`);
  return doc.slice(from + begin.length, to);
}

describe('@civitai/blocks-react/testing surface ledger', () => {
  it('runtime value exports match the ledger exactly (grows OR shrinks → red)', () => {
    expect(Object.keys(testingNamespace).sort()).toEqual(VALUE_EXPORTS);
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

  it('README.md enumerates exactly this surface (the doc is the canonical list)', () => {
    const readme = readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');

    // VALUES: a markdown table; the first cell of each body row is the export,
    // written as a single backticked identifier. Header + `|---|` separator are
    // skipped by requiring a backticked first cell.
    const valuesRegion = markedRegion(readme, 'TESTING-SURFACE:VALUES');
    const documentedValues = valuesRegion
      .split('\n')
      .map((line) => /^\s*\|\s*`([A-Za-z_$][\w$]*)`\s*\|/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!)
      .sort();
    expect(
      documentedValues,
      'README § "The `/testing` subexport" → the VALUES table does not match the value ledger',
    ).toEqual(VALUE_EXPORTS);

    // TYPES: a plain fenced block, one identifier per line.
    const typesRegion = markedRegion(readme, 'TESTING-SURFACE:TYPES');
    const fence = /```[a-z]*\n([\s\S]*?)```/.exec(typesRegion);
    expect(fence, 'the TYPES marked region must contain one fenced block').not.toBeNull();
    const documentedTypes = fence![1]!
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();
    expect(
      documentedTypes,
      'README § "The `/testing` subexport" → the TYPES block does not match the type ledger',
    ).toEqual(TYPE_EXPORTS);
  });

  it('AGENTS.md names only `src/` files that exist', () => {
    // #334's closing condition, generalised: its `AGENTS.md` row named
    // `src/testing.ts`, which has never existed (the file is `src/testing.tsx`).
    // Checking that ONE path would regrow at the next row, so every `src/…`
    // path the document mentions in backticks is stat'ed.
    const agents = readFileSync(path.join(PKG_ROOT, 'AGENTS.md'), 'utf8');
    const mentioned = [...agents.matchAll(/`(src\/[A-Za-z0-9_./-]+)`/g)]
      .map((m) => m[1]!)
      // Not a claim about a concrete file: `src/hooks/` etc. are directories,
      // which `existsSync` handles; anything with a placeholder is filtered by
      // the character class above (`<module>` cannot match).
      .filter((p, i, all) => all.indexOf(p) === i)
      .sort();

    // Positive control: the document must actually mention some paths, or this
    // test passes vacuously over an empty list.
    expect(mentioned.length, 'AGENTS.md should reference `src/…` paths').toBeGreaterThan(5);

    const missing = mentioned.filter((p) => !existsSync(path.join(PKG_ROOT, p)));
    expect(missing, `AGENTS.md names ${missing.length} path(s) that do not exist`).toEqual([]);
  });
});
