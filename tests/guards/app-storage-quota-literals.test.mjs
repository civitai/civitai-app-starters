/**
 * Guards the App Storage documentation surface against the OLD, WRONG quota
 * figures coming back.
 *
 * Two separable rules, and only the first is a value ban:
 *
 *   1. `50 MB` / `~1M rows` (and their arithmetic and decimal spellings) must
 *      not appear anywhere in the App Storage surface. Those were the
 *      app-wide umbrella, quoted where the per-(app, viewer) clamp belonged.
 *   2. The runtime must DERIVE its ceilings from the SDK's constants rather
 *      than re-type them — checked structurally, per site, by name, with no
 *      number in the assertion.
 *
 * WHY THIS EXISTS
 * ===============
 * Hand-copied literals across the SDK, the React package, their READMEs, the
 * mock host and a starter harness all agreed with each other and all disagreed
 * with the host. Measured against civitai/civitai `main`
 * (`src/server/routers/apps.router.ts`), the repo said 50 MB / 1,000,000 rows
 * where the host enforces the per-viewer clamp: **25x out on bytes, 1000x out
 * on rows**.
 *
 * The mock host's DEFAULTS carried those same figures, which is what turned a
 * documentation bug into a shipped-block bug — a block that seeded 5,000 rows
 * ran perfectly under `dev:mock`, reported a fraction of a percent of its row
 * budget used, and failed on the 1,001st write in production.
 *
 * 🔴 THIS GUARD DOES NOT BAN THE CURRENT FIGURES, AND MUST NOT.
 * ============================================================
 * An earlier revision banned `2 MiB` / `64 KB` / `2 * 1024 * 1024` as well, on
 * the theory that a second correct copy today is a second wrong copy the day
 * the host re-measures. That was removed, for three reasons:
 *
 *   - It forbids stating a true fact. A comment, a changeset or a migration
 *     note that says what the ceiling actually is has a reader and a purpose,
 *     and a guard that fails such a line teaches people to phrase around it.
 *   - It caught nothing but the diff that introduced it. The drift it
 *     imagines — the host moving and a stale copy surviving — is not something
 *     a text scan can see; only a networked constants-vs-host check can, and
 *     that must not be a required gate (issue #332 asked for exactly that
 *     split: a networked check, plus a one-time grep of the OLD figures).
 *   - Its unanchored arithmetic patterns had measured false positives:
 *     `/2\s*\*\s*1024\s*\*\s*1024/` matched `32 * 1024 * 1024` and
 *     `512 * 1024 * 1024`; `/64\s*\*\s*1024/` matched `164 * 1024`;
 *     `/\b64\s?KB\b/i` matched `a 64 KB chunk`. The scanned tree already
 *     carries `256 KB`, `16MB`, `5 KB` and `73 MB`; those happened not to
 *     collide, which is luck, not design.
 *
 * What stops a re-typed CURRENT figure is rule 2 — the per-site structural
 * checks below — which pins the derivation without naming a number.
 *
 * 🔴 KNOWN LIMITS:
 *   - Text scan; `50 MB` written as `fifty megabytes` walks it.
 *   - SCOPED to the App Storage surface (see SCAN_DIRS / SCAN_FILES), not the
 *     whole repo. Following `tests/guards/doc-cdn-urls.test.mjs`, which scopes
 *     to the four shipped docs that can actually carry the defect. A `50 MB`
 *     pasted into an unrelated package is not this guard's business, and
 *     widening it is how a value ban starts colliding with true statements
 *     about other subsystems. The coverage floor below is what catches the
 *     list going stale.
 *   - It cannot tell whether the SDK's numbers still match the host. Nothing
 *     offline can. Re-run the command in `appStorageLimits.ts` when the host
 *     changes.
 *   - `CHANGELOG.md` is exempt (historical record).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The one file the runtime constants are defined in. */
const SOURCE_OF_TRUTH = 'packages/civitai-app-sdk/src/blocks/appStorageLimits.ts';

/** The exported names every other site must use instead of a literal. */
const EXPORTED_CONSTANTS = [
  'APP_STORAGE_MAX_VALUE_BYTES',
  'APP_STORAGE_MAX_BYTES',
  'APP_STORAGE_MAX_ROWS',
];

