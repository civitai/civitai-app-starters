/**
 * LEDGERS for the two host-simulation subpaths — `@civitai/blocks-react/testing`
 * and `@civitai/blocks-react/live` — and the tie between each surface and the
 * ONE document that describes it.
 *
 * WHY THIS EXISTS (#334): `./testing` grew to 46 exports — 41 of them
 * undocumented, including `createLiveHost`, which talks to the real Civitai
 * backend and spends real Buzz — while `AGENTS.md` described it as two
 * "test-only helpers" and named a file that does not exist. Nothing anywhere
 * asserted what the subpath exported, so it grew silently, and nothing tied the
 * prose to the code, so the prose rotted.
 *
 * ONE FILE, BOTH SUBPATHS, ONE RULE. The checks are parameterised over
 * {@link SUBPATHS} rather than copied per subpath: the same drift that produced
 * #334 on `./testing` is available on `./live` the moment the rule is written
 * twice. Adding a subpath means adding a row, not a file.
 *
 * WHAT EACH CHECK ACTUALLY COVERS — read this before citing a green run:
 *
 *  1. `runtime value exports` imports the module namespace and compares
 *     `Object.keys` to the row's `values`. It sees VALUES only (types are
 *     erased before this file runs) and it fails on GROWTH and on SHRINKAGE.
 *     It also proves the module EVALUATES — a broken import inside the entry
 *     fails here rather than in a consumer's install.
 *
 *  2. `declared surface (values + types)` re-reads the entry with the
 *     TypeScript compiler API and compares the checker's own
 *     `getExportsOfModule` to `values` ∪ `types`. This is the half that sees
 *     TYPE exports — `tsconfig.json` EXCLUDES `test/`, so a type annotation
 *     written in this file would never be checked by `pnpm typecheck` and would
 *     assert nothing.
 *
 *  3. `README enumerates exactly this surface` parses the row's two marked
 *     regions of `README.md` and compares them to the row's ledger arrays. Read
 *     the direction precisely: it ties the README to the LEDGER ARRAYS, not
 *     directly to the module — checks 1 and 2 tie those arrays to the module,
 *     and the array is the hub of a triangle. So editing the entry alone
 *     reddens 1 and 2 (not 3); editing the ledger alone reddens 1/2 AND 3;
 *     editing the README alone reddens 3. There is no edit to any ONE of the
 *     three that leaves the set green.
 *
 *     This is the check that stops #334 recurring. A ledger alone pins the
 *     surface against an array inside a test file and never reads the
 *     documents, so a surface change would turn it red and leave the prose
 *     stale — the original failure, reproduced. The README is the single
 *     canonical enumeration; `AGENTS.md` and the module docblocks point at it
 *     instead of repeating it.
 *
 *  4. `AGENTS.md names only src/ files that exist` walks every `src/…` path
 *     `AGENTS.md` mentions and stats it. #334's closing condition asks for
 *     exactly this (`ls packages/civitai-blocks-react/src/testing.tsx` matching
 *     the path named in `AGENTS.md`); it is written for every path in the file
 *     rather than that one, because a rule about one path regrows at the next.
 *
 *  5. `the money-spending host is not reachable from ./testing` is the OTHER
 *     half of #334's closing condition, and it is deliberately NOT expressed as
 *     "the string `createLiveHost` is absent": it walks `./testing`'s declared
 *     surface and fails if any exported symbol's declaration resolves into
 *     `internal/liveHost.ts`. A rename or an alias walks a name check; it does
 *     not walk this one.
 *
 * NOT COVERED HERE: whether the PUBLISHED subpaths resolve. `package.json`'s
 * `exports` map is exercised for real by `pnpm typecheck:readme` (CI job
 * "README snippets"), which typechecks the README's `./testing` and `./live`
 * snippets against the BUILT `dist/*.d.ts` from outside the package.
 *
 * TO CHANGE A SURFACE: edit the entry module, the ledger row below, AND the
 * README regions that row names, then write a changeset naming every symbol you
 * added or removed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as liveNamespace from '../src/live.js';
import * as testingNamespace from '../src/testing.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface SubpathLedger {
  /** The published specifier, for failure messages. */
  readonly subpath: string;
  /** Entry module, relative to the package root. */
  readonly entry: string;
  /** The namespace object, imported statically above. */
  readonly namespace: Record<string, unknown>;
  /** README marker prefix: `<!-- <prefix>:VALUES:BEGIN -->` etc. */
  readonly marker: string;
  readonly values: readonly string[];
  readonly types: readonly string[];
}

