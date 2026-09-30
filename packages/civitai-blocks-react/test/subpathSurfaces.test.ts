/**
 * LEDGERS for the two host-simulation subpaths — `@civitai/blocks-react/testing`
 * and `@civitai/blocks-react/live` — and the tie between `./testing` and the ONE
 * document that describes it.
 *
 * WHY THIS EXISTS (#334): `./testing` grew to 46 exports — 41 of them
 * undocumented, including `createLiveHost`, which talks to the real Civitai
 * backend and spends real Buzz — while `AGENTS.md` described it as two
 * "test-only helpers" and named a file that does not exist. Nothing anywhere
 * asserted what the subpath exported, so it grew silently, and nothing tied the
 * prose to the code, so the prose rotted.
 *
 * 🔴 THE TWO SUBPATHS GET DIFFERENT AMOUNTS OF MACHINERY, ON PURPOSE. Copying
 * `./testing`'s three checks onto `./live` was the first draft of this file and
 * it was wrong: the hazard #334 records is a surface large enough to hide a
 * symbol in, and `./live` is one value and one type, created in the same commit
 * as its ledger. So:
 *
 *   `./testing` — 20 symbols, fleet consumers, a history of silent growth:
 *      1. runtime value ledger, 2. declared (values + types) ledger via the
 *      TypeScript checker, 3. README region parse.
 *   `./live` — 2 symbols, born today:
 *      1. runtime value ledger, and nothing else.
 *
 * What the two dropped checks would have bought on `./live`, and why neither is
 * worth its weight *there*:
 *   - the declared-surface check adds `LiveHostOptions`, the options type of the
 *     module's only value. It cannot drift independently of that value.
 *   - the README check pins prose to the ledger array. `./live`'s README section
 *     is one table; the failure mode it guards (a long list silently diverging)
 *     needs a long list.
 * The one thing that actually matters on `./live` — `createLiveHost` reappearing
 * on `./testing` — is covered structurally below, from the `./testing` side.
 *
 * WHAT EACH `./testing` CHECK COVERS — read this before citing a green run:
 *
 *  1. `runtime value exports` imports the module namespace and compares
 *     `Object.keys` to the ledger's `values`. It sees VALUES only (types are
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
 *  3. `README enumerates exactly this surface` parses the two marked regions of
 *     `README.md` and compares them to the ledger arrays. Read the direction
 *     precisely: it ties the README to the LEDGER ARRAYS, not directly to the
 *     module — checks 1 and 2 tie those arrays to the module, and the array is
 *     the hub of a triangle. So editing the entry alone reddens 1 and 2 (not 3);
 *     editing the ledger alone reddens 1/2 AND 3; editing the README alone
 *     reddens 3. There is no edit to any ONE of the three that leaves the set
 *     green.
 *
 * 🔴 NOT COVERED HERE: whether the PUBLISHED subpaths RESOLVE through
 * `package.json#exports`. `pnpm typecheck:readme` does NOT exercise that map —
 * `scripts/typecheck-readme-snippets.mjs` maps `@civitai/blocks-react/*` straight
 * at `dist/*` via tsconfig `paths`, bypassing `exports` entirely (measured; an
 * earlier revision of this docblock claimed the opposite and was wrong). The
 * thing that resolves through the real map is a STARTER typecheck, and only for
 * the subpaths a starter imports: `.`, `./ui` and `./live`. `./testing` has no
 * in-repo importer by specifier and therefore no coverage for a deleted map key.
 *
 * TO CHANGE A SURFACE: edit the entry module, the ledger below, AND (for
 * `./testing`) the README regions it names, then write a changeset naming every
 * symbol you added or removed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as liveNamespace from '../src/live.js';
import * as testingNamespace from '../src/testing.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `./testing`'s ledger. Every VALUE the host-simulation subpath exports — four,
 * and every one has a measured consumer in the App Block fleet (#334).
 * `createLiveHost` is ABSENT ON PURPOSE; that absence is #334's closing
 * condition, asserted structurally below rather than by name.
 */
const TESTING_VALUES = [
  'Harness',
  'createMockHost',
  'readMockHostUrlOptions',
  'resetTransport',
] as const;

/**
 * `HarnessProps`, `MockHostOptions` and `MockSharedSeed` have direct fleet
 * consumers; the rest are the transitive closure that makes those four values
 * NAMEABLE — each appears in the signature of a kept value or as the type of a
 * property of a kept type, so a consumer hoisting a sub-object out of an options
 * literal can name it.
 */
const TESTING_TYPES = [
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
] as const;

/**
 * 🔴 REAL BACKEND, REAL BUZZ. Keep this surface at exactly the one value a
 * `dev:live` harness needs. Anything else added here inherits the hazard of the
 * import path without a reason to be there.
 */
const LIVE_VALUES = ['createLiveHost'] as const;

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

/**
 * The checker's own view of a module's exported symbols, with the checker kept
 * alongside them.
 *
 * The checker must come back with the symbols: the two callers need DIFFERENT
 * views of the same list. The declared-surface ledger wants the EXPORTED names
 * (`export { x as y }` is a `y` on the surface), while the #334 structural check
 * wants each alias RESOLVED to the declaration it points at, so that re-adding
 * `createLiveHost as makeHost` is still caught. Resolving inside this helper
 * would silently give the ledger the aliased-through names instead.
 */