/**
 * The App Storage surface: the contract, the hook and its mock, and the one
 * example built on them. These are the files that documented the wrong figures
 * and the files a reader reaches for.
 *
 * `SOURCE_OF_TRUTH` is deliberately NOT excluded. It spells the CURRENT
 * ceilings, which are not banned; it must not spell the old ones either, since
 * the app-wide umbrella is deliberately left unwritten there.
 */
const SCAN_DIRS = [
  'packages/civitai-app-sdk/src/blocks',
  'packages/civitai-blocks-react',
  'starters/examples/kv-storage',
];

/** Shipped docs outside those trees that still describe App Storage. */
const SCAN_FILES = ['packages/civitai-app-sdk/README.md', 'starters/examples/README.md'];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.direnv',
  '.turbo',
  'coverage',
  '.next',
  '.svelte-kit',
  '.vite',
]);

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.svelte'];
const EXEMPT_BASENAMES = new Set(['CHANGELOG.md']);

/**
 * Coverage floor. 192 files match today across SCAN_DIRS + SCAN_FILES (down
 * from 453 when the scan was `packages/ starters/ docs/`). An
 * unasserted count is indistinguishable from a walker wired to nothing: a
 * directory renamed out from under `SCAN_DIRS` would otherwise read as a PASS.
 * Well below the real count on purpose — this catches a collapse, not drift.
 */
const MIN_SCANNED_FILES = 120;

/**
 * The old, wrong figures — the app-wide umbrella the docs used to quote.
 *
 * 🔴 EVERY PATTERN IS ANCHORED ON BOTH SIDES so it cannot match inside a larger
 * number. `(?<![\w.])` keeps `150 MB` and `11,000,000` out; the trailing
 * `(?![\d_])` / `\b` keeps `52428800`-as-a-prefix out. The predecessor's
 * unanchored arithmetic is the measured bug this ban is narrowed to avoid.
 */
const BANNED_FIGURES = [
  { pattern: /(?<![\w.])50\s?MB\b/i, why: 'the old app-wide byte umbrella' },
  { pattern: /(?<![\w.])50\s?MiB\b/i, why: 'the old app-wide byte umbrella' },
  {
    pattern: /(?<![\w.])50\s*\*\s*1024\s*\*\s*1024(?![\d_])/,
    why: 'the old app-wide byte umbrella',
  },
  { pattern: /(?<![\w.])52428800(?![\d_])/, why: 'the old app-wide byte umbrella' },
  { pattern: /(?<![\d,])1,000,000(?![\d,])/, why: 'the old app-wide row umbrella' },
  { pattern: /(?<![\w.])1_000_000(?![\d_])/, why: 'the old app-wide row umbrella' },
  { pattern: /(?<![\w.])1M\s?rows\b/i, why: 'the old app-wide row umbrella' },
];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXEMPT_BASENAMES.has(entry.name)) continue;
    if (!SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    out.push(full);
  }
  return out;
}

function scannableFiles() {
  const out = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(REPO_ROOT, dir);
    // statSync THROWS on a missing directory, on purpose: a tree renamed out
    // from under this list must fail the guard, never silently shrink it.
    assert.ok(statSync(abs).isDirectory(), `${dir} is not a directory`);
    walk(abs, out);
  }
  for (const file of SCAN_FILES) {
    const abs = join(REPO_ROOT, file);
    assert.ok(statSync(abs).isFile(), `${file} is not a file`);
    out.push(abs);
  }
  return [...new Set(out)].sort();
}

/** Every banned figure in `text`, as `{ line, figure, why }`. Pure. */
export function findQuotaLiterals(text) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { pattern, why } of BANNED_FIGURES) {
      const hit = line.match(pattern);
      if (!hit) continue;
      findings.push({ line: i + 1, figure: hit[0], why, excerpt: line.trim().slice(0, 140) });
      break;
    }
  });
  return findings;
}

