/**
 * Guards the App Storage ceilings against being written down twice.
 *
 * Rule: the numbers live in exactly ONE file —
 * `packages/civitai-app-sdk/src/blocks/appStorageLimits.ts` — and everything
 * else references the exported constants. No prose figure, no re-typed
 * arithmetic, no "50 MB" in a README.
 *
 * WHY THIS EXISTS
 * ===============
 * Seven hand-copied literals across the SDK, the React package, their READMEs,
 * the mock host and a starter harness all agreed with each other and all
 * disagreed with the host — quoting the app-wide umbrella instead of the
 * per-(app, viewer) clamp the host actually enforces. Measured against
 * civitai/civitai `main` (`src/server/routers/apps.router.ts`), the repo said
 * 50 MB / 1,000,000 rows where the host enforces 2 MiB / 1,000: **25x on
 * bytes, 1000x on rows**.
 *
 * The mock host's DEFAULTS carried those same figures, which is what turned a
 * documentation bug into a shipped-block bug — a block that seeded 5,000 rows
 * ran perfectly under `dev:mock`, reported 0.5% of its row budget used, and
 * failed on the 1,001st write in production.
 *
 * 🔴 THE GUARD DELIBERATELY DOES NOT RE-ASSERT THE VALUES. Pinning "2 MiB" in
 * a test would be a SECOND place the number lives — the exact defect being
 * fixed, wearing a test's clothes. Their correctness is a human-verified fact
 * recorded at the definition site together with its provenance (the host file,
 * the date, the blob sha) and a one-line `gh api` command that re-derives it.
 * What a machine CAN check, and what this file checks, is that there is only
 * one such place and that the runtime actually reads from it.
 *
 * 🔴 KNOWN LIMITS:
 *   - Text scan; `50 MB` written as `fifty megabytes` walks it. It catches the
 *     forms that actually rotted plus the current values, which is what stops
 *     the fix from being un-done by a copy-paste.
 *   - It cannot tell whether the SDK's numbers still match the host. Nothing
 *     offline can. Re-run the command in `appStorageLimits.ts` when the host
 *     changes; the check that WOULD settle it automatically is a networked job
 *     against civitai/civitai, which must not be a required gate.
 *   - `CHANGELOG.md` is exempt (historical record).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The one file allowed to spell the numbers. */
const SOURCE_OF_TRUTH = 'packages/civitai-app-sdk/src/blocks/appStorageLimits.ts';

/** The exported names every other site must use instead. */
const EXPORTED_CONSTANTS = [
  'APP_STORAGE_MAX_VALUE_BYTES',
  'APP_STORAGE_MAX_BYTES',
  'APP_STORAGE_MAX_ROWS',
];

const ROOTS = ['packages', 'starters', 'docs'];

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
 * Figures that must not appear outside the source of truth.
 *
 * TWO groups, and both are load-bearing:
 *
 *   - THE OLD WRONG ONES, so the 25x / 1000x error cannot be pasted back in.
 *   - THE CURRENT RIGHT ONES, so the fix cannot be un-done by someone
 *     "helpfully" inlining the value they just read off the constant. A second
 *     correct copy today is a second wrong copy the day the host moves — which
 *     the host's own comment says to expect, since the clamp was sized against
 *     a measured distribution and will be re-measured.
 */