function declaredExports(entryRel: string): {
  ts: typeof import('typescript');
  checker: import('typescript').TypeChecker;
  symbols: import('typescript').Symbol[];
} {
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
  return { ts, checker, symbols: checker.getExportsOfModule(moduleSymbol) };
}

describe('@civitai/blocks-react/testing surface ledger', () => {
  const expectedValues = [...TESTING_VALUES].sort();
  const expectedTypes = [...TESTING_TYPES].sort();
  const expectedAll = [...TESTING_VALUES, ...TESTING_TYPES].sort();

  it('runtime value exports match the ledger exactly (grows OR shrinks → red)', () => {
    expect(Object.keys(testingNamespace).sort()).toEqual(expectedValues);
  });

  it('declared surface (values + types) matches the ledger exactly', () => {
    const declared = declaredExports('src/testing.tsx')
      .symbols.map((s) => s.name)
      .sort();
    expect(declared).toEqual(expectedAll);
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
      'README: the TESTING-SURFACE VALUES table does not match the value ledger',
    ).toEqual(expectedValues);

    // TYPES: a plain fenced block, one identifier per line.
    const typesRegion = markedRegion(readme, 'TESTING-SURFACE:TYPES');
    const fence = /```[a-z]*\n([\s\S]*?)```/.exec(typesRegion);
    expect(fence, 'the TESTING-SURFACE TYPES region must contain one fenced block').not.toBeNull();
    const documentedTypes = fence![1]!
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();
    expect(
      documentedTypes,
      'README: the TESTING-SURFACE TYPES block does not match the type ledger',
    ).toEqual(expectedTypes);
  });
});

describe('@civitai/blocks-react/live surface ledger', () => {
  // Runtime only — see the 🔴 note at the top of this file for what the other
  // two checks would and would not buy on a two-symbol surface.
  it('runtime value exports match the ledger exactly (grows OR shrinks → red)', () => {
    expect(Object.keys(liveNamespace).sort()).toEqual([...LIVE_VALUES].sort());
  });
});

describe('#334 closing condition', () => {
  it('the money-spending live host is not reachable from ./testing', () => {
    // NOT a name check. `createLiveHost` could be re-added under any alias and a
    // string test would pass; this resolves each exported symbol through its
    // aliases to a declaration file and fails if any of them lands in the live
    // host module. The hazard is the MODULE, not the spelling.
    const { ts, checker, symbols } = declaredExports('src/testing.tsx');
    const offenders = symbols
      .map((sym) => (sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym))
      .flatMap((sym) => (sym.declarations ?? []).map((d) => d.getSourceFile().fileName))
      .filter((f) => f.replace(/\\/g, '/').includes('/internal/liveHost.'));

    expect(
      offenders,
      '@civitai/blocks-react/testing must not re-export anything declared in internal/liveHost.ts — ' +
        'it spends real Buzz and belongs on @civitai/blocks-react/live (#334)',
    ).toEqual([]);
  }, 60_000);

  it('the surface docs name only `src/` and `test/` files that exist', () => {
    // #334 was filed because `AGENTS.md` named `src/testing.ts`, a file that has
    // never existed. The same defect recurred INSIDE the commit that fixed it:
    // `src/live.ts`'s docblock cited `test/testingSurface.test.ts`, the file that
    // commit deleted. So this walks the documents that describe the two published
    // subpaths, not just `AGENTS.md`, and both `src/…` and `test/…` paths, not
    // just `src/…`.
    //
    // Scoped to these three files deliberately. Widening it to all of `src/**`
    // produces false failures: eight modules cite paths in the civitai.com
    // monorepo (`src/components/AppBlocks/…`, `src/server/services/…`) which are
    // correct references to a different repository.
    const DOCS = ['AGENTS.md', 'src/testing.tsx', 'src/live.ts'] as const;
    const mentions: { doc: string; rel: string }[] = [];

    for (const doc of DOCS) {
      const text = readFileSync(path.join(PKG_ROOT, doc), 'utf8');
      // Directories (`src/hooks/`) are fine — `existsSync` handles them. Prose
      // placeholders cannot match: `<module>` has no character class overlap.
      for (const m of text.matchAll(/`((?:src|test)\/[A-Za-z0-9_./-]+)`/g)) {
        mentions.push({ doc, rel: m[1]! });
      }
    }

    // Positive control: these documents must actually mention paths, or the
    // assertion below passes vacuously over an empty list. Each of the three
    // files cites at least one, and `AGENTS.md`'s module table alone is >10.
    expect(
      new Set(mentions.map((m) => m.doc)).size,
      'every surface doc should reference at least one `src/…` or `test/…` path',
    ).toBe(DOCS.length);
    expect(mentions.length, 'AGENTS.md + the entry docblocks should cite many paths').toBeGreaterThan(
      12,
    );

    const missing = mentions
      .filter((m) => !existsSync(path.join(PKG_ROOT, m.rel)))
      .map((m) => `${m.doc} → ${m.rel}`)
      .filter((v, i, all) => all.indexOf(v) === i)
      .sort();

    expect(missing, `${missing.length} documented path(s) do not exist`).toEqual([]);
  });
});
