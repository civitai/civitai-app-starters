/**
 * Tests for `exports` SUBPATH PATTERN handling in
 * `scripts/check-public-type-closure.mjs` — the CI job
 * `Public type closure (built .d.ts)`.
 *
 * ## The regression these exist for
 *
 * `collectEntries()` resolved each `exports` entry's `types` string with
 * `existsSync(resolve(pkgDir, dts))`. A SUBPATH PATTERN names a SET, not a
 * file — `"./elements/*": { "types": "./dist/elements/*.d.ts" }` — and the
 * literal string, `*` and all, is a path that exists in no built tree there
 * has ever been. So the guard reported
 *
 *     UNBUILT TREE — these declared `exports` targets are missing or empty
 *
 * over a tree that was fully built, and exited 1. MEASURED on #415's head
 * `ffe66fc` after a green root `pnpm build` (rc 0):
 * `packages/civitai-components-react/dist/elements/` held 44 `.d.ts` files,
 * `index.d.ts` among them at 2,413 B, while the guard called that path
 * missing. `Public type closure (built .d.ts)` is a REQUIRED check on `main`,
 * so that is a permanently-red gate for any PR that declares a pattern.
 *
 * ## What is asserted, and why in this shape
 *
 * The guard derives its repo root from its OWN location (`resolve(HERE, '..')`)
 * and hard-codes the package directory list, so these tests drive it the way
 * `fixture.mjs` drives the starter guards: COPY the real script into a
 * synthetic tree and run it there. Nothing in the script is made test-only —
 * the file under test is byte-for-byte the file CI runs.
 *
 * A fixture tree can never make the guard exit 0: `LEDGER` is a hard-coded set
 * equality against the REAL packages, so a synthetic tree always reports a
 * ledger mismatch. Every assertion here is therefore on the guard's OUTPUT,
 * and the load-bearing one is deliberately POSITIVE rather than "the unbuilt
 * banner is absent": one of the pattern-matched files carries a planted
 * nameable-position violation, so a passing run has to print a finding LABELLED
 * WITH THE EXPANDED SUBPATH. That single line proves three things at once —
 * the pattern expanded, `*` bound to the right segment, and the expanded entry
 * was really SCANNED rather than merely counted.
 *
 * The four deliberate properties of the expansion each get a case, because
 * three of them are the guard KEEPING ITS TEETH and a fix that widened the
 * pattern branch into "if it has a `*`, skip it" would pass the headline test
 * alone:
 *
 *   1. a pattern matching NO file is still the unbuilt case, and still fails;
 *   2. more than one `*` is REFUSED (Node allows exactly one);
 *   3. a `*` that spans directories is REFUSED rather than silently scanning a
 *      subset of what Node would resolve;
 *   4. an empty (0-byte) match is skipped, exactly as an empty plain target is.
 *
 * Plus a fifth: the NON-pattern branch is unchanged in both directions, since
 * every package on `main` uses it and a fix that perturbed it would be a
 * regression in the other direction.
 *
 * ## 🔴 WHICH TIER THIS RUNS IN, AND WHAT THE OTHER TIER CANNOT SEE
 *
 * The guard resolves the INSTALLED `typescript` before it does anything else,
 * so this suite needs `pnpm install` to have happened — exactly the reason
 * `ci.yml` gives for keeping `check:public-types` in its own job rather than in
 * `tests/guards/`. But `pnpm test:guards` runs in the required matrix job
 * BEFORE the install, so this file is executed in TWO tiers with different
 * environments:
 *
 *   pre-install  (`pnpm test:guards`, required matrix)  -> SKIPS, structurally
 *                blind to everything below.
 *   post-install (`pnpm test:guards:public-types`, in the `public-types` job,
 *                after `pnpm install`)                  -> runs, and CANNOT
 *                skip: `GUARDS_REQUIRE_INSTALL=1` turns an unresolvable
 *                `typescript` into a FAILURE.
 *
 * That env flag is the whole point. A suite that skips itself when its
 * precondition is missing is worse than no suite — it reads as coverage and
 * provides none — so the tier that is supposed to have the precondition is
 * made unable to skip. Locally `pnpm test:guards` always has an install and
 * runs the whole thing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const GUARD = 'check-public-type-closure.mjs';

/**
 * The package directories the guard walks. Hard-coded in the script as
 * `PACKAGES`, and it `readFileSync`s each one's `package.json` unconditionally
 * — a directory it names but the fixture omits is an ENOENT crash, not a
 * verdict. Mirrored here so every name the script can ask for exists.
 */