test('POSITIVE CONTROL — the matcher fires on every figure it claims to catch', () => {
  // One per banned form, in the shape it actually appeared in. A zero from the
  // real scan below is worthless unless each of these produces non-zero.
  const shouldFlag = {
    'README prose': '- **50 MB** + **~1M rows** per app',
    'JSDoc prose, no space': ' * 64 KB per value, 50MB per app.',
    'MiB spelling': 'the per-app umbrella is 50 MiB',
    'mock host arithmetic': 'const DEFAULT_STORAGE_QUOTA_BYTES = 50 * 1024 * 1024;',
    'decimal byte count': 'expect(q.limitBytes).toBe(52428800);',
    'row literal': 'const DEFAULT_STORAGE_LIMIT_ROWS = 1_000_000;',
    'comma-formatted rows': '/** Simulated row ceiling reported by `getQuota`. Default 1,000,000. */',
  };
  for (const [label, line] of Object.entries(shouldFlag)) {
    assert.ok(
      findQuotaLiterals(line).length > 0,
      `matcher did not fire on ${label} — it is wired to nothing:\n  ${line}`,
    );
  }
});

test('NEGATIVE CONTROL — constant references, the CURRENT figures, and unrelated numbers are fine', () => {
  const shouldNotFlag = {
    // --- the current, correct figures. Stating a true fact is allowed. ---
    'the current byte clamp in prose': 'the host enforces a 2 MiB per-viewer quota',
    'the current byte clamp as arithmetic': 'export const APP_STORAGE_MAX_BYTES = 2 * 1024 * 1024;',
    'the current byte clamp as a decimal': 'expect(q.limitBytes).toBe(2097152);',
    'the per-value cap in prose': 'rejects when the value exceeds 64KB',
    'the per-value cap as arithmetic': 'export const APP_STORAGE_MAX_VALUE_BYTES = 64 * 1024;',
    'the current row clamp': 'export const APP_STORAGE_MAX_ROWS = 1_000;',

    // --- MEASURED false positives of the predecessor's unanchored patterns.
    //     Each of these matched before the arithmetic was anchored. ---
    'FP: a larger byte multiple': 'const CACHE_CEILING = 32 * 1024 * 1024;',
    'FP: a much larger byte multiple': 'const DISK_BUDGET = 512 * 1024 * 1024;',
    'FP: a larger KB multiple': 'const CHUNK = 164 * 1024;',
    'FP: an unrelated KB figure in prose': 'the uploader streams in 64 KB chunks',

    // --- near-misses of the SURVIVING (old-figure) patterns. Each differs
    //     from a banned form only by a leading digit or a decimal point. ---
    'near-miss: 150 MB': 'a 150 MB model file downloads in about a minute',
    'near-miss: 2.50 MB': 'the payload settled at 2.50 MB',
    'near-miss: 11,000,000': 'the table holds 11,000,000 rows today',
    'near-miss: 11M rows': 'the shared index is 11M rows',
    'near-miss: 51_000_000': 'const WEIRD = 51_000_000;',
    'near-miss: 152428800': 'const OTHER = 152428800;',
    'near-miss: 250 * 1024 * 1024': 'const BIG = 250 * 1024 * 1024;',
    'near-miss: 52428800 with a trailing digit': 'const NOT_IT = 524288000;',

    // --- ordinary references ---
    'a constant reference': 'const QUOTA_BYTES = APP_STORAGE_MAX_BYTES;',
    'a quota read from the host': 'expect(q.limitBytes).toBe(APP_STORAGE_MAX_BYTES);',
    'prose naming the constant': 'Ceilings: `APP_STORAGE_MAX_ROWS` per (app, viewer).',
    'an unrelated interval': 'const INIT_RETRY_INTERVAL_MS = 400;',
    'an unrelated size': 'a 10 MB upload ceiling applies to images',
    'a synthetic test fixture': 'limitRows: 4_321,',
  };
  for (const [label, line] of Object.entries(shouldNotFlag)) {
    assert.deepEqual(
      findQuotaLiterals(line),
      [],
      `matcher over-reported on ${label}: ${line}`,
    );
  }
});

