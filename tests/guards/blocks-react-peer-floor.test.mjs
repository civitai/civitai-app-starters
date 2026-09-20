/**
 * Guards `@civitai/blocks-react`'s declared `@civitai/app-sdk` PEER FLOOR
 * against the one failure this package has now shipped, or nearly shipped,
 * three times: importing a peer symbol that the versions the floor still
 * ADMITS do not export.
 *
 * WHY THIS EXISTS
 * ===============
 * A peer range is metadata and nothing in the build checks it against the code.
 * `pnpm.overrides` maps the peer to the workspace copy, so every in-repo
 * typecheck, test and build resolves the symbol from `packages/civitai-app-sdk`
 * and is structurally blind to whatever the range says. The failure lands at
 * MODULE EVALUATION in a consumer's install:
 *
 *     SyntaxError: The requested module '@civitai/app-sdk/blocks'
 *       does not provide an export named 'APP_STORAGE_MAX_BYTES'
 *
 * The history, all three of them:
 *   - #309 — `0.49.0`–`0.51.0` declared `>=0.29.0` while importing
 *     `effectiveBrowsingCeiling` (0.39.0) and the create-post types (0.40.0).
 *     The range was SATISFIED, so no install warned; 27 of 43 downstream test
 *     files collected ZERO tests and the summary reported no failures.
 *   - #317 — the same shape for `boundBlockToParentMessageType` /
 *     `OTHER_MESSAGE_TYPE_LABEL`; caught in review, floor raised 0.40.0→0.45.0.
 *   - #344 — the App Storage ceilings. `internal/mockHost.ts` value-imports
 *     `APP_STORAGE_MAX_BYTES` / `_ROWS` / `_VALUE_BYTES` while the floor still
 *     read `>=0.45.0`, which admits the published `0.46.0` that has none of
 *     them. Measured against the real tarball: installing that combination
 *     produced NO peer warning, `@civitai/blocks-react` resolved fine (61
 *     exports) and `@civitai/blocks-react/testing` threw the SyntaxError above
 *     out of `dist/internal/mockHost.js`.
 *
 * 🔴 `changeset version` IS NOT A BACKSTOP FOR THIS.
 * `.changeset/config.json` sets `onlyUpdatePeerDependentsWhenOutOfRange: true`,
 * so a peer range is rewritten only when the computed version falls OUT of it.
 * A floor that is too LOW is still satisfied, so it is left alone and ships
 * stale. That is exactly the #344 shape.
 *
 * 🔴 KNOWN LIMITS — read these before trusting a green.
 *   - OFFLINE AND TREE-LOCAL, on purpose. `pnpm test:guards` runs in the
 *     required `Starter` matrix BEFORE the install (`.github/workflows/ci.yml`),
 *     on an `actions/checkout` at depth 1. There is no registry access and no
 *     git history, so this cannot ask npm what a published tarball exports nor
 *     git what `origin/main` exported. Everything below is computed from the
 *     working tree plus the RECORDED MEASUREMENTS in this file.
 *   - Consequently every version number here is a recorded measurement, not a
 *     live one. `PEER_VALUE_SYMBOL_SINCE` / `PEER_SUBPATH_SINCE` were measured
 *     against the real tarballs of every published `@civitai/app-sdk` (see
 *     their docblocks for the recipe and the controls); this file asserts the
 *     tree is still consistent with them. Adding a peer import that is not in
 *     the ledger FAILS — it is never a silent pass.
 *   - It cannot see a symbol imported through a re-export chain it does not
 *     parse; `blocks/index.ts` has no `export *` today and the symbol-coverage
 *     test below fails loudly if one appears.
 *   - It cannot see the FUTURE. The range's ceiling is `<1.0.0`, so it admits
 *     app-sdk versions that do not exist yet; nothing offline can check those.
 *     A symbol REMOVED from `./blocks` in a later minor (0.48.0 moved
 *     `defineBlock` off it) is caught only when the ledger is re-measured,
 *     which is why each entry records a CONTIGUOUS run, not a first sighting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BLOCKS_REACT_PKG = 'packages/civitai-blocks-react/package.json';
const APP_SDK_PKG = 'packages/civitai-app-sdk/package.json';
const BLOCKS_INDEX = 'packages/civitai-app-sdk/src/blocks/index.ts';
const BLOCKS_REACT_SRC = 'packages/civitai-blocks-react/src';

/**
 * The last PUBLISHED `@civitai/app-sdk` that predates the App Storage
 * constants, measured against the real tarball (see the header). The floor
 * must not admit it.
 *
 * 🔴 This is the ONLY hand-entered version in this file, and it is a fact
 * about npm, not a preference: 0.46.0 was `npm view @civitai/app-sdk version`
 * when #344 was fixed, and `import { APP_STORAGE_MAX_BYTES } from
 * '@civitai/app-sdk/blocks'` throws against it. Raise it only alongside a
 * fresh measurement of the same shape.
 */
