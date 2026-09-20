/**
 * Guards against source comments that encode the REVIEW STATUS of a
 * civitai/civitai pull request.
 *
 * Rule: a comment in `packages/` or `starters/` may REFERENCE a
 * `civitai/civitai#NNNN`, but it may not assert that the PR is open, unmerged,
 * abandoned, or never landed. A claim about behaviour ("the host stamps
 * `signedIn: true`") stays true or fails a test. A claim about a PR's review
 * status expires silently the moment someone clicks Merge, and nothing in this
 * repo's build, tests or type-check can notice.
 *
 * WHY THIS EXISTS
 * ===============
 * `civitai/civitai#3707` ("App Blocks BLOCK_INIT v2: … add viewer.signedIn …")
 * merged **2026-08-07T01:57:31Z**. Six weeks later, 17 sites across both
 * packages and two reference starters still asserted it was "OPEN and
 * unmerged", and the direction of the damage was not uniform:
 *
 *   - THREE sites were executable instructions to delete now-correct code —
 *     "🔴 IF #3707 IS ABANDONED: drop `signedIn` from this default, from …",
 *     "🔴 IF #3707 NEVER LANDS, this assertion is what has to change first",
 *     "what to unwind if #3707 is abandoned". Their precondition had resolved
 *     the OTHER way. A maintainer who read the "OPEN and unmerged" header and
 *     followed the directive would have removed working `viewer.signedIn`
 *     support from the mock host, the live host and the test fences.
 *   - TWO reference starters talked block authors OUT of `viewer.signedIn` and
 *     onto `viewer !== null`, on the stated premise that "the production host
 *     does not [send it]". That premise was false.
 *   - The stale text shipped to npm inside `@civitai/app-sdk@0.45.0`'s
 *     `dist/blocks/types.d.ts` (4 occurrences), i.e. into the editor tooltip an
 *     author hovers while deciding which sign-in gate to write.
 *
 * None of that was a logic bug. Every test was green the whole time, because
 * the claim lived only in prose.
 *
 * 🔴 KNOWN LIMITS — stated so nobody reads this as wider coverage than it is:
 *   - It is a TEXT SCAN, not a semantic one, and is therefore walkable by
 *     rewording ("the host counterpart has not landed" evades the vocabulary
 *     below). It catches the CLASS that actually rotted, not every possible
 *     spelling of it. The non-walkable half of the contract is the positive
 *     assertion in `tests/guards/starter-signin-gate.test.mjs`, which pins what
 *     the starters DO rather than what a comment says.
 *   - OFFLINE by design, like `doc-cdn-urls.test.mjs`. It never calls `gh`. A
 *     network check that fails on a GitHub outage cannot be a required gate;
 *     re-verifying a PR's live state is a human's job at review time.
 *   - `CHANGELOG.md` is EXEMPT. A changelog records what was believed when the
 *     entry was written; rewriting it to satisfy a guard would be a lie.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Trees walked. Everything a human reads or an editor renders from source. */
const ROOTS = ['packages', 'starters'];

/** Directories never walked — generated, vendored, or not source. */
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

/** Extensions scanned. Source + prose; binary and lockfiles excluded. */
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.svelte', '.html'];

/** Filenames exempt because they are historical records. */
const EXEMPT_BASENAMES = new Set(['CHANGELOG.md']);

/**
 * Vocabulary that turns a PR REFERENCE into a PR STATUS CLAIM.
 *
 * 🔴 EVERY PATTERN HERE IS SHAPED BY A MEASURED FALSE POSITIVE, not by taste.
 * A first draft used the issue's own suggested vocabulary — bare `\bopen\b`
 * and a substring `abandon` — and flagged two comments that are not status
 * claims at all:
 *
 *   - `hooks/useBuzzWorkflow.ts:824` cites `civitai/civitai#4159` and says a
 *     block recovers by "(open a top-up flow)". `open` as a VERB.
 *   - `internal/requestTimeouts.ts:23` cites `civitai/civitai#4158` and calls
 *     the human-interaction timeout "a ceiling on abandonment". `abandon` as
 *     an ordinary noun about a USER, not about a PR.
 *
 * So `open` is only a status claim in its two observed CLAIM shapes — `(OPEN,`
 * / `(open)` and `is (still) open` — and `abandon` only as `is abandoned`. A
 * required gate that cries wolf gets clicked through, which is worse than not
 * having it.
 */