const PACKAGE_DIRS = [
  'civitai-app-sdk',
  'civitai-blocks-react',
  'civitai-components',
  'civitai-components-react',
  'civitai-theme',
];

/** Where the pattern under test is declared — the real shape from #415. */
const TARGET = 'civitai-components-react';
const TARGET_NAME = '@civitai/components-react';

/**
 * The guard's FIRST act is `createRequire(<root>/packages/civitai-app-sdk/
 * package.json)` for `typescript`. Resolve it the same way, from the same
 * anchor, so this answers the question the guard will ask rather than a
 * neighbouring one. See the tier note in the header.
 */
function installedTypeScript() {
  try {
    return createRequire(join(REPO_ROOT, 'packages', 'civitai-app-sdk', 'package.json')).resolve(
      'typescript',
    );
  } catch {
    return null;
  }
}

const TS_PATH = installedTypeScript();
const NEEDS_INSTALL =
  'needs the workspace install — `typescript` is not resolvable from ' +
  'packages/civitai-app-sdk. Enforced post-install by the `public-types` CI job ' +
  '(`pnpm test:guards:public-types` with GUARDS_REQUIRE_INSTALL=1).';

// 🔴 The tier that is SUPPOSED to have the install must not be allowed to skip
// quietly — a skipped suite is indistinguishable from a passing one in a
// summary line, and that is how this coverage would evaporate.
if (!TS_PATH && process.env.GUARDS_REQUIRE_INSTALL === '1') {
  test('the workspace install this suite needs is present', () => {
    assert.fail(
      'GUARDS_REQUIRE_INSTALL=1 but ' +
        NEEDS_INSTALL +
        '\nRun `pnpm install --frozen-lockfile` before this step.',
    );
  });
}

/**
 * The guard refuses a scan it thinks walked nothing: `MIN_EXPORTED_SYMBOLS`
 * (300) and `MIN_REFERENCE_NODES` (400) are floors checked AFTER
 * `collectEntries()`. Tripping one is a different exit path with different
 * prose, so the fixture clears both by a wide margin and the assertions can
 * read the real summary line instead of a floor complaint.
 *
 * Sized for the SINGLE-entry cases, not just the three-file pattern tree.
 * MEASURED at 170: the one-entry fixture reported `only 172 exported symbol(s)
 * across 1 entries (floor 300)` — the symbol floor, tripped before the
 * reference floor is ever reached. Each interface after the first contributes
 * one exported symbol and two type references, so 320 clears both; the
 * `N built entries` assertions are what prove it, since a tripped floor is a
 * different exit path that never prints that line.
 */
const FILLER_INTERFACES = 320;

/**
 * A `.d.ts` of entirely EXPORTED declarations that reference each other, so it
 * contributes symbols and reference nodes without contributing findings.
 */
function fillerDts(prefix) {
  const lines = [`export interface ${prefix}T0 { a: string; }`];
  for (let i = 1; i <= FILLER_INTERFACES; i += 1) {
    lines.push(`export interface ${prefix}T${i} { r0: ${prefix}T0; rp: ${prefix}T${i - 1}; }`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 🔴 THE TRAILING `export {};` IS LOAD-BEARING and is what tsc really emits.
 * Without it every top-level declaration in an ambient `.d.ts` is exported, so
 * `HiddenBeta` would be nameable and the planted violation would vanish — the
 * assertion would then pass vacuously on any tree. The guard's own self-test
 * fixture carries the same marker for the same measured reason.
 */
const PLANTED_VIOLATION_DTS = `
interface HiddenBeta { id: number; }
export declare function readBeta(): HiddenBeta;
export {};
`;

function createFixture({ pkgExports = {}, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'public-type-closure-guard-'));

  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
  cpSync(join(REPO_ROOT, 'scripts', GUARD), join(dir, 'scripts', GUARD));
  cpSync(
    join(REPO_ROOT, 'scripts', 'lib', 'dts-public-type-closure.mjs'),
    join(dir, 'scripts', 'lib', 'dts-public-type-closure.mjs'),
  );

  for (const d of PACKAGE_DIRS) {
    mkdirSync(join(dir, 'packages', d), { recursive: true });
    writeFileSync(
      join(dir, 'packages', d, 'package.json'),
      JSON.stringify(
        { name: `@civitai/${d.replace(/^civitai-/, '')}`, version: '0.0.0', exports: pkgExports[d] ?? {} },
        null,
        2,
      ) + '\n',
    );
  }

  // The guard resolves `typescript` with
  // `createRequire(<root>/packages/civitai-app-sdk/package.json)`. A temp dir
  // has no node_modules above it, so point that one lookup at the real install.
  symlinkSync(
    join(REPO_ROOT, 'packages', 'civitai-app-sdk', 'node_modules'),
    join(dir, 'packages', 'civitai-app-sdk', 'node_modules'),
    'dir',
  );

  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, 'packages', rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  return dir;
}

function destroyFixture(dir) {
  if (dir && dir.includes('public-type-closure-guard-')) rmSync(dir, { recursive: true, force: true });
}

async function runGuard(dir) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [join(dir, 'scripts', GUARD)], {
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr, out: stdout + stderr };
  } catch (err) {
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    return { code: err.code ?? 1, stdout, stderr, out: stdout + stderr };
  }
}