const LAST_RELEASE_WITHOUT_APP_STORAGE_CONSTANTS = '0.46.0';

/** Value symbols whose absence below the floor is the #344 defect. */
const APP_STORAGE_CONSTANTS = [
  'APP_STORAGE_MAX_VALUE_BYTES',
  'APP_STORAGE_MAX_BYTES',
  'APP_STORAGE_MAX_ROWS',
];

/**
 * THE LEDGER. For each VALUE symbol `@civitai/blocks-react` imports from the
 * peer: the lowest PUBLISHED `@civitai/app-sdk` from which that symbol is
 * exported CONTINUOUSLY through the latest published version.
 *
 * This is what the floor rule is actually made of. The floor must be >= the
 * highest entry here across the symbols the package imports today — i.e. every
 * version the range still admits exports everything the code reaches for. That
 * rule is a statement about SYMBOLS; it is NOT "the floor equals the in-tree
 * version", which is a different and much stricter claim that goes red on every
 * release that bumps app-sdk without this package needing anything new.
 *
 * 🔴 CONTIGUOUS, not first-sighted, and the distinction is load-bearing: exports
 * are not monotonic. `defineBlock` and `BlockManifestError` were exported by
 * `./blocks` up to 0.47.0 and MOVED OFF IT in 0.48.0 (#352). A "first version
 * that exports it" number would keep vouching for a symbol that no longer
 * exists. Each entry below is the start of an unbroken run to the newest
 * published version at measurement time.
 *
 * MEASURED 2026-09-20 against the REAL tarballs of all 47 published versions
 * (0.1.0 … 0.47.0), not the workspace copy and not a parse of the source:
 *   for each version V:
 *     npm pack @civitai/app-sdk@V && tar -xf …
 *     resolve `exports['./blocks'].import` out of the tarball's package.json
 *     node -e "import(<that file>).then(m => console.log(Object.keys(m)))"
 *   then, per symbol, walk versions DOWNWARD from the newest while the symbol
 *   is present; the last version still present is the entry below.
 * Controls run on that sweep before its numbers were believed:
 *   - POSITIVE: 46/47 versions yielded a non-empty export set (0.1.0 predates
 *     the `./blocks` subpath entirely). A sweep reporting zero everywhere is
 *     indistinguishable from one wired to nothing.
 *   - NEGATIVE: an impossible symbol (`__THIS_SYMBOL_CANNOT_EXIST__`) was
 *     reported absent in 0 of 46 — the probe can say "no".
 *   - CROSS-CHECK: the sweep independently reproduces the hand measurement
 *     already recorded in `comment-peerDependencies` — 0.46.0 exports none of
 *     the three App Storage constants, 0.47.0 exports all three.
 *
 * 🔴 TO ADD AN ENTRY you must MEASURE it, not infer it from release ordering.
 * #309's own ticket guessed `>=0.39.0` from the first symbol it noticed and was
 * wrong by a whole minor. Re-run the sweep above for the new symbol; a guess
 * here is worse than no ledger, because it reads as a measurement.
 */
const PEER_VALUE_SYMBOL_SINCE = {
  APP_STORAGE_MAX_BYTES: '0.47.0',
  APP_STORAGE_MAX_ROWS: '0.47.0',
  APP_STORAGE_MAX_VALUE_BYTES: '0.47.0',
  BLOCK_SCOPES: '0.6.0',
  BrowsingLevel: '0.13.0',
  OTHER_MESSAGE_TYPE_LABEL: '0.45.0',
  SFW_LEVELS: '0.13.0',
  boundBlockToParentMessageType: '0.45.0',
  effectiveBrowsingCeiling: '0.39.0',
  isLevelAllowed: '0.13.0',
  isMessage: '0.6.0',
  isSfwCeiling: '0.13.0',
  parseBlockInitFragment: '0.31.0',
  stripBlockInitFragment: '0.31.0',
};

/**
 * The same ledger for SUBPATHS. A bare `import '@civitai/app-sdk/safe-storage'`
 * (src/index.ts, first import on purpose) names no symbol, so the symbol ledger
 * cannot see it — but it still has to RESOLVE, and against a version without
 * that subpath it dies at module load with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`, on the MAIN entry rather than `./testing`.
 * A type-only `export type { … } from '@civitai/app-sdk/blocks'` is here for
 * the same reason: no value crosses, but the specifier must still resolve for
 * `tsc` in a consumer.
 *
 * Measured by the same sweep, reading `Object.keys(pkg.exports)` out of each
 * published tarball's package.json and walking downward while the subpath is
 * present.
 */