const BANNED_FIGURES = [
  // --- the old, wrong figures (the app-wide umbrella) ---
  { pattern: /\b50\s?MB\b/i, why: 'the old app-wide byte umbrella' },
  { pattern: /\b50\s?MiB\b/i, why: 'the old app-wide byte umbrella' },
  { pattern: /50\s*\*\s*1024\s*\*\s*1024/, why: 'the old app-wide byte umbrella' },
  { pattern: /\b52428800\b/, why: 'the old app-wide byte umbrella' },
  { pattern: /1,000,000/, why: 'the old app-wide row umbrella' },
  { pattern: /\b1_000_000\b/, why: 'the old app-wide row umbrella' },
  { pattern: /~?\s*1M rows/i, why: 'the old app-wide row umbrella' },
  // --- the current, correct figures: right today, a second copy forever ---
  { pattern: /\b2\s?MiB\b/i, why: 'the current per-viewer byte clamp' },
  { pattern: /2\s*\*\s*1024\s*\*\s*1024/, why: 'the current per-viewer byte clamp' },
  { pattern: /\b2097152\b/, why: 'the current per-viewer byte clamp' },
  { pattern: /\b64\s?KB\b/i, why: 'the per-value cap' },
  { pattern: /64\s*\*\s*1024/, why: 'the per-value cap' },
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
  for (const root of ROOTS) {
    const abs = join(REPO_ROOT, root);
    try {
      if (!statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(abs, out);
  }
  return out.filter((f) => relative(REPO_ROOT, f) !== SOURCE_OF_TRUTH).sort();
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
    'JSDoc prose': ' * 64 KB per value, 50 MB + ~1M rows per app.',
    'mock host arithmetic': 'const DEFAULT_STORAGE_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB per app',
    'row literal': 'const DEFAULT_STORAGE_LIMIT_ROWS = 1_000_000;',
    'comma-formatted rows': '/** Simulated row ceiling reported by `getQuota`. Default 1,000,000. */',
    'the NEW byte value re-typed': 'const QUOTA_BYTES = 2 * 1024 * 1024;',
    'the NEW byte value in prose': 'the host enforces a 2 MiB per-viewer quota',
    'byte count': 'expect(q.limitBytes).toBe(2097152);',
    'per-value cap prose': 'rejects when the value exceeds 64KB',
  };
  for (const [label, line] of Object.entries(shouldFlag)) {
    assert.ok(
      findQuotaLiterals(line).length > 0,
      `matcher did not fire on ${label} — it is wired to nothing:\n  ${line}`,
    );
  }
});

test('NEGATIVE CONTROL — constant references and unrelated numbers are fine', () => {
  const shouldNotFlag = {
    'a constant reference': 'const QUOTA_BYTES = APP_STORAGE_MAX_BYTES;',
    'a quota read from the host': 'expect(q.limitBytes).toBe(APP_STORAGE_MAX_BYTES);',
    'prose naming the constant': 'Ceilings: `APP_STORAGE_MAX_ROWS` per (app, viewer).',
    'an unrelated 1000': 'const INIT_RETRY_INTERVAL_MS = 400;',
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

test('COVERAGE FLOOR — the source of truth exists, exports the constants, and is the file excluded', () => {
  const src = readFileSync(join(REPO_ROOT, SOURCE_OF_TRUTH), 'utf8');
  for (const name of EXPORTED_CONSTANTS) {
    assert.ok(
      new RegExp(`export const ${name}\\b`).test(src),
      `${SOURCE_OF_TRUTH} does not export ${name}`,
    );
  }
  // It must actually CONTAIN figures — otherwise excluding it proves nothing
  // and the numbers have quietly moved somewhere this guard cannot see.
  assert.ok(
    findQuotaLiterals(src).length > 0,
    `${SOURCE_OF_TRUTH} contains none of the guarded figures — the single source of truth is empty, ` +
      `so excluding it from the scan below is vacuous`,
  );
  // And it must be excluded, or the scan can never pass.
  const scanned = scannableFiles().map((f) => relative(REPO_ROOT, f));
  assert.ok(!scanned.includes(SOURCE_OF_TRUTH), 'the source of truth is not excluded from the scan');
  assert.ok(scanned.length > 50, `walk found only ${scanned.length} files — it is not reaching the tree`);
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
  // that BOTH are enforced on write — is pinned by
  // `packages/civitai-blocks-react/test/mockHostScenarios.test.tsx`. This
  // asserts the structural half: no arithmetic, no literal, no drift surface.
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

test('no file outside the source of truth spells an App Storage ceiling', () => {
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
    `An App Storage ceiling is written down outside ${SOURCE_OF_TRUTH}.\n` +
      `Import the constant instead — ${EXPORTED_CONSTANTS.join(' / ')} from\n` +
      `\`@civitai/app-sdk/blocks\` — or, for a viewer-facing readout, render\n` +
      `\`getQuota()\`'s reply. Hand-copied figures are how the docs came to be 25x out\n` +
      `on bytes and 1000x out on rows while agreeing with each other.\n\n` +
      `    ${offenders.join('\n    ')}\n`,
  );
});
