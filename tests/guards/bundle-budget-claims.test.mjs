/**
 * Guards what `@civitai/components`' own docs and source comments are allowed to
 * say about the CDN bundle sizes.
 *
 * TWO RULES, and they pull in opposite directions on purpose:
 *
 *   1. A **budget** figure quoted in prose must equal a budget
 *      `scripts/build-elements.ts` actually enforces. The budget is a contract —
 *      the build exits non-zero over it — so a doc naming the wrong one is
 *      telling a reader the wrong ceiling.
 *   2. An **occupancy** figure must not appear at all: no "currently sits at
 *      N kB", no "already at N% of its budget". That number is build OUTPUT, it
 *      moves with every element added, and nothing can keep it true.
 *
 * WHY THIS EXISTS
 * ===============
 * The occupancy figure has rotted three times, twice inside a single PR:
 *
 *   - `README.md` said "about 19 kB" against a 25 kB budget, then "about 28 kB"
 *     against a 32 kB one. The first was already wrong when the vocabulary grew;
 *     the second was wrong on the very commit that wrote it — the bundle measured
 *     29.0 kB, 91%.
 *   - `src/elements/civitai-text.ts` justified eight hand-written templates
 *     against a budget "already at 86% of its gzip budget". 86% was the figure at
 *     that branch's BASE; by the head of the same PR it was 91%. The sentence was
 *     a live argument for a design decision, resting on a number that had moved
 *     under it while the PR was open.
 *
 * Substituting today's number is the same defect rescheduled, and a reviewer
 * cannot tell a fresh figure from a stale one by reading it. So: state the
 * budget (guarded, rule 1) and point at the build for the rest (rule 2).
 *
 * 🔴 SCOPE AND KNOWN LIMITS — read these before trusting a PASS. They are written
 * to the width of the code below, not to the width of the intent:
 *   - The corpus is NOT "every doc and comment in the package". It is the files
 *     `walk()` reaches: under `packages/civitai-components`, with the extensions
 *     in `SCANNED_EXTENSIONS` (`.md`, `.ts`, `.tsx`, `.mjs`, `.css` — so no
 *     `.json`, `.html`, `.js`, `.svelte`, `.yaml`), minus the directories in
 *     `SKIP_DIRS` (`node_modules`, `dist`, `coverage`, `.turbo`, and
 *     deliberately `playground/` and `demo/`, which are scratch surfaces), minus
 *     `CHANGELOG.md`. The changelog is out because it legitimately records the
 *     figure that was true at a release, and rewriting history to satisfy a guard
 *     would be a lie. `demo/index.html` would be out on two counts.
 *   - `scripts/build-elements.ts` is skipped by BOTH rules, not just rule 1. It
 *     IS the authority, and its comment legitimately records both the budgets it
 *     was raised FROM and the occupancy it prints.
 *   - It is a text scan over whitespace-normalised file contents, not a Markdown
 *     or TypeScript parse: a figure in a code fence counts the same as one in a
 *     sentence. That direction is safe — it over-reports and names file:figure.
 *   - Rule 1 keys on the word "budget" inside an 80-character window of a `N kB`
 *     figure. A budget stated without ever using that word is invisible to it.
 *     `COVERAGE_FLOOR` is what stops that silently emptying the corpus — 🔴 and it
 *     guards RULE 1 ONLY. Rule 2 has its own floor for its own reason; see
 *     `RULE2_EXPECTED_SUBTREES`.
 *   - Rule 2 is a scan for the SHAPES that rotted. A sufficiently inventive
 *     rewording gets past it. The structural half of the fix is that the figures
 *     were deleted; this rule exists to stop them being pasted back, not to make
 *     that impossible.
 *   - OFFLINE, and it does not build anything. It compares two files. Whether the
 *     bundle is actually under budget is the build's job and the build already
 *     fails over it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(REPO_ROOT, 'packages', 'civitai-components');
/** The one file that DEFINES the budgets. Everything else merely quotes them. */
const AUTHORITY = join(PKG, 'scripts', 'build-elements.ts');

/**
 * Both budget figures are stated in `README.md`, so the corpus can never be
 * legitimately empty. A floor below 2 would let a refactor that reworded the
 * README past rule 1 entirely while still reporting a pass.
 */
const COVERAGE_FLOOR = 2;

/**
 * 🔴 RULE 2'S OWN COVERAGE FLOOR, and why `COVERAGE_FLOOR` above is not it.
 *
 * Rule 1 passes by comparing figures it FOUND, so counting them detects an
 * emptied corpus. Rule 2 passes by finding NOTHING — a clean scan of the real
 * corpus and a clean scan of an empty one are the same assertion, so no count of
 * its own output can tell them apart. The corpus itself has to be asserted.
 *
 * Demonstrated before this was added: putting `'src'` into `SKIP_DIRS` — a
 * plausible "scan only the docs" edit — while the sentence "already at 86% of its
 * gzip budget" is live in `src/elements/civitai-text.ts` left all four tests
 * GREEN. `COVERAGE_FLOOR` did not fire because `README.md` alone keeps rule 1's
 * `checked` at 3.
 *
 * So rule 2 pins the SHAPE of its corpus as an exact set of subtrees, failing if
 * one is lost (a `SKIP_DIRS` or `SCANNED_EXTENSIONS` change) *or* gained (a new
 * scannable directory nobody decided about), plus the two files the occupancy
 * figure actually rotted in. An exact set rather than a file count because the
 * count moves with every element added and a count that drifts gets widened until
 * it means nothing.
 */