test('COVERAGE FLOOR — the scan reaches a real tree', () => {
  const scanned = scannableFiles().map((f) => relative(REPO_ROOT, f));
  assert.ok(
    scanned.length >= MIN_SCANNED_FILES,
    `walk found only ${scanned.length} files (floor ${MIN_SCANNED_FILES}) — it is not reaching the tree`,
  );
  // The source of truth is IN the scan, not excluded: it must not spell the
  // old umbrella either, and including it is what keeps the exclusion from
  // being a hole nobody checks.
  assert.ok(
    scanned.includes(SOURCE_OF_TRUTH),
    `${SOURCE_OF_TRUTH} is not reached by the scan — narrow SCAN_DIRS carefully`,
  );
});

test('the source of truth exports the constants', () => {
  const src = readFileSync(join(REPO_ROOT, SOURCE_OF_TRUTH), 'utf8');
  for (const name of EXPORTED_CONSTANTS) {
    assert.ok(
      new RegExp(`export const ${name}\\b`).test(src),
      `${SOURCE_OF_TRUTH} does not export ${name}`,
    );
  }
});

test('the SDK re-exports the constants from `@civitai/app-sdk/blocks`', () => {
  // A constant nobody can import is not a single source of truth, it is a
  // private note — the starters and the mock host reach these through the
  // package entry point, not the file path.
  const index = readFileSync(join(REPO_ROOT, 'packages/civitai-app-sdk/src/blocks/index.ts'), 'utf8');
  for (const name of EXPORTED_CONSTANTS) {
    assert.ok(index.includes(name), `blocks/index.ts does not re-export ${name}`);
  }
});

test('the mock host DERIVES its storage defaults from the constants', () => {
  // The behavioural half — that the defaults are the production ceilings and
  // that BOTH gates are enforced on write — is pinned by
  // `packages/civitai-blocks-react/test/mockHostScenarios.test.tsx`. This
  // asserts the structural half: no arithmetic, no literal, no drift surface.
  // It is also what replaces the removed ban on the CURRENT figures — it pins
  // the derivation at the site that matters without naming a number.
  const rel = 'packages/civitai-blocks-react/src/internal/mockHost.ts';
  const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
  for (const [name, constant] of [
    ['DEFAULT_STORAGE_QUOTA_BYTES', 'APP_STORAGE_MAX_BYTES'],
    ['DEFAULT_STORAGE_VALUE_CAP_BYTES', 'APP_STORAGE_MAX_VALUE_BYTES'],
    ['DEFAULT_STORAGE_LIMIT_ROWS', 'APP_STORAGE_MAX_ROWS'],
  ]) {
    assert.ok(
      new RegExp(`const ${name} = ${constant};`).test(src),
      `${rel}: ${name} must be assigned directly from ${constant}, not re-derived`,
    );
  }
});

test("the kv-storage harness DERIVES its ceilings from the constants", () => {
  // The other runtime that used to carry hand-copied literals. Same structural
  // shape, same reason: it is a place a reader copies from.
  const rel = 'starters/examples/kv-storage/src/Harness.tsx';
  const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
  for (const [name, constant] of [
    ['PER_VALUE_CAP', 'APP_STORAGE_MAX_VALUE_BYTES'],
    ['QUOTA_BYTES', 'APP_STORAGE_MAX_BYTES'],
    ['QUOTA_ROWS', 'APP_STORAGE_MAX_ROWS'],
  ]) {
    assert.ok(
      new RegExp(`const ${name} = ${constant};`).test(src),
      `${rel}: ${name} must be assigned directly from ${constant}, not re-derived`,
    );
  }
});

test('no file in the App Storage surface spells an OLD App Storage ceiling', () => {
  const offenders = [];
  for (const file of scannableFiles()) {
    for (const finding of findQuotaLiterals(readFileSync(file, 'utf8'))) {
      offenders.push(
        `${relative(REPO_ROOT, file)}:${finding.line} — "${finding.figure}" (${finding.why})\n      ${finding.excerpt}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `An OLD App Storage ceiling (the app-wide umbrella) is written down in the App Storage surface.\n` +
      `Those figures are 25x out on bytes and 1000x out on rows against what the host enforces\n` +
      `per (app, viewer). Use ${EXPORTED_CONSTANTS.join(' / ')} from \`@civitai/app-sdk/blocks\`,\n` +
      `or — for anything a viewer sees — render \`getQuota()\`'s reply, which is the authority.\n\n` +
      `    ${offenders.join('\n    ')}\n`,
  );
});