async function run(opts) {
  const dir = createFixture(opts);
  try {
    return await runGuard(dir);
  } finally {
    destroyFixture(dir);
  }
}

/** Self-describing failure: name the verdict AND show what the guard said. */
const ctx = (why, r) => `${why}\n--- guard output (exit ${r.code}) ---\n${r.out}`;

const UNBUILT_BANNER = 'UNBUILT TREE — these declared `exports` targets are missing or empty';

/** A tree whose ONLY entries come from one single-`*` pattern matching 3 files. */
const PATTERN_TREE = {
  pkgExports: { [TARGET]: { './elements/*': { types: './dist/elements/*.d.ts' } } },
  files: {
    [`${TARGET}/dist/elements/alpha.d.ts`]: fillerDts('Alpha'),
    [`${TARGET}/dist/elements/beta.d.ts`]: PLANTED_VIOLATION_DTS,
    [`${TARGET}/dist/elements/gamma.d.ts`]: fillerDts('Gamma'),
  },
};

describe('check-public-type-closure — exports subpath patterns', { skip: TS_PATH ? false : NEEDS_INSTALL }, () => {
  test('a pattern over a BUILT tree is expanded, not reported unbuilt', async () => {
    const r = await run(PATTERN_TREE);

    // The regression itself. Pre-fix this banner is the whole output.
    assert.ok(
      !r.out.includes(UNBUILT_BANNER),
      ctx('a fully built pattern target was reported as an UNBUILT TREE', r),
    );

    // One `*` matching three real, non-empty files is three entries.
    assert.match(r.stdout, /check:public-types — 3 built entries,/, ctx('expected 3 expanded entries', r));

    // The POSITIVE observable: the planted violation is reported against the
    // EXPANDED label, which only exists if `*` bound to `beta` and that file
    // was actually walked.
    assert.ok(
      r.stderr.includes(`${TARGET_NAME}/elements/beta#readBeta :: return-type :: HiddenBeta`),
      ctx('the expanded entry was not scanned under its bound-`*` label', r),
    );

    // The unexpanded literal must not survive anywhere in the report.
    assert.ok(!r.out.includes('/elements/*'), ctx('an unexpanded `*` label leaked into the report', r));
  });

  test('a pattern matching NO file is still the unbuilt case', async () => {
    const r = await run({
      pkgExports: { [TARGET]: { './elements/*': { types: './dist/elements/*.d.ts' } } },
      // The directory exists and holds files — none of them `.d.ts`.
      files: { [`${TARGET}/dist/elements/README.md`]: '# not a declaration\n' },
    });

    assert.equal(r.code, 1, ctx('a pattern matching nothing must fail the guard', r));
    assert.ok(r.out.includes(UNBUILT_BANNER), ctx('expected the unbuilt banner', r));
    assert.ok(
      r.out.includes(`${TARGET_NAME}/elements/* -> ./dist/elements/*.d.ts (pattern matched no file)`),
      ctx('the unbuilt report did not name the pattern that matched nothing', r),
    );
  });

  test('a pattern whose directory does not exist at all is the unbuilt case', async () => {
    const r = await run({
      pkgExports: { [TARGET]: { './elements/*': { types: './dist/elements/*.d.ts' } } },
      files: {},
    });

    assert.equal(r.code, 1, ctx('a pattern over a missing directory must fail the guard', r));
    assert.ok(r.out.includes('(pattern matched no file)'), ctx('expected the no-match diagnosis', r));
  });

  test('every match being EMPTY is the unbuilt case — an empty match is unscannable', async () => {
    const r = await run({
      pkgExports: { [TARGET]: { './elements/*': { types: './dist/elements/*.d.ts' } } },
      files: { [`${TARGET}/dist/elements/alpha.d.ts`]: '' },
    });

    assert.equal(r.code, 1, ctx('an all-empty pattern match must fail the guard', r));
    assert.ok(r.out.includes('(pattern matched no file)'), ctx('expected the no-match diagnosis', r));
  });

  test('an empty match is skipped while its non-empty siblings still expand', async () => {
    const r = await run({
      pkgExports: { [TARGET]: { './elements/*': { types: './dist/elements/*.d.ts' } } },
      files: {
        ...PATTERN_TREE.files,
        [`${TARGET}/dist/elements/hollow.d.ts`]: '',
      },
    });

    assert.ok(!r.out.includes(UNBUILT_BANNER), ctx('a partially empty match tree was called unbuilt', r));
    assert.match(
      r.stdout,
      /check:public-types — 3 built entries,/,
      ctx('the 0-byte match was counted as an entry (or a sibling was dropped)', r),
    );
    assert.ok(!r.out.includes('hollow'), ctx('the 0-byte match was scanned', r));
  });

  test('more than one `*` is REFUSED, not silently half-resolved', async () => {
    const r = await run({
      pkgExports: { [TARGET]: { './elements/*': { types: './dist/*/elements/*.d.ts' } } },
      files: { [`${TARGET}/dist/elements/alpha.d.ts`]: fillerDts('Alpha') },
    });

    assert.equal(r.code, 1, ctx('a two-`*` pattern must be refused', r));
    assert.ok(
      r.out.includes('has more than one `*`'),
      ctx('a two-`*` pattern was not refused by name', r),
    );
  });

  test('a `*` that spans directories is REFUSED rather than scanning a subset', async () => {
    // Node's `*` matches across `/`, so `./dist/*.d.ts` with a nested tree
    // resolves files this expansion would not see. Refusing is the only answer
    // that cannot under-report.
    const r = await run({
      pkgExports: { [TARGET]: { './elements/*': { types: './dist/*/index.d.ts' } } },
      files: { [`${TARGET}/dist/elements/index.d.ts`]: fillerDts('Alpha') },
    });

    assert.equal(r.code, 1, ctx('a directory-spanning `*` must be refused', r));
    assert.ok(
      r.out.includes('expands across directories'),
      ctx('a directory-spanning `*` was not refused by name', r),
    );
  });

  test('a plain (non-pattern) target is unchanged: present and non-empty means scanned', async () => {
    const r = await run({
      pkgExports: { [TARGET]: { '.': { types: './dist/index.d.ts' } } },
      files: { [`${TARGET}/dist/index.d.ts`]: fillerDts('Alpha') + PLANTED_VIOLATION_DTS },
    });

    assert.ok(!r.out.includes(UNBUILT_BANNER), ctx('a built plain target was called unbuilt', r));
    assert.match(r.stdout, /check:public-types — 1 built entries,/, ctx('expected 1 plain entry', r));
    assert.ok(
      r.stderr.includes(`${TARGET_NAME}#readBeta :: return-type :: HiddenBeta`),
      ctx('the plain entry was not scanned under its own label', r),
    );
  });

  test('a plain (non-pattern) target is unchanged: missing still means unbuilt', async () => {
    const r = await run({
      pkgExports: { [TARGET]: { '.': { types: './dist/index.d.ts' } } },
      files: {},
    });

    assert.equal(r.code, 1, ctx('a missing plain target must fail the guard', r));
    assert.ok(r.out.includes(UNBUILT_BANNER), ctx('expected the unbuilt banner', r));
    assert.ok(
      r.out.includes(`${TARGET_NAME} -> ./dist/index.d.ts`),
      ctx('the unbuilt report did not name the missing plain target', r),
    );
  });
});