const PEER_SUBPATH_SINCE = {
  '@civitai/app-sdk/blocks': '0.6.0',
  '@civitai/app-sdk/safe-storage': '0.27.0',
};

const readJson = (rel) => JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'));
const readText = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// semver-lite. `semver` is not a declared dependency of this repo and is not
// reliably resolvable, so the ONE range shape this package uses is parsed
// explicitly — and an unrecognised shape THROWS rather than passing.
// ---------------------------------------------------------------------------

/** `">=0.47.0 <1.0.0"` -> `{ floor: [0,47,0], ceil: [1,0,0] }`. Throws otherwise. */
export function parsePeerRange(range) {
  const m = /^>=(\d+)\.(\d+)\.(\d+)\s+<(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
  assert.ok(
    m,
    `peer range "${range}" is not the \`>=X.Y.Z <A.B.C\` shape this guard understands.\n` +
      `Refusing to guess: an unparsed range would read as a silent PASS, which is the\n` +
      `exact failure mode (#309) this file exists to close. Widen the parser, and add a\n` +
      `control case for the new shape.`,
  );
  return {
    floor: [Number(m[1]), Number(m[2]), Number(m[3])],
    ceil: [Number(m[4]), Number(m[5]), Number(m[6])],
  };
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const parseVersion = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  assert.ok(m, `"${v}" is not a plain X.Y.Z version`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/** Does `version` fall inside `range`? */
export function admits(range, version) {
  const { floor, ceil } = parsePeerRange(range);
  const v = parseVersion(version);
  return cmp(v, floor) >= 0 && cmp(v, ceil) < 0;
}

// ---------------------------------------------------------------------------
// What the peer actually exports, and what this package actually imports.
// ---------------------------------------------------------------------------

/**
 * VALUE export names re-exported by `blocks/index.ts`. `export type { … }`
 * clauses are deliberately excluded: a type-only export satisfies a plain
 * value import at typecheck time and then fails at runtime, which is the #309
 * failure mode itself.
 */
export function valueExportsOf(indexSource) {
  assert.ok(
    !/^\s*export\s+\*/m.test(indexSource),
    `blocks/index.ts now has an \`export *\`. This parser cannot follow it, so the\n` +
      `symbol-coverage check below would silently stop seeing symbols. Teach the\n` +
      `parser to follow it, or list the module's exports explicitly.`,
  );
  const names = new Set();
  // `[^{}]` (not `[\s\S]*?`) so a clause body can never swallow the closing
  // brace of an EARLIER statement and run on into the next one. That bug was
  // measured: the lazy form reported `useCallback } from 'react';\n\nimport
  // type { BlockToken` as an imported symbol name.
  const re = /export\s+(type\s+)?\{([^{}]*)\}\s*from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(indexSource))) {
    if (m[1]) continue; // `export type { … }` — not a value
    for (const raw of m[2].split(',')) {
      const clause = raw.trim();
      if (!clause) continue;
      if (/^type\s/.test(clause)) continue; // inline `type X` in a value clause
      const name = clause.split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * VALUE symbols `source` imports — or re-exports — from any `@civitai/app-sdk*`
 * specifier, as `{ symbol, specifier }`. `import type { … }` and inline
 * `type X` are excluded for the same reason as above; bare and star imports
 * name no symbol (see `peerSpecifiersOf`).
 *
 * 🔴 STATEMENT-ANCHORED (`(?:^|;)[ \t]*`), and that is not cosmetic. A JSDoc
 * `@example` block is a comment full of lines that look exactly like imports:
 *   src/hooks/useBlockContext.ts:42  ` * import { isSignedIn } from '@civitai/app-sdk/blocks';`
 * The unanchored form counted that as a real import of `isSignedIn`. Harmless
 * for the #344 range check, but NOT for the derived-floor rule below: an
 * app-sdk symbol mentioned in a doc example would push the REQUIRED floor up
 * and turn a correct floor red — the same over-strictness this file has already
 * shipped once. A real ESM `import`/`export … from` declaration is top-level,
 * so it starts a line (or follows a `;`); a JSDoc line starts with `*`.
 *
 * `export { X } from '@civitai/app-sdk/blocks'` is matched too: a value
 * re-exported from the peer has to resolve in the consumer exactly like an
 * imported one, and the old `import`-only parser was blind to it.
 */
export function valueImportsOf(source) {
  const out = [];
  const re =
    /(?:^|;)[ \t]*(?:import|export)\s+(type\s+)?\{([^{}]*)\}\s*from\s*['"](@civitai\/app-sdk[^'"]*)['"]/gm;
  let m;
  while ((m = re.exec(source))) {
    if (m[1]) continue;
    for (const raw of m[2].split(',')) {
      const clause = raw.trim();
      if (!clause) continue;
      if (/^type\s/.test(clause)) continue;
      const symbol = clause.split(/\s+as\s+/)[0].trim();
      if (symbol) out.push({ symbol, specifier: m[3] });
    }
  }
  return out;
}

/**
 * Every `@civitai/app-sdk*` SPECIFIER `source` imports from or re-exports from,
 * whatever the clause shape — named, `import type`, bare side-effect, star, or
 * `export … from`. These name no symbol but still have to resolve, so they are
 * the other half of the peer surface.
 *
 * Statement-anchored for the same reason as above, and the specifier character
 * class excludes quotes, so a match can never run past an earlier statement's
 * string literal into a later one.
 */
export function peerSpecifiersOf(source) {
  const out = new Set();
  const re = /(?:^|;)[ \t]*(?:import|export)\b[^'"`;]*?['"](@civitai\/app-sdk[^'"]*)['"]/gm;
  let m;
  while ((m = re.exec(source))) out.add(m[1]);
  return out;
}

/**
 * The lowest peer version that satisfies every `need` (a symbol name, or a
 * specifier), per `ledger`, plus the needs the ledger does not cover.
 *
 * `unledgered` is the no-silent-pass half: a need with no recorded measurement
 * is not assumed fine, it is REPORTED. That is what makes a newly-imported
 * symbol — #344's exact shape — fail this guard instead of sliding past it.
 */
export function requiredFloorFor(needs, ledger) {
  const unledgered = [];
  let required = null;
  for (const need of needs) {
    if (!Object.hasOwn(ledger, need)) {
      unledgered.push(need);
      continue;
    }
    const v = parseVersion(ledger[need]);
    if (required === null || cmp(v, required) > 0) required = v;
  }
  return { required, unledgered: unledgered.sort() };
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage']);

function walkSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSources(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Controls. A verdict from an instrument nobody validated is a claim about the
// instrument.
// ---------------------------------------------------------------------------

test('CONTROL — the range checker can say both yes and no', () => {
  assert.equal(admits('>=0.47.0 <1.0.0', '0.47.0'), true, 'floor itself must be admitted');
  assert.equal(admits('>=0.47.0 <1.0.0', '0.46.0'), false, 'below the floor must be refused');
  assert.equal(admits('>=0.47.0 <1.0.0', '0.99.3'), true);
  assert.equal(admits('>=0.47.0 <1.0.0', '1.0.0'), false, 'the ceiling is exclusive');
  // The OLD, broken range must be shown to admit the broken version — otherwise
  // the assertion below could pass for a reason unrelated to the floor.
  assert.equal(admits('>=0.45.0 <1.0.0', '0.46.0'), true, 'the pre-#344 range admitted 0.46.0');
  assert.throws(() => parsePeerRange('^0.47.0'), /not the .>=X\.Y\.Z <A\.B\.C. shape/);
});

test('CONTROL — the import/export parsers are not wired to nothing', () => {
  // Shaped like a real source file, NOT a textbook fixture: a `react` import
  // sits immediately before the peer import, which is the arrangement that
  // made the first draft of this parser report
  // `useCallback } from 'react';\n\nimport type { BlockToken` as a symbol.
  const imports = valueImportsOf(`
    import { useCallback, useState } from 'react';

    import type { NeverAValue } from '@civitai/app-sdk/blocks';
    import { KEPT_A, type DroppedType, KEPT_B as Aliased } from '@civitai/app-sdk/blocks';
    import '@civitai/app-sdk/safe-storage';
  `);
  assert.deepEqual(
    imports.map((i) => i.symbol).sort(),
    ['KEPT_A', 'KEPT_B'],
    'the import parser must keep value clauses, drop type clauses, and ignore other packages',
  );

  const exports = valueExportsOf(`
    export { VALUE_A, VALUE_B as Renamed } from './a.js';
    export type { TypeOnly } from './a.js';
    export { VALUE_C, type InlineType } from './b.js';
  `);
  assert.deepEqual([...exports].sort(), ['VALUE_A', 'VALUE_B', 'VALUE_C']);
  assert.ok(!exports.has('TypeOnly'), 'a type-only export is NOT a value export');
  assert.ok(!exports.has('InlineType'), 'an inline `type X` clause is NOT a value export');

  assert.throws(() => valueExportsOf("export * from './a.js';"), /export \*/);
});

test('CONTROL — a JSDoc @example is not an import, and an `export … from` the peer is', () => {
  // The exact line that fooled the unanchored parser, in its real surroundings.
  const doc = [
    '/**',
    ' * ```tsx',
    " * import { isSignedIn } from '@civitai/app-sdk/blocks';",
    ' * ```',
    ' */',
    "import { REAL_VALUE } from '@civitai/app-sdk/blocks';",
    "export { RE_EXPORTED } from '@civitai/app-sdk/blocks';",
    "export type { JustAType } from '@civitai/app-sdk/blocks';",
  ].join('\n');
  const symbols = valueImportsOf(doc).map((i) => i.symbol).sort();
  assert.deepEqual(
    symbols,
    ['REAL_VALUE', 'RE_EXPORTED'].sort(),
    'a doc-comment example must not count as an import, and a value re-export must',
  );
  assert.ok(!symbols.includes('isSignedIn'), 'the JSDoc line leaked back in');

  // POSITIVE CONTROL on the anchor itself: it must not have narrowed so far
  // that a genuinely indented or `;`-chained declaration stops being seen.
  assert.deepEqual(
    valueImportsOf("  import { INDENTED } from '@civitai/app-sdk/blocks';").map((i) => i.symbol),
    ['INDENTED'],
  );
  assert.deepEqual(
    valueImportsOf("import 'x'; import { CHAINED } from '@civitai/app-sdk/blocks';").map((i) => i.symbol),
    ['CHAINED'],
  );

  // Specifier scan: every clause shape, and nothing from a comment.
  const specs = peerSpecifiersOf(
    [
      " * import '@civitai/app-sdk/from-a-comment';",
      "   x?: import('@civitai/app-sdk/from-a-type-position').Thing;",
      "import '@civitai/app-sdk/safe-storage';",
      "import * as sdk from '@civitai/app-sdk/blocks';",
      "import type { T } from '@civitai/app-sdk/blocks';",
      "export type { U } from '@civitai/app-sdk/other';",
      "import { Local } from './local.js';",
      "import { Unrelated } from 'react';",
    ].join('\n'),
  );
  assert.deepEqual(
    [...specs].sort(),
    ['@civitai/app-sdk/blocks', '@civitai/app-sdk/other', '@civitai/app-sdk/safe-storage'],
    'bare/star/type/export clauses all name a specifier; comments and other packages do not',
  );

  // The floor arithmetic, both directions.
  const ledger = { A: '0.10.0', B: '0.45.0', C: '0.3.0' };
  assert.deepEqual(requiredFloorFor(['A', 'C'], ledger), { required: [0, 10, 0], unledgered: [] });
  assert.deepEqual(requiredFloorFor(['A', 'B', 'C'], ledger), { required: [0, 45, 0], unledgered: [] });
  assert.deepEqual(
    requiredFloorFor(['A', 'NEW_SYMBOL', 'ALSO_NEW'], ledger),
    { required: [0, 10, 0], unledgered: ['ALSO_NEW', 'NEW_SYMBOL'] },
    'an unrecorded need must be REPORTED, never skipped — skipping it is the silent pass',
  );
  assert.deepEqual(requiredFloorFor([], ledger), { required: null, unledgered: [] });
});

// ---------------------------------------------------------------------------
// The guards.
// ---------------------------------------------------------------------------

test('REGRESSION (#344) — the peer floor excludes the last app-sdk release without the App Storage constants', () => {
  const { peerDependencies } = readJson(BLOCKS_REACT_PKG);
  const range = peerDependencies['@civitai/app-sdk'];
  const broken = LAST_RELEASE_WITHOUT_APP_STORAGE_CONSTANTS;

  // Only meaningful while the package still imports the symbols. If it stops,
  // this stops being a rule — and must be deleted, not left passing vacuously.
  const importedHere = new Set(
    walkSources(join(REPO_ROOT, BLOCKS_REACT_SRC)).flatMap((f) =>
      valueImportsOf(readFileSync(f, 'utf8')).map((i) => i.symbol),
    ),
  );
  const stillImported = APP_STORAGE_CONSTANTS.filter((n) => importedHere.has(n));
  assert.ok(
    stillImported.length > 0,
    `no file under ${BLOCKS_REACT_SRC} value-imports any of ${APP_STORAGE_CONSTANTS.join(', ')}\n` +
      `any more. This guard is now vacuous — delete it rather than let it pass.`,
  );

  assert.equal(
    admits(range, broken),
    false,
    `@civitai/blocks-react value-imports ${stillImported.join(', ')} from '@civitai/app-sdk/blocks',\n` +
      `but its declared peer range "${range}" still admits @civitai/app-sdk@${broken}, which does\n` +
      `not export ${stillImported[0]}. A consumer on that combination installs with NO warning and\n` +
      `then dies at module evaluation:\n\n` +
      `    SyntaxError: The requested module '@civitai/app-sdk/blocks'\n` +
      `      does not provide an export named '${stillImported[0]}'\n\n` +
      `Blast radius is the './testing' subpath — src/testing.tsx reaches internal/mockHost.ts —\n` +
      `so the main entry still boots and every dev harness and downstream test suite dies.\n` +
      `Raise the floor to the app-sdk version the PENDING changesets publish; derive it with\n` +
      `\`pnpm exec changeset status --verbose\`, and record the derivation in the package's\n` +
      `\`comment-peerDependencies\` block. \`changeset version\` will NOT do this for you:\n` +
      `onlyUpdatePeerDependentsWhenOutOfRange only rewrites a range the computed version FAILS.`,
  );
});

test('INVARIANT GUARD (green before #344) — every value symbol imported from the peer is a value export of the peer', () => {
  // Labelled an INVARIANT GUARD deliberately: it was already green before the
  // #344 fix, because the in-tree peer does export the constants. It pins the
  // OTHER half of the #309 shape — importing a symbol that exists only as a
  // type, or not at all — which the range check above cannot see.
  const exported = valueExportsOf(readText(BLOCKS_INDEX));
  const files = walkSources(join(REPO_ROOT, BLOCKS_REACT_SRC));
  assert.ok(files.length > 20, `only ${files.length} sources walked — the walker is not reaching src/`);

  const missing = [];
  let checked = 0;
  for (const file of files) {
    for (const { symbol, specifier } of valueImportsOf(readFileSync(file, 'utf8'))) {
      if (specifier !== '@civitai/app-sdk/blocks') continue;
      checked += 1;
      if (!exported.has(symbol)) missing.push(`${relative(REPO_ROOT, file)} imports ${symbol}`);
    }
  }
  // Positive control on the sweep itself: a zero from `missing` is worthless if
  // `checked` is also zero.
  assert.ok(checked > 0, 'no value imports from @civitai/app-sdk/blocks were seen at all');
  for (const name of APP_STORAGE_CONSTANTS) {
    assert.ok(exported.has(name), `${BLOCKS_INDEX} does not re-export ${name} as a VALUE`);
  }
  assert.deepEqual(missing, [], `value-imported but not value-exported by ${BLOCKS_INDEX}`);
});

test('INVARIANT GUARD — the floor never names a version that will not be published', () => {
  // A floor ABOVE what the pending release produces is unsatisfiable forever.
  // Green before #344 too; it catches a typo in the other direction.
  const floorRange = readJson(BLOCKS_REACT_PKG).peerDependencies['@civitai/app-sdk'];
  const { floor } = parsePeerRange(floorRange);
  const inTree = parseVersion(readJson(APP_SDK_PKG).version);

  const dir = join(REPO_ROOT, '.changeset');
  let bump = 'none';
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const m = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!m) continue;
    const line = m[1].split('\n').find((l) => /['"]@civitai\/app-sdk['"]\s*:/.test(l));
    if (!line) continue;
    if (/:\s*major/.test(line)) bump = 'major';
    else if (/:\s*minor/.test(line) && bump !== 'major') bump = 'minor';
    else if (/:\s*patch/.test(line) && bump === 'none') bump = 'patch';
  }
  const next =
    bump === 'major'
      ? [inTree[0] + 1, 0, 0]
      : bump === 'minor'
        ? [inTree[0], inTree[1] + 1, 0]
        : bump === 'patch'
          ? [inTree[0], inTree[1], inTree[2] + 1]
          : inTree;

  assert.ok(
    cmp(floor, next) <= 0,
    `the peer floor ${floor.join('.')} is ABOVE the app-sdk version this branch will publish\n` +
      `(${next.join('.')} = in-tree ${inTree.join('.')} + the pending "${bump}" changeset), so no\n` +
      `release can ever satisfy it.`,
  );
});

test('DERIVED FLOOR — the floor is at least the lowest app-sdk that exports everything this package imports', () => {
  // THE RULE, stated as the package's own `comment-peerDependencies` states it:
  // "the floor is the lowest published version that exports every symbol this
  // package imports from the peer". Not "the floor equals the in-tree version".
  //
  // 🔴 THE PREVIOUS VERSION OF THIS TEST ASSERTED `floor >= inTree`, AND THAT
  // WAS THE WRONG RULE. It is strictly stronger than the one the package needs:
  // it demands the floor rise on EVERY app-sdk bump, including the many that
  // add nothing this package imports. It went red on Version Packages #354 —
  // floor `>=0.47.0`, in-tree `0.48.0` after `changeset version`, nothing new
  // imported, nothing actually wrong — in all five legs of the required
  // `Starter` matrix. A required gate that reds on every release is worse than
  // no gate: it teaches everyone to click through the one signal that matters.
  //
  // The rule below is version-agnostic by construction: it moves only when the
  // SYMBOLS move, so a release that bumps app-sdk alone leaves it green, and
  // #344's shape (a new value import the floor does not cover) leaves it red.
  const { peerDependencies } = readJson(BLOCKS_REACT_PKG);
  const range = peerDependencies['@civitai/app-sdk'];
  const { floor } = parsePeerRange(range);

  const files = walkSources(join(REPO_ROOT, BLOCKS_REACT_SRC));
  assert.ok(files.length > 20, `only ${files.length} sources walked — the walker is not reaching src/`);

  const symbols = new Set();
  const specifiers = new Set();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const { symbol } of valueImportsOf(src)) symbols.add(symbol);
    for (const spec of peerSpecifiersOf(src)) specifiers.add(spec);
  }

  // POSITIVE CONTROLS on the sweep. Everything below is a claim about these two
  // sets; if either is empty the assertions are vacuous, and a vacuous green is
  // what this file exists to prevent.
  assert.ok(symbols.size > 0, 'no value imports from @civitai/app-sdk were seen at all — the sweep is wired to nothing');
  assert.ok(specifiers.size > 0, 'no @civitai/app-sdk specifiers were seen at all — the sweep is wired to nothing');

  const RECIPE =
    `Measure it — do NOT infer it from release ordering (#309's ticket did, and was wrong by a\n` +
    `whole minor). In a scratch dir OUTSIDE this workspace, for candidate versions of\n` +
    `@civitai/app-sdk: \`npm pack @civitai/app-sdk@<v>\`, untar, resolve the subpath out of the\n` +
    `tarball's own package.json \`exports\`, and \`node -e "import(<file>).then(m => …Object.keys(m))"\`.\n` +
    `The entry is the LOWEST version from which it is present CONTINUOUSLY through the newest\n` +
    `published one — exports are not monotonic (0.48.0 moved \`defineBlock\` off ./blocks).\n` +
    `Include a symbol you know cannot exist and check it reports absent, or the probe is wired\n` +
    `to nothing. pnpm cannot make this measurement: \`pnpm.overrides\` resolves the peer to the\n` +
    `workspace copy, which is the blindness this whole file is about.`;

  const bySymbol = requiredFloorFor(symbols, PEER_VALUE_SYMBOL_SINCE);
  assert.deepEqual(
    bySymbol.unledgered,
    [],
    `@civitai/blocks-react now value-imports peer symbols with no recorded measurement:\n\n` +
      `    ${bySymbol.unledgered.join(', ')}\n\n` +
      `This guard cannot know which published @civitai/app-sdk versions export them, so it\n` +
      `cannot tell you whether the declared floor "${range}" is still safe — and it will not\n` +
      `guess, because a guess here reads as a measurement. This is #344's exact shape: the\n` +
      `range stays SATISFIED, npm warns about nothing, and a consumer dies at module\n` +
      `evaluation with "does not provide an export named '${bySymbol.unledgered[0]}'".\n\n` +
      `Add each symbol to PEER_VALUE_SYMBOL_SINCE in this file, then raise the floor if the\n` +
      `assertion below says so.\n\n${RECIPE}`,
  );

  const bySubpath = requiredFloorFor(specifiers, PEER_SUBPATH_SINCE);
  assert.deepEqual(
    bySubpath.unledgered,
    [],
    `@civitai/blocks-react now imports from @civitai/app-sdk subpaths with no recorded\n` +
      `measurement:\n\n    ${bySubpath.unledgered.join(', ')}\n\n` +
      `A subpath names no symbol, so the symbol ledger cannot see it — but it still has to\n` +
      `resolve. Against a version that does not export it the failure is\n` +
      `ERR_PACKAGE_PATH_NOT_EXPORTED at module load. Add each to PEER_SUBPATH_SINCE, reading\n` +
      `\`Object.keys(pkg.exports)\` out of each candidate tarball's package.json.\n\n${RECIPE}`,
  );

  // Both ledgers are covered, so both `required` values are non-null here —
  // guaranteed by the positive controls above, which proved the sets non-empty.
  const required =
    cmp(bySymbol.required, bySubpath.required) >= 0 ? bySymbol.required : bySubpath.required;
  const driver = cmp(bySymbol.required, bySubpath.required) >= 0 ? 'symbol' : 'subpath';
  const drivers = (driver === 'symbol'
    ? [...symbols].filter((s) => PEER_VALUE_SYMBOL_SINCE[s] === required.join('.'))
    : [...specifiers].filter((s) => PEER_SUBPATH_SINCE[s] === required.join('.'))
  ).sort();

  assert.ok(
    cmp(floor, required) >= 0,
    `the declared @civitai/app-sdk peer floor ${floor.join('.')} is BELOW ${required.join('.')}, the\n` +
      `lowest published version that provides everything this package imports.\n\n` +
      `What forces ${required.join('.')} — the highest ${driver} requirement in the tree:\n` +
      `    ${drivers.join(', ')}\n\n` +
      `The range "${range}" therefore still admits published versions that do NOT provide\n` +
      `them. npm will not warn — the range is SATISFIED — so a consumer installs cleanly and\n` +
      `then dies at module evaluation:\n\n` +
      `    SyntaxError: The requested module '@civitai/app-sdk/blocks'\n` +
      `      does not provide an export named '${drivers[0]}'\n\n` +
      `Raise the floor in packages/civitai-blocks-react/package.json to at least\n` +
      `${required.join('.')} and record the derivation in its \`comment-peerDependencies\` block.\n` +
      `\`changeset version\` will NOT do this for you: onlyUpdatePeerDependentsWhenOutOfRange\n` +
      `only rewrites a range the computed version FAILS, and a too-LOW floor never fails one.`,
  );
});

test('DERIVED FLOOR — the ledgers describe what the package imports TODAY, with nothing dead left in', () => {
  // The other direction, and it is not hygiene. A stale entry for a symbol the
  // package stopped importing keeps DEMANDING its version forever, so the floor
  // can only be held too HIGH — which is how this file shipped an over-strict
  // required gate in the first place. Prune on the way out, not "eventually".
  const files = walkSources(join(REPO_ROOT, BLOCKS_REACT_SRC));
  const symbols = new Set();
  const specifiers = new Set();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const { symbol } of valueImportsOf(src)) symbols.add(symbol);
    for (const spec of peerSpecifiersOf(src)) specifiers.add(spec);
  }
  assert.ok(symbols.size > 0 && specifiers.size > 0, 'the sweep saw nothing — see the controls above');

  const deadSymbols = Object.keys(PEER_VALUE_SYMBOL_SINCE).filter((s) => !symbols.has(s)).sort();
  assert.deepEqual(
    deadSymbols,
    [],
    `PEER_VALUE_SYMBOL_SINCE records symbols @civitai/blocks-react no longer value-imports:\n\n` +
      `    ${deadSymbols.join(', ')}\n\n` +
      `Each one still counts toward the required floor, so the floor is now pinned higher than\n` +
      `the code needs and this gate reds on releases that are fine. Delete them.`,
  );

  const deadSubpaths = Object.keys(PEER_SUBPATH_SINCE).filter((s) => !specifiers.has(s)).sort();
  assert.deepEqual(
    deadSubpaths,
    [],
    `PEER_SUBPATH_SINCE records subpaths @civitai/blocks-react no longer imports:\n\n` +
      `    ${deadSubpaths.join(', ')}\n\nDelete them — see above.`,
  );
});

test('the package records how the floor was derived', () => {
  // A number with no derivation is the thing #309 and #317 both left behind.
  // Pin the CLAIM, not the wording: the block must name the tool that produced
  // the number and the flag that will not fix it.
  const comment = readJson(BLOCKS_REACT_PKG)['comment-peerDependencies'];
  assert.ok(Array.isArray(comment), 'comment-peerDependencies must be an array of lines');
  const prose = comment.join('\n');
  for (const needle of [
    'changeset status',
    'onlyUpdatePeerDependentsWhenOutOfRange',
    LAST_RELEASE_WITHOUT_APP_STORAGE_CONSTANTS,
    'APP_STORAGE_MAX_BYTES',
  ]) {
    assert.ok(
      prose.includes(needle),
      `comment-peerDependencies no longer mentions "${needle}" — the derivation record is\n` +
        `incomplete, so the next person re-derives from scratch or, worse, guesses.`,
    );
  }
});

test('STRUCTURAL — the app-sdk peer is not also a hard dependency', () => {
  // A `dependencies` entry would mask the whole class: npm would install a
  // satisfying copy regardless of what the consumer has.
  const pkg = readJson(BLOCKS_REACT_PKG);
  assert.ok(!('@civitai/app-sdk' in (pkg.dependencies ?? {})), '@civitai/app-sdk must stay a peer');
  assert.ok(statSync(join(REPO_ROOT, BLOCKS_INDEX)).isFile());
});
