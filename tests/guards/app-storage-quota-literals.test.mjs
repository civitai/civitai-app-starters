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
 * 🔴 THE SCAN IS SCOPED TO THE APP-STORAGE SURFACE, AND THAT IS THE POINT.
 * ======================================================================
 * An earlier revision scanned the WHOLE of `packages/civitai-blocks-react`.
 * The banned numbers are the live ceilings of the neighbouring SHARED storage
 * feature — upstream `apps-shared.router.ts` has `APP_QUOTA_BYTES = 50 * 1024 *
 * 1024` and `APP_ROW_LIMIT = 1_000_000` — and `useSharedStorage()` is
 * documented in the same README. So the ban collided with TRUE statements
 * inside its own scan, each of which failed the required `Starter` job in all
 * five matrix legs. The four measured collisions are the negative controls in
 * `NEGATIVE CONTROL — statements about NEIGHBOURING subsystems`:
 *
 *   - `Shared storage… the host allows 50 MB and 1,000,000 rows per app.`
 *   - `A whale account may hold 1,000,000 Buzz.`
 *   - `useImageUpload() accepts files up to 50 MB.`
 *   - `export const MAX_FRAME_BYTES = 50 * 1024 * 1024;`
 *
 * Three mechanisms keep those out without weakening the ban:
 *   1. CODE is scanned per FILE, by name (`SCAN_FILES` + the wholly-App-Storage
 *      `SCAN_DIRS`). `internal/iframeTransport.ts` is simply not in the list.
 *   2. MARKDOWN is scanned per REGION, never whole-file: only sections whose
 *      heading names App Storage, plus individual lines that name an
 *      App-Storage anchor themselves (so a one-row table entry still counts).
 *      `### useSharedStorage()` and `### useImageUpload()` are other sections
 *      of the same file and are not read.
 *   3. A per-line OPT-OUT (`ALLOW_MARKER`) for a true statement that genuinely
 *      belongs on an in-scope line. Explicit, greppable, and itself controlled.
 *
 * 🔴 KNOWN LIMITS:
 *   - Text scan; `50 MB` written as `fifty megabytes` walks it.
 *   - Scoped as above, not the whole repo. Following
 *     `tests/guards/doc-cdn-urls.test.mjs`, which scopes to the four shipped
 *     docs that can actually carry the defect. The coverage assertions below —
 *     a byte floor, a required file, and a NON-EMPTY region per markdown entry
 *     — are what catch the list going stale, because a scan narrowed to
 *     nothing reads as a PASS.
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
 * Trees that are wholly about App Storage, scanned in full.
 *
 * `starters/examples/kv-storage` is the one example built on the hook — every
 * file in it, its README included, is App-Storage material.
 */
const SCAN_DIRS = ['starters/examples/kv-storage'];

/**
 * CODE files that carry the ceilings, scanned in full and named individually.
 *
 * 🔴 NAMED, NOT A DIRECTORY GLOB. `packages/civitai-blocks-react` as a whole
 * carries other subsystems whose true ceilings are the banned numbers (the
 * iframe frame cap, the shared-storage app-wide quota, Buzz figures); a value
 * ban over the package fails those true statements. See the header.
 *
 * `SOURCE_OF_TRUTH` is deliberately INCLUDED. It spells the CURRENT ceilings,
 * which are not banned; it must not spell the old ones either, since the
 * app-wide umbrella is deliberately left unwritten there.
 */
const SCAN_FILES = [
  SOURCE_OF_TRUTH,
  'packages/civitai-app-sdk/src/blocks/messages.ts',
  'packages/civitai-blocks-react/src/hooks/useAppStorage.ts',
  'packages/civitai-blocks-react/src/internal/mockHost.ts',
  'packages/civitai-blocks-react/src/internal/liveHost.ts',
];

/**
 * MARKDOWN that describes App Storage among OTHER things. Scanned per region,
 * never whole-file — see `appStorageRegionOf`.
 *
 * Each entry must yield a non-empty region containing `anchor`; a region that
 * goes empty is a scan narrowed to nothing, which reads as a PASS.
 */
const SCAN_MARKDOWN = [
  { file: 'packages/civitai-blocks-react/README.md', anchor: 'APP_STORAGE_MAX_ROWS' },
  { file: 'packages/civitai-app-sdk/README.md', anchor: 'APP_STORAGE_' },
  { file: 'starters/examples/README.md', anchor: 'kv-storage' },
];

/**
 * A heading that opens an App-Storage section, or a line that names App
 * Storage on its own. Both readings are needed: the blocks-react README has a
 * `### useAppStorage()` SECTION, while `starters/examples/README.md` mentions
 * the feature only in one row of a table under a generic heading.
 */
const APP_STORAGE_ANCHOR = /useAppStorage|APP_STORAGE|kv-storage|App Storage/i;