const RULE2_EXPECTED_SUBTREES = ['(package root)', 'scripts', 'src', 'test'];
/** The two historical rot sites, spelled posix-style relative to the package. */
const RULE2_REQUIRED_FILES = ['README.md', 'src/elements/civitai-text.ts'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'playground', 'demo']);
const SCANNED_EXTENSIONS = ['.md', '.ts', '.tsx', '.mjs', '.css'];
/** History, not a live claim — see SCOPE. */
const SKIP_FILES = new Set([join(PKG, 'CHANGELOG.md')]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...walk(full));
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext)) && !SKIP_FILES.has(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Package-relative, posix-spelled, so the ledger above reads the same anywhere. */
const relPath = (file) => relative(PKG, file).split(sep).join('/');

/** The top-level subtree a corpus file sits in; a loose file is the root itself. */
const subtreeOf = (file) => {
  const parts = relPath(file).split('/');
  return parts.length === 1 ? '(package root)' : parts[0];
};

/** Whitespace-normalised, so a claim wrapped across lines still reads as one. */
const normalise = (text) => text.replace(/\s+/g, ' ');

/** `N kB` anywhere in the text, with the ±80 char window that decides its kind. */
const KB_FIGURE = /(\d+(?:\.\d+)?)\s*kB/g;
const WINDOW = 80;

/** Rule 2's shapes, applied to normalised text. */
const OCCUPANCY_PATTERNS = [
  {
    id: 'percent-of-budget',
    // A percentage anywhere near the word budget. This is the civitai-text.ts
    // shape ("already at 86% of its gzip budget").
    test: (text) => {
      const hits = [];
      for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
        const window = text.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW);
        if (/budget/i.test(window)) hits.push(m[0]);
      }
      return hits;
    },
  },
  {
    id: 'point-in-time-size',
    // The README shape ("it currently sits at about 28 kB").
    test: (text) => [
      ...text.matchAll(
        /\b(?:currently|presently|right now|now|today|sits? at|stands? at|comes? to|amounts? to)\b[^.]{0,40}?\d+(?:\.\d+)?\s*kB/gi
      ),
    ].map((m) => m[0]),
  },
];

/** The budgets the build actually enforces, in kB, read off the authority. */
function enforcedBudgets() {
  const source = readFileSync(AUTHORITY, 'utf8');
  const budgets = [...source.matchAll(/budget:\s*(\d+(?:\.\d+)?)\s*\*\s*1024/g)].map((m) =>
    Number(m[1])
  );
  return new Set(budgets);
}

test('the enforced budgets are readable off build-elements.ts', () => {
  const budgets = enforcedBudgets();
  // POSITIVE CONTROL for the authority half: if the `budget: N * 1024` shape is
  // ever refactored away, every rule below would compare against an EMPTY set
  // and rule 1 would fail on every figure with a misleading message, while a
  // corpus that quoted nothing would pass. Fail here instead, where it is clear.
  assert.ok(
    budgets.size >= 2,
    `parsed ${budgets.size} budget(s) out of ${relative(REPO_ROOT, AUTHORITY)}; the ` +
      '`budget: N * 1024` shape this guard reads has changed, so update the parser ' +
      'rather than the docs'
  );
});

test('a kB budget quoted in prose matches the one the build enforces', () => {
  const budgets = enforcedBudgets();
  const offences = [];
  let checked = 0;

  for (const file of walk(PKG)) {
    if (file === AUTHORITY) continue;
    const text = normalise(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(KB_FIGURE)) {
      const window = text.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW);
      if (!/budget/i.test(window)) continue;
      checked += 1;
      if (!budgets.has(Number(m[1]))) {
        offences.push(`${relative(REPO_ROOT, file)}: "${m[0]}" — …${window.trim()}…`);
      }
    }
  }

  assert.equal(
    offences.length,
    0,
    `a doc states a bundle budget the build does not enforce (enforced: ${[...budgets]
      .sort((a, b) => a - b)
      .join(', ')} kB). Fix the prose, or change the budget in ` +
      `${relative(REPO_ROOT, AUTHORITY)} and the prose together:\n  ${offences.join('\n  ')}`
  );
  assert.ok(
    checked >= COVERAGE_FLOOR,
    `only ${checked} budget figure(s) found in packages/civitai-components (floor ` +
      `${COVERAGE_FLOOR}). README.md states both budgets, so a count below the floor ` +
      'means this guard has stopped reading the corpus and its pass means nothing'
  );
});