const STATUS_CLAIM_PATTERNS = [
  // Only ever a PR-status word. No ordinary-English reading.
  /\bunmerged\b/i,
  // "(OPEN, unmerged)" / "(open)" — parenthesised status annotation. The
  // trailing `[,)]` is what separates it from "(open a top-up flow)".
  /\(\s*open\s*[,)]/i,
  // "— open, unmerged" — the em-dash annotation form the two starters used.
  /[—–-]\s*open\s*,/i,
  // "which is OPEN and unmerged" / "is still open".
  /\bis\s+(?:still\s+)?open\b/i,
  // "if #3707 is abandoned" — NOT "a ceiling on abandonment".
  /\b(?:is|was|were|gets?)\s+abandoned\b/i,
  /\bnever\s+lands?\b/i,
  /\bnot\s+(?:yet\s+)?merged\b/i,
  /\bstill\s+in\s+review\b/i,
  /\bhas\s+not\s+(?:yet\s+)?(?:merged|landed|shipped)\b/i,
];

/** A civitai/civitai PR or issue reference. Bare `#123` is NOT enough. */
const PR_REFERENCE = /civitai\/civitai#(\d{2,6})/gi;

/**
 * The CONTINGENCY DIRECTIVE form, matched on a BARE `#NNNN` anywhere — no
 * `civitai/civitai` prefix and no proximity window required.
 *
 * This is the shape that does real damage, so it gets its own scan rather than
 * relying on a nearby qualified reference. All three real instances were
 * standing instructions to delete code whose precondition had already resolved
 * the other way:
 *
 *   "🔴 IF #3707 IS ABANDONED: drop `signedIn` from this default, from …"
 *   "🔴 IF #3707 NEVER LANDS, this assertion is what has to change first."
 *   "See {@link DEFAULT_VIEWER} … for what to unwind if #3707 is abandoned."
 */
const CONTINGENCY_DIRECTIVE =
  /#(\d{3,6})\s+(?:is\s+abandoned|never\s+lands?|is\s+(?:still\s+)?open|is\s+unmerged)/gi;

/**
 * How far either side of a PR reference a status word still counts as
 * describing THAT reference. 400 characters is roughly a JSDoc paragraph — the
 * unit these claims were actually written in. Every one of the 17 real sites
 * had its status word within ~120 characters of the reference; the margin is
 * slack, not a measured boundary.
 */
const WINDOW_CHARS = 400;

/** Recursively enumerate scannable files under `dir`. */
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
  return out.sort();
}

/**
 * Return every status-claim finding in `text`.
 *
 * Exported shape: `{ pr, line, status, excerpt }`. Pure string work so the
 * self-test below can drive it with a literal and watch it fire.
 */
/**
 * Collapse comment leaders and line breaks to single spaces, PRESERVING BYTE
 * OFFSETS so a match index still maps to the original line.
 *
 * 🔴 WITHOUT THIS THE GUARD IS WALKABLE BY A LINE BREAK, and that is not
 * hypothetical — it was measured. A rewrite of `mockHost.ts` quoted the very
 * directive this guard bans, wrapped as `IF #3707 IS\n * ABANDONED:`. The
 * `\s+` in {@link CONTINGENCY_DIRECTIVE} spans the newline but not the ` * `
 * JSDoc leader, so the claim read clean while the identical text one line
 * shorter read dirty. Replacing each leader character with a SPACE (never
 * deleting it) keeps every subsequent offset intact, so `lineOf` and the
 * excerpt still point at the real source line.
 */