const SUBPATHS: readonly SubpathLedger[] = [
  {
    subpath: '@civitai/blocks-react/testing',
    entry: 'src/testing.tsx',
    namespace: testingNamespace as unknown as Record<string, unknown>,
    marker: 'TESTING-SURFACE',
    // Every VALUE the host-simulation subpath exports. Four, and every one has
    // a measured consumer in the App Block fleet (#334). `createLiveHost` is
    // ABSENT ON PURPOSE — that absence is #334's closing condition, and check 5
    // below asserts it structurally rather than by name.
    values: ['Harness', 'createMockHost', 'readMockHostUrlOptions', 'resetTransport'],
    // `HarnessProps`, `MockHostOptions` and `MockSharedSeed` have direct fleet
    // consumers; the rest are the transitive closure that makes those four
    // values NAMEABLE — each appears in the signature of a kept value or as the
    // type of a property of a kept type, so a consumer hoisting a sub-object
    // out of an options literal can name it.
    types: [
      'CannedPick',
      'CostSpec',
      'HarnessProps',
      'ImageSpec',
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
    ],
  },
  {
    subpath: '@civitai/blocks-react/live',
    entry: 'src/live.ts',
    namespace: liveNamespace as unknown as Record<string, unknown>,
    marker: 'LIVE-SURFACE',
    // 🔴 REAL BACKEND, REAL BUZZ. Keep this surface at exactly the one value a
    // `dev:live` harness needs. Anything else added here inherits the hazard of
    // the import path without a reason to be there.
    values: ['createLiveHost'],
    types: ['LiveHostOptions'],
  },
];

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

/** Load `typescript` from THIS package (it is a devDependency here). */
function loadTs(): typeof import('typescript') {
  const require = createRequire(path.join(PKG_ROOT, 'package.json'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('typescript') as typeof import('typescript');
}

/** The checker's own view of a module's exported symbols. */
function declaredExports(entryRel: string): import('typescript').Symbol[] {
  const ts = loadTs();
  const entry = path.join(PKG_ROOT, entryRel);
  const configPath = path.join(PKG_ROOT, 'tsconfig.json');
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    PKG_ROOT,
  );
  const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`${entryRel} must be in the program`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`${entryRel} must resolve as a module`);
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((s) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s));
}

describe.each(SUBPATHS)('$subpath surface ledger', (row) => {
  const expectedValues = [...row.values].sort();
  const expectedTypes = [...row.types].sort();
  const expectedAll = [...row.values, ...row.types].sort();

  it('runtime value exports match the ledger exactly (grows OR shrinks → red)', () => {
    expect(Object.keys(row.namespace).sort()).toEqual(expectedValues);
  });

  it('declared surface (values + types) matches the ledger exactly', () => {
    const ts = loadTs();
    const entry = path.join(PKG_ROOT, row.entry);
    const configPath = path.join(PKG_ROOT, 'tsconfig.json');
    const parsed = ts.parseJsonConfigFileContent(
      ts.readConfigFile(configPath, ts.sys.readFile).config,
      ts.sys,
      PKG_ROOT,
    );
    const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(entry);
    expect(source, `${row.entry} must be in the program`).toBeDefined();
    const moduleSymbol = checker.getSymbolAtLocation(source!);
    expect(moduleSymbol, `${row.entry} must resolve as a module`).toBeDefined();

    const declared = checker
      .getExportsOfModule(moduleSymbol!)
      .map((s) => s.name)
      .sort();

    expect(declared).toEqual(expectedAll);
  }, 60_000);

  it('README.md enumerates exactly this surface (the doc is the canonical list)', () => {
    const readme = readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');

    // VALUES: a markdown table; the first cell of each body row is the export,
    // written as a single backticked identifier. Header + `|---|` separator are
    // skipped by requiring a backticked first cell.
    const valuesRegion = markedRegion(readme, `${row.marker}:VALUES`);
    const documentedValues = valuesRegion
      .split('\n')
      .map((line) => /^\s*\|\s*`([A-Za-z_$][\w$]*)`\s*\|/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!)
      .sort();
    expect(
      documentedValues,
      `README: the ${row.marker} VALUES table does not match the value ledger for ${row.subpath}`,
    ).toEqual(expectedValues);

    // TYPES: a plain fenced block, one identifier per line.
    const typesRegion = markedRegion(readme, `${row.marker}:TYPES`);
    const fence = /```[a-z]*\n([\s\S]*?)```/.exec(typesRegion);
    expect(fence, `the ${row.marker} TYPES region must contain one fenced block`).not.toBeNull();
    const documentedTypes = fence![1]!
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();
    expect(
      documentedTypes,
      `README: the ${row.marker} TYPES block does not match the type ledger for ${row.subpath}`,
    ).toEqual(expectedTypes);
  });
});

describe('#334 closing condition', () => {
  it('the money-spending live host is not reachable from ./testing', () => {
    // NOT a name check. `createLiveHost` could be re-added under any alias and a
    // string test would pass; this resolves each exported symbol through its
    // aliases to a declaration file and fails if any of them lands in the live
    // host module. The hazard is the MODULE, not the spelling.
    const offenders = declaredExports('src/testing.tsx')
      .flatMap((sym) => (sym.declarations ?? []).map((d) => d.getSourceFile().fileName))
      .filter((f) => f.replace(/\\/g, '/').includes('/internal/liveHost.'));

    expect(
      offenders,
      '@civitai/blocks-react/testing must not re-export anything declared in internal/liveHost.ts — ' +
        'it spends real Buzz and belongs on @civitai/blocks-react/live (#334)',
    ).toEqual([]);
  }, 60_000);

  it('AGENTS.md names only `src/` files that exist', () => {
    // Its `AGENTS.md` row named `src/testing.ts`, which has never existed (the
    // file is `src/testing.tsx`). Checking that ONE path would regrow at the
    // next row, so every `src/…` path the document mentions in backticks is
    // stat'ed.
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