/**
 * Per-line opt-out for a true statement that genuinely belongs on an in-scope
 * line. Deliberately verbose and greppable: `git grep` it to audit every use.
 */
const ALLOW_MARKER = 'app-storage-quota-guard: allow';

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
 * Coverage floor, in CHARACTERS of text actually read — not files.
 *
 * The scan is now a short explicit list plus markdown REGIONS, so a file count
 * says almost nothing: a region narrowed to one line still counts as a file.
 * 340,718 characters are read today. An unasserted size is indistinguishable
 * from a scan wired to nothing — a heading reworded out from under the region
 * matcher would otherwise read as a PASS. Well below the real figure on
 * purpose: this catches a collapse, not drift.
 *
 * 🔴 IT DOES NOT CATCH A LIST THAT SHRINKS. Three files carry 300k of the
 * 340k, so dropping any one of the others leaves the floor satisfied. That is
 * what `EXPECTED_SCAN_UNITS` is for: an asserted ledger that fails when the
 * scanned set GROWS or SHRINKS, which a size threshold structurally cannot do.
 */
const MIN_SCANNED_CHARS = 80_000;

/**
 * The exact set the scan reads, as an asserted ledger. Editing the scope is
 * fine — editing it SILENTLY is the failure this closes, since a narrower scan
 * reports fewer offenders and reads as a pass. Change this list in the same
 * commit as the list above, deliberately.
 */
const EXPECTED_SCAN_UNITS = [
  'packages/civitai-app-sdk/README.md',
  'packages/civitai-app-sdk/src/blocks/appStorageLimits.ts',
  'packages/civitai-app-sdk/src/blocks/messages.ts',
  'packages/civitai-blocks-react/README.md',
  'packages/civitai-blocks-react/src/hooks/useAppStorage.ts',
  'packages/civitai-blocks-react/src/internal/liveHost.ts',
  'packages/civitai-blocks-react/src/internal/mockHost.ts',
  'starters/examples/README.md',
  'starters/examples/kv-storage/README.md',
  'starters/examples/kv-storage/src/App.tsx',
  'starters/examples/kv-storage/src/Harness.tsx',
  'starters/examples/kv-storage/src/main.tsx',
  // #330 briefly added a per-scaffold `vite-plugin-block-manifest.ts` here. It
  // is gone again — the gate now ships from `@civitai/app-sdk/vite`, so there
  // are no per-scaffold copies to scan.
  'starters/examples/kv-storage/vite.config.ts',
];

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

/**
 * The App-Storage REGION of a markdown document, as `{ line, text }` rows
 * carrying the ORIGINAL 1-based line numbers so an offender still points at a
 * real place in the file.
 *
 * Two ways a line gets in, and both are needed:
 *   - it sits under an ATX heading (`#`..`######`) that names App Storage —
 *     this is what pulls in the whole `### useAppStorage()` prose block, and
 *     what STOPS at the next heading, leaving `### useSharedStorage()` and
 *     `### useImageUpload()` out;
 *   - or the line names App Storage itself — this is what catches the one row
 *     of a table in `starters/examples/README.md`, which sits under a heading
 *     that names nothing.
 *
 * Fenced code blocks inherit their enclosing section: a ``` fence inside the
 * App-Storage section is part of it, and a fence in another section is not.
 * Pure — takes text, returns rows.
 */
export function appStorageRegionOf(markdown) {
  const rows = [];
  let inSection = false;
  markdown.split('\n').forEach((line, i) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) inSection = APP_STORAGE_ANCHOR.test(heading[1]);
    if (inSection || APP_STORAGE_ANCHOR.test(line)) rows.push({ line: i + 1, text: line });
  });
  return rows;
}

/** Every banned figure in `text`, as `{ line, figure, why }`. Pure. */
export function findQuotaLiterals(text) {
  return findQuotaLiteralsInRows(
    text.split('\n').map((line, i) => ({ line: i + 1, text: line })),
  );
}

/**
 * The same matcher over pre-selected rows, so a markdown REGION and a whole
 * code file go through one code path. The per-line opt-out is applied here —
 * once — rather than at each call site.
 */
export function findQuotaLiteralsInRows(rows) {
  const findings = [];
  for (const { line, text } of rows) {
    if (text.includes(ALLOW_MARKER)) continue;
    for (const { pattern, why } of BANNED_FIGURES) {
      const hit = text.match(pattern);
      if (!hit) continue;
      findings.push({ line, figure: hit[0], why, excerpt: text.trim().slice(0, 140) });
      break;
    }
  }
  return findings;
}

/**
 * Everything the guard actually reads, as `{ rel, rows }`. ONE definition, used
 * by both the offender sweep and the coverage assertions — so the size the
 * coverage test vouches for is the size the sweep saw, not a second estimate.
 */