function flattenComments(text) {
  return text.replace(/\n[ \t]*(?:\/\/|\*\/|\*|#)?[ \t]*/g, (m) => ' '.repeat(m.length));
}

export function findStatusClaims(rawText) {
  const text = flattenComments(rawText);
  const findings = [];
  const seen = new Set();
  const lineOf = (index) => rawText.slice(0, index).split('\n').length;
  const excerptAt = (index) =>
    rawText
      .slice(Math.max(0, index - 60), index + 140)
      .replace(/\s+/g, ' ')
      .trim();

  PR_REFERENCE.lastIndex = 0;
  let match;
  while ((match = PR_REFERENCE.exec(text)) !== null) {
    const start = Math.max(0, match.index - WINDOW_CHARS);
    const end = Math.min(text.length, match.index + match[0].length + WINDOW_CHARS);
    const window = text.slice(start, end);
    for (const pattern of STATUS_CLAIM_PATTERNS) {
      const hit = window.match(pattern);
      if (!hit) continue;
      const key = `${match[1]}:${lineOf(match.index)}`;
      if (seen.has(key)) break;
      seen.add(key);
      findings.push({
        pr: match[1],
        line: lineOf(match.index),
        status: hit[0].replace(/\s+/g, ' '),
        excerpt: excerptAt(match.index),
      });
      break;
    }
  }

  CONTINGENCY_DIRECTIVE.lastIndex = 0;
  while ((match = CONTINGENCY_DIRECTIVE.exec(text)) !== null) {
    const key = `${match[1]}:${lineOf(match.index)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      pr: match[1],
      line: lineOf(match.index),
      status: match[0].replace(/\s+/g, ' '),
      excerpt: excerptAt(match.index),
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

test('POSITIVE CONTROL — the matcher fires on every real stale phrasing', () => {
  // Verbatim (or near-verbatim) from the 17 sites this guard was written for,
  // as they stood at 66f9e09 — one per distinct spelling, so a pattern that
  // stops matching one of them cannot hide behind the others. A zero from the
  // real scan below means nothing unless every one of these produces non-zero.
  const realStalePhrasings = {
    'types.ts:557 / mockHost.ts:906 — "which is OPEN and unmerged"':
      'arrives with civitai/civitai#3707, which is OPEN and unmerged. A block',
    'blockInitV2.test.ts:141 — parenthesised "(OPEN, unmerged)"':
      'civitai/civitai#3707 (OPEN, unmerged) — see the DEFAULT-viewer fence below.',
    'App.tsx:27 — em-dash "— open, unmerged"':
      'counterpart (civitai/civitai#3707 — open, unmerged) ships — so a block gating',
    'validate.ts:153 — status word on the NEXT comment line':
      'The host that writes the literal `true` is civitai/civitai#3707, which is\n    // OPEN and unmerged. Either way there is no malformed value to reject today,',
    'mockHost.ts:916 — contingency directive, BARE ref':
      '🔴 IF #3707 IS ABANDONED: drop `signedIn` from this default, from',
    'blockInitV2.test.ts:833 — contingency directive, BARE ref':
      '🔴 IF #3707 NEVER LANDS, this assertion is what has to change first. Drop',
    'liveHost.ts:1842 — contingency directive, prose form':
      'See {@link DEFAULT_VIEWER} in `mockHost` for the same note and for what to\n * unwind if #3707 is abandoned.',
    '"has not yet merged"':
      'civitai/civitai#3707 is what adds it, and it has not yet merged.',
    // 🔴 THE LINE-WRAP EVASION. Identical words to the mockHost.ts:916 case
    // above, broken across a JSDoc line. A first draft read this one CLEAN
    // while flagging the unwrapped twin — see `flattenComments`.
    'wrapped across a JSDoc leader':
      ' * ...by {@link ViewerInfo.signedIn}.\n * \n * 🔴 IF #3707 IS\n * ABANDONED: drop `signedIn` from this default.',
    'wrapped across a `//` leader':
      '    // 🔴 IF #3707 NEVER\n    // LANDS, this assertion is what has to change first.',
  };
  for (const [label, phrasing] of Object.entries(realStalePhrasings)) {
    const findings = findStatusClaims(phrasing);
    assert.ok(
      findings.length > 0,
      `matcher did not fire on a known-stale phrasing (${label}) — it is wired to nothing:\n${phrasing}`,
    );
  }
});

test('NEGATIVE CONTROL — references and ordinary English are not status claims', () => {
  const fine = {
    // The guard must not ban the reference itself. A comment is allowed — and
    // encouraged — to cite the PR that introduced a behaviour.
    'a merged-PR citation':
      'the host stamps `signedIn: true` (civitai/civitai#3707, merged 2026-08-07)',
    'a bare citation': 'See civitai/civitai#3707 for the BLOCK_INIT v2 contract.',
    // 🔴 Both of these are REAL comments in this repo. The first draft of this
    // guard flagged both. They are the reason the patterns above are shaped the
    // way they are, and they are asserted here so a future widening of the
    // vocabulary re-breaks on them instead of going quietly noisy.
    'useBuzzWorkflow.ts:824 — `open` as a verb':
      '🔴 AN ERRORED SUBMIT MUST REJECT (civitai/civitai-app-starters#251, the\n' +
      '// `submit` half of civitai/civitai#4159). Two producers report\n' +
      "// `status:'failed'` and `status` separates neither:\n" +
      '//   - a budget / spend-cap REJECTION is an OUTCOME the block recovers from\n' +
      '//     (open a top-up flow). The server quotes the price it refused to charge.',
    'requestTimeouts.ts:23 — `abandonment` as an ordinary noun':
      'The host still resolves the moment the person acts (pick / dismiss / confirm\n' +
      ' * / close), so this is a ceiling on abandonment, not a delay anyone waits out.\n' +
      ' * `PUBLISH_GENERATION_OUTPUTS` shipped without this opt-out and rejected\n' +
      ' * mid-dialog (civitai/civitai#4158): the generation had already been billed.',
  };
  for (const [label, text] of Object.entries(fine)) {
    assert.deepEqual(
      findStatusClaims(text),
      [],
      `matcher over-reported on acceptable text (${label}): ${text}`,
    );
  }
});

test('COVERAGE FLOOR — the walk reaches the files that actually carry these claims', () => {
  const files = scannableFiles().map((f) => relative(REPO_ROOT, f));
  assert.ok(files.length > 50, `walk found only ${files.length} files — it is not reaching the tree`);
  // The four source files that referenced #3707 at 66f9e09, one per surface
  // (SDK types, blocks-react internals, blocks-react tests, a starter). If the
  // walk stops reaching any of them, a regression here goes unseen.
  for (const required of [
    'packages/civitai-app-sdk/src/blocks/types.ts',
    'packages/civitai-blocks-react/src/internal/mockHost.ts',
    'packages/civitai-blocks-react/test/blockInitV2.test.ts',
    'starters/civitai-block-starter/src/App.tsx',
  ]) {
    assert.ok(files.includes(required), `walk did not reach ${required}`);
  }
});

test('no source file asserts a civitai/civitai PR is open, unmerged or abandoned', () => {
  const offenders = [];
  for (const file of scannableFiles()) {
    const findings = findStatusClaims(readFileSync(file, 'utf8'));
    for (const finding of findings) {
      offenders.push(
        `${relative(REPO_ROOT, file)}:${finding.line} — #${finding.pr} described as "${finding.status}"\n      …${finding.excerpt}…`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A comment asserts the review status of a civitai/civitai PR. That claim expires the\n` +
      `moment the PR is merged or closed, and nothing else in this repo can notice.\n` +
      `State the BEHAVIOUR instead ("the host stamps X"), citing the PR without its status.\n\n` +
      `    ${offenders.join('\n    ')}\n`,
  );
});