test('no doc or comment states how full the bundle is TODAY', () => {
  const corpus = walk(PKG).filter((file) => file !== AUTHORITY);

  // COVERAGE IS ASSERTED FIRST, because this rule's pass condition is a ZERO and
  // a zero over nothing looks exactly like a zero over everything. See
  // RULE2_EXPECTED_SUBTREES for the demonstration this exists to catch.
  const subtrees = [...new Set(corpus.map(subtreeOf))].sort();
  assert.deepEqual(
    subtrees,
    [...RULE2_EXPECTED_SUBTREES].sort(),
    `rule 2's corpus covers ${JSON.stringify(subtrees)}, not ` +
      `${JSON.stringify([...RULE2_EXPECTED_SUBTREES].sort())}. A subtree that ` +
      'DISAPPEARED means SKIP_DIRS or SCANNED_EXTENSIONS stopped this rule reading ' +
      'part of the package, and every occupancy figure in there now passes ' +
      'vacuously. One that APPEARED is a new scannable directory nobody has ' +
      'decided about — add it to RULE2_EXPECTED_SUBTREES to scan it, or to ' +
      'SKIP_DIRS to exclude it, but do not leave the ledger disagreeing with the walk'
  );
  const present = new Set(corpus.map(relPath));
  const missing = RULE2_REQUIRED_FILES.filter((path) => !present.has(path));
  assert.deepEqual(
    missing,
    [],
    `rule 2's corpus no longer contains ${JSON.stringify(missing)} — the exact ` +
      'file(s) the occupancy figure rotted in. A clean scan that cannot reach them ' +
      'is not evidence the figure stayed out'
  );

  const offences = [];
  for (const file of corpus) {
    const text = normalise(readFileSync(file, 'utf8'));
    for (const { id, test: match } of OCCUPANCY_PATTERNS) {
      for (const hit of match(text)) {
        offences.push(`${relative(REPO_ROOT, file)} [${id}]: "${hit.trim()}"`);
      }
    }
  }

  assert.equal(
    offences.length,
    0,
    'a bundle OCCUPANCY figure is back in prose. It cannot be kept true — it moves ' +
      'with every element added, and it has already rotted three times. State the ' +
      'budget instead and let `pnpm --filter @civitai/components build` print the ' +
      `current size:\n  ${offences.join('\n  ')}`
  );
});

test('NEGATIVE CONTROL: both detectors fire on the text they were written for', () => {
  const budgets = enforcedBudgets();

  // Rule 1: a budget figure nobody enforces.
  const wrongBudget = normalise('The build fails if it exceeds 25 kB gzip against its budget.');
  const found = [...wrongBudget.matchAll(KB_FIGURE)].filter((m) => {
    const window = wrongBudget.slice(
      Math.max(0, m.index - WINDOW),
      m.index + m[0].length + WINDOW
    );
    return /budget/i.test(window) && !budgets.has(Number(m[1]));
  });
  assert.equal(
    found.length,
    1,
    'rule 1 did not flag a 25 kB budget, which is a real figure this README used to ' +
      'state and the build has not enforced since the vocabulary grew — the detector ' +
      'is wired to nothing'
  );

  // Rule 2, both shapes, in the exact words that shipped.
  const cases = [
    ['percent-of-budget', 'grow a bundle already at 86% of its gzip budget, to save eight'],
    ['point-in-time-size', 'The build fails if it exceeds it; it currently sits at about 28 kB.'],
  ];
  for (const [id, sample] of cases) {
    const pattern = OCCUPANCY_PATTERNS.find((p) => p.id === id);
    assert.ok(
      pattern.test(normalise(sample)).length > 0,
      `rule 2's \`${id}\` detector did not flag the sentence it was written for: ` +
        `"${sample}" — a clean scan of the real corpus therefore proves nothing`
    );
  }

  // The three checks above run the detectors against synthetic strings, which
  // proves the PATTERNS work and says nothing about the path rule 2 actually
  // takes. This one splices the rotted sentence into a REAL corpus file's real
  // contents, read and normalised exactly as rule 2 reads it, so a break anywhere
  // in walk → readFileSync → normalise → detector shows up here too.
  const rotSite = walk(PKG).find((file) => relPath(file) === 'src/elements/civitai-text.ts');
  assert.ok(rotSite, 'walk() no longer reaches src/elements/civitai-text.ts');
  const spliced = normalise(
    `${readFileSync(rotSite, 'utf8')}\n// grow a bundle already at 86% of its gzip budget, to save eight`
  );
  const viaCorpus = OCCUPANCY_PATTERNS.flatMap((p) => p.test(spliced));
  assert.ok(
    viaCorpus.length > 0,
    "rule 2's detectors found nothing in a real corpus file with the rotted " +
      'sentence appended, so the read/normalise path they run over is broken and ' +
      'the clean scan above measured nothing'
  );
});