export function scanUnits() {
  const units = scannableFiles().map((abs) => ({
    rel: relative(REPO_ROOT, abs),
    rows: readFileSync(abs, 'utf8')
      .split('\n')
      .map((text, i) => ({ line: i + 1, text })),
  }));
  for (const { file } of SCAN_MARKDOWN) {
    const abs = join(REPO_ROOT, file);
    assert.ok(statSync(abs).isFile(), `${file} is not a file`);
    units.push({ rel: file, rows: appStorageRegionOf(readFileSync(abs, 'utf8')) });
  }
  return units;
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

/**
 * The four MEASURED false positives of the previous, package-wide scan. Each
 * is a TRUE statement about a neighbouring subsystem; each failed the required
 * `Starter` job in all five matrix legs.
 *
 * `where` is the realistic home of the statement, and the assertion is a PAIR:
 * the matcher must still fire on the line (so a green cannot mean the matcher
 * broke) while the SCOPE must keep it out of the sweep.
 */
const NEIGHBOUR_TRUE_STATEMENTS = [
  {
    label: 'shared storage quoting its own real app-wide ceilings',
    line: 'Shared storage is app-scoped, not per-viewer: the host allows 50 MB and 1,000,000 rows per app.',
    section: 'useSharedStorage',
  },
  {
    label: 'a Buzz figure',
    line: 'A whale account may hold 1,000,000 Buzz.',
    section: 'useBuzzBalance',
  },
  {
    label: "the image uploader's own cap",
    line: '`useImageUpload()` accepts files up to 50 MB.',
    section: 'useImageUpload',
  },
];

/** The same, in CODE rather than prose — the iframe transport's frame cap. */
const NEIGHBOUR_TRUE_CODE = {
  label: 'the iframe transport frame cap',
  line: 'export const MAX_FRAME_BYTES = 50 * 1024 * 1024;',
  file: 'packages/civitai-blocks-react/src/internal/iframeTransport.ts',
};

test('NEGATIVE CONTROL — statements about NEIGHBOURING subsystems do not fail the guard', () => {
  const rel = 'packages/civitai-blocks-react/README.md';
  const original = readFileSync(join(REPO_ROOT, rel), 'utf8').split('\n');

  for (const { label, line, section } of NEIGHBOUR_TRUE_STATEMENTS) {
    // 1. The matcher DOES fire on the line. Without this, the zero below is
    //    indistinguishable from a matcher that stopped working.
    assert.ok(
      findQuotaLiterals(line).length > 0,
      `the matcher does not fire on ${label} — this control is vouching for nothing:\n  ${line}`,
    );

    // 2. Put it where it would really live — the body of that hook's section
    //    of the same README the App-Storage docs live in.
    const at = original.findIndex((l) => new RegExp(`^#{1,6}\\s+.*${section}`).test(l));
    assert.ok(at >= 0, `the README no longer has a ${section} section to place ${label} in`);
    const mutated = [...original];
    mutated.splice(at + 2, 0, line);

    // 3. Assert about THE INJECTED LINE, not about the whole file. Asserting an
    //    empty result would also fail on any genuine offender elsewhere in the
    //    README — the control would then die for a reason that has nothing to
    //    do with scoping, and read as a scoping regression.
    const findings = findQuotaLiteralsInRows(appStorageRegionOf(mutated.join('\n')));
    assert.ok(
      !findings.some((f) => f.excerpt === line.trim()),
      `${label} was reported even though it sits in the ${section} section, not App Storage.\n` +
        `That statement is TRUE, and failing it teaches people to phrase around the guard.`,
    );
  }
});

test('NEGATIVE CONTROL — a neighbouring CODE file is out of scope, and known to be', () => {
  const { label, line, file } = NEIGHBOUR_TRUE_CODE;
  assert.ok(findQuotaLiterals(line).length > 0, `the matcher does not fire on ${label}`);
  assert.ok(statSync(join(REPO_ROOT, file)).isFile(), `${file} no longer exists — re-pick the control`);
  const scanned = new Set(scanUnits().map((u) => u.rel));
  assert.ok(
    !scanned.has(file),
    `${file} is being scanned. It is another subsystem's runtime; ${label} is a true statement\n` +
      `there, and a value ban over it fails the build for saying so.`,
  );
  // And the guard is not merely excluding everything: the file it MUST read is read.
  assert.ok(scanned.has('packages/civitai-blocks-react/src/internal/mockHost.ts'));
});

test('NEGATIVE CONTROL — the per-line opt-out works, and only on the line carrying it', () => {
  const rows = [
    { line: 1, text: `const SHARED_APP_QUOTA = 50 * 1024 * 1024; // ${ALLOW_MARKER} — upstream figure` },
    { line: 2, text: 'const NOT_EXEMPT = 50 * 1024 * 1024;' },
  ];
  assert.deepEqual(
    findQuotaLiteralsInRows(rows).map((f) => f.line),
    [2],
    'the opt-out must exempt exactly its own line, and nothing else',
  );
});

test('COVERAGE FLOOR — the scan reaches a real tree', () => {
  const units = scanUnits();
  const chars = units.reduce((n, u) => n + u.rows.reduce((m, r) => m + r.text.length + 1, 0), 0);
  assert.ok(
    chars >= MIN_SCANNED_CHARS,
    `the scan read only ${chars} characters (floor ${MIN_SCANNED_CHARS}) — it is not reaching the\n` +
      `tree. A scan narrowed to nothing reports zero offenders, which reads as a PASS.`,
  );
  // The source of truth is IN the scan, not excluded: it must not spell the
  // old umbrella either, and including it is what keeps the exclusion from
  // being a hole nobody checks.
  assert.ok(
    units.some((u) => u.rel === SOURCE_OF_TRUTH),
    `${SOURCE_OF_TRUTH} is not reached by the scan — narrow SCAN_FILES carefully`,
  );
  assert.deepEqual(
    units.map((u) => u.rel).sort(),
    [...EXPECTED_SCAN_UNITS].sort(),
    `The scanned set changed. Fewer files means fewer offenders and a green that means nothing;\n` +
      `more files means the value ban has started reading another subsystem's true statements.\n` +
      `Update EXPECTED_SCAN_UNITS in the same commit as SCAN_FILES / SCAN_DIRS / SCAN_MARKDOWN.`,
  );
});

test('COVERAGE FLOOR — every markdown entry yields a NON-EMPTY App-Storage region', () => {
  // The region matcher is the half most likely to silently stop matching: a
  // reworded heading, a renamed hook, a table rebuilt without the word. An
  // empty region reports zero offenders and reads as a pass, so each entry has
  // to prove it still sees its own anchor.
  for (const { file, anchor } of SCAN_MARKDOWN) {
    const rows = appStorageRegionOf(readFileSync(join(REPO_ROOT, file), 'utf8'));
    assert.ok(rows.length > 0, `${file}: the App-Storage region is EMPTY — nothing is being scanned`);
    assert.ok(
      rows.some((r) => r.text.includes(anchor)),
      `${file}: the App-Storage region no longer contains "${anchor}". Either the doc moved or\n` +
        `APP_STORAGE_ANCHOR stopped matching its heading — in both cases the scan is now blind.`,
    );
  }
});

test('REGION SCOPING — a neighbouring section of the same document is NOT scanned', () => {
  // The mechanism, on the real file rather than a fixture: the blocks-react
  // README documents App Storage and Shared storage as sibling `###` sections,
  // and the banned numbers are Shared storage's TRUE ceilings.
  const readme = readFileSync(
    join(REPO_ROOT, 'packages/civitai-blocks-react/README.md'),
    'utf8',
  );
  const region = new Set(appStorageRegionOf(readme).map((r) => r.line));
  const lines = readme.split('\n');

  const appStorageHeading = lines.findIndex((l) => /^#{1,6}\s+.*useAppStorage/.test(l));
  const sharedHeading = lines.findIndex((l) => /^#{1,6}\s+.*useSharedStorage/.test(l));
  assert.ok(appStorageHeading >= 0, 'the README no longer has a useAppStorage() section');
  assert.ok(sharedHeading > appStorageHeading, 'the README no longer has a useSharedStorage() section');

  assert.ok(region.has(appStorageHeading + 2), 'the line after the useAppStorage() heading is not scanned');
  // The body of the shared-storage section. Skip the heading itself and the
  // `Sibling of useAppStorage` line, which names the anchor and is in-region by
  // the line rule — deliberately, since a line that says "App Storage" is this
  // guard's business wherever it sits.
  const sharedBody = lines
    .map((text, i) => ({ line: i + 1, text }))
    .slice(sharedHeading + 1)
    .filter((r) => !APP_STORAGE_ANCHOR.test(r.text) && !/^#{1,6}\s/.test(r.text))
    .slice(0, 12);
  assert.ok(sharedBody.length > 5, 'could not find enough useSharedStorage() body lines to check');
  for (const row of sharedBody) {
    assert.ok(
      !region.has(row.line),
      `README:${row.line} is inside useSharedStorage() but was pulled into the App-Storage region:\n` +
        `      ${row.text.trim().slice(0, 120)}`,
    );
  }
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
  for (const { rel, rows } of scanUnits()) {
    for (const finding of findQuotaLiteralsInRows(rows)) {
      offenders.push(
        `${rel}:${finding.line} — "${finding.figure}" (${finding.why})\n      ${finding.excerpt}`,
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
