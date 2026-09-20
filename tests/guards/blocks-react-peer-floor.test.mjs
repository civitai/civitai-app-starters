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
 *   - OFFLINE AND TREE-LOCAL, on purpose. CI checks out at `fetch-depth: 1`
 *     and the guard job has no registry access budget, so this cannot ask git
 *     what `origin/main` exported, nor npm what a published tarball exports.
 *     Everything below is computed from the working tree.
 *   - Consequently the FLOOR EXCLUSION is a recorded measurement, not a live
 *     one: the version it names was measured by hand (`npm i
 *     @civitai/app-sdk@<v>` in a scratch dir outside this workspace, then
 *     `node -e` importing the symbol), and the recipe to redo it lives in
 *     `packages/civitai-blocks-react/package.json`'s `comment-peerDependencies`.
 *     This asserts the number that measurement produced is still declared.
 *   - It cannot see a symbol imported through a re-export chain it does not
 *     parse; `blocks/index.ts` has no `export *` today and the symbol-coverage
 *     test below fails loudly if one appears.
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
 * VALUE symbols `source` imports from any `@civitai/app-sdk*` specifier, as
 * `{ symbol, specifier }`. `import type { … }` and inline `type X` are
 * excluded for the same reason as above; bare and star imports name no symbol.
 */
export function valueImportsOf(source) {
  const out = [];
  const re = /import\s+(type\s+)?\{([^{}]*)\}\s*from\s*['"](@civitai\/app-sdk[^'"]*)['"]/g;
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

test('the changesets on this branch still compute the declared floor', () => {
  // The DERIVATION, re-run as an assertion. `changeset status` is the tool that
  // will actually run at release; this re-derives its arithmetic from the same
  // two inputs (the in-tree version and the pending bump) and checks the number
  // written into the manifest is still that one.
  //
  // 🔴 This rule is LIVE ONLY WHILE AN app-sdk BUMP IS PENDING. Once the
  // Version Packages PR merges the changeset is consumed, the in-tree version
  // becomes the published one, and the floor legitimately equals it. Both cases
  // are asserted, so neither is a skip.
  const { peerDependencies } = readJson(BLOCKS_REACT_PKG);
  const { floor } = parsePeerRange(peerDependencies['@civitai/app-sdk']);
  const inTree = parseVersion(readJson(APP_SDK_PKG).version);
  assert.ok(
    cmp(floor, inTree) >= 0,
    `the peer floor ${floor.join('.')} is below the in-tree app-sdk ${inTree.join('.')}. That is\n` +
      `allowed in general — an old floor is fine when nothing new is imported — but this\n` +
      `package imports the App Storage constants, so see the #344 regression test above.`,
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
