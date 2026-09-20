/**
 * Guards the "how the mock differs from the host" caveat, which is written down
 * in more than one place and has already gone stale in one of them.
 *
 * WHY THIS EXISTS
 * ===============
 * `createMockHost` (and the `kv-storage` harness built on the same idea) is the
 * only thing between a block author and a production-only storage failure, so
 * the list of ways it LIES is load-bearing documentation. It is also duplicated
 * across documents that get edited at different times: when #347 was found, the
 * changeset and `packages/civitai-blocks-react/README.md` both still said
 * "**two** known divergences" and named only #343 and #345 — a count that was
 * simply wrong, in the reassuring direction.
 *
 * A count in prose is a claim, and nothing was checking it. This does.
 *
 * WHAT IT PINS
 * ============
 * One LEDGER of open divergences, and every documentation site must name the
 * same set — failing when the set grows, shrinks, or disagrees between sites.
 * Not the wording: the wording should be free to improve. The ISSUE NUMBERS and
 * the COUNT WORD, which are the machine-readable half of the claim.
 *
 * 🔴 KNOWN LIMITS:
 *   - `.changeset/*.md` is deliberately NOT a site here. A changeset is
 *     consumed at release and then does not exist, so a guard over it would
 *     start skipping itself. Its copy of the list is checked by review, once.
 *   - `internal/mockHost.ts`'s gate comment is deliberately NOT a site either:
 *     it documents the two divergences that live ON THAT GATE (#345, #347),
 *     which is correctly a subset, not the whole ledger.
 *   - Naming an issue is not the same as describing it correctly. This cannot
 *     check the prose; it can only make an omission loud.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every KNOWN, OPEN way `createMockHost` / the `kv-storage` harness differ from
 * the host. Add a row when one is found; delete a row when it is fixed AND the
 * docs stop listing it.
 */
const DIVERGENCE_LEDGER = [
  { issue: 343, what: 'the error string a rejection carries', direction: 'restrictive' },
  { issue: 345, what: 'the byte gate refuses a shrinking overwrite the host admits', direction: 'restrictive' },
  { issue: 347, what: 'the byte budget is counted in wire bytes, the host counts stored bytes', direction: 'PERMISSIVE' },
];

/** English count words, so the prose and the ledger cannot drift apart. */
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

/**
 * The documents that carry the list. `marker` opens the caveat; `window` is how
 * many lines after it the list may span. Both are asserted below — a window too
 * small to reach the last entry would make this guard pass for the wrong reason.
 */
const SITES = [
  {
    file: 'packages/civitai-blocks-react/README.md',
    marker: /not\W*\*{0,2}gate-for-gate\*{0,2} identical to the host/i,
    window: 25,
  },
  {
    file: 'starters/examples/kv-storage/README.md',
    marker: /simulation, not a replica/i,
    window: 25,
  },
];

/** The lines a site's caveat spans, as one string. */
function caveatOf({ file, marker, window }) {
  const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n');
  const at = lines.findIndex((l) => marker.test(l));
  assert.ok(
    at >= 0,
    `${file}: no line matches ${marker}. The caveat was reworded or removed — if it was\n` +
      `removed, this guard is now vouching for nothing.`,
  );
  return lines.slice(at, at + window).join('\n');
}

/** Issue numbers referenced in `text`, as a sorted unique array of numbers. */
export function issuesIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/(?:^|[^\w/])#(\d{3,5})\b/g)) found.add(Number(m[1]));
  for (const m of text.matchAll(/civitai-app-starters\/issues\/(\d{3,5})/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

test('CONTROL — the issue extractor finds references and does not invent them', () => {
  assert.deepEqual(issuesIn('see #343 and [#345](https://x/civitai-app-starters/issues/345)'), [343, 345]);
  assert.deepEqual(issuesIn('nothing here'), []);
  // Must not read a number out of an unrelated anchor or a colour literal.
  assert.deepEqual(issuesIn('colour #343a40 and a/path/#123'), []);
});

test('CONTROL — the caveat window is load-bearing, not vacuous', () => {
  // If a 2-line window found the same set, the window would be doing nothing
  // and a list that grew past it would silently stop being checked.
  for (const site of SITES) {
    const narrow = issuesIn(caveatOf({ ...site, window: 2 }));
    const full = issuesIn(caveatOf(site));
    assert.ok(
      narrow.length < full.length,
      `${site.file}: a 2-line window already finds every issue (${full.join(', ')}), so the\n` +
        `${site.window}-line window is not what is reading the list.`,
    );
  }
});

test('every site names EXACTLY the ledger of known mock/host divergences', () => {
  const expected = DIVERGENCE_LEDGER.map((d) => d.issue).sort((a, b) => a - b);
  for (const site of SITES) {
    assert.deepEqual(
      issuesIn(caveatOf(site)),
      expected,
      `${site.file}'s "how the mock differs" list does not match the ledger.\n` +
        `Expected: ${DIVERGENCE_LEDGER.map((d) => `#${d.issue} (${d.what})`).join('; ')}.\n` +
        `A list that is SHORT is the dangerous case: it reads as an exhaustive caveat and\n` +
        `understates how far \`dev:mock\` is from production. Update every site in SITES and\n` +
        `DIVERGENCE_LEDGER together.`,
    );
  }
});

test('every site states the COUNT, and the count matches the ledger', () => {
  const word = COUNT_WORDS[DIVERGENCE_LEDGER.length];
  assert.ok(word, `no count word for ${DIVERGENCE_LEDGER.length} divergences — extend COUNT_WORDS`);
  for (const site of SITES) {
    const caveat = caveatOf(site);
    assert.ok(
      new RegExp(`\\b${word}\\b`, 'i').test(caveat),
      `${site.file} does not say "${word}" anywhere in its divergence caveat. The prose count\n` +
        `and the list must agree; "two known divergences" above a list of three is how this\n` +
        `went wrong the first time.`,
    );
    // And it must not still carry a STALE count word.
    for (const [n, stale] of COUNT_WORDS.entries()) {
      if (n === DIVERGENCE_LEDGER.length) continue;
      assert.ok(
        !new RegExp(`\\b${stale}\\b known divergence`, 'i').test(caveat),
        `${site.file} still says "${stale} known divergences" — the ledger has ${DIVERGENCE_LEDGER.length}.`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// #343's consequence in the one example a reader copies from.
// ---------------------------------------------------------------------------

const KV_APP = 'starters/examples/kv-storage/src/App.tsx';

/** The literal regex `storageFailureMessage()` tests `err.message` against. */
export function errorArmPatternOf(source) {
  const fn = source.slice(source.indexOf('function storageFailureMessage'));
  assert.ok(fn, `${KV_APP} no longer defines storageFailureMessage()`);
  const m = /if \(\/(.+?)\/([gimsuy]*)\.test\(raw\)\)/.exec(fn);
  assert.ok(
    m,
    `${KV_APP}: could not find the \`if (/…/.test(raw))\` arm in storageFailureMessage().\n` +
      `If the shape changed, re-read the function and update this guard — do not delete it.`,
  );
  return new RegExp(m[1], m[2]);
}

test('INVARIANT GUARD — the kv-storage example matches the MOCK string and NOT the host message (#343)', () => {
  // Labelled an INVARIANT GUARD: it is GREEN at the pre-fix commit too, because
  // the ARM was already mock-only — only the DOCBLOCK was wrong about it. It is
  // not regression coverage for that finding; the docs test below is. What it
  // does is make the docs test's claim machine-checkable from now on: the day
  // someone widens the arm, this goes red and forces the prose to move with it.
  //
  // Behavioural, over the real source: run the example's own predicate against
  // both sides of the divergence.
  const arm = errorArmPatternOf(readFileSync(join(REPO_ROOT, KV_APP), 'utf8'));

  assert.ok(arm.test('PAYLOAD_TOO_LARGE'), `${KV_APP}: the arm no longer matches the MOCK's string`);

  // What the live host actually puts on the wire: the bridge forwards the
  // TRPCError's message, never its code (#343).
  for (const hostMessage of [
    'per-user row limit exceeded',
    'per-user storage quota exceeded',
    'value exceeds the maximum size',
  ]) {
    assert.equal(
      arm.test(hostMessage),
      false,
      `${KV_APP}'s error arm now matches the host message "${hostMessage}".\n` +
        `If #343 has been closed and the host's strings are enumerated, that is the right change —\n` +
        `but then the docblock, the example README and this test have to stop saying the arm is\n` +
        `MOCK-ONLY. Update all four together; that is what this assertion is for.`,
    );
  }
});

test('the kv-storage example DOCUMENTS the arm as mock-only, and no longer claims otherwise', () => {
  const src = readFileSync(join(REPO_ROOT, KV_APP), 'utf8');
  assert.ok(
    /MOCK-ONLY/i.test(src),
    `${KV_APP} does not say the error arm is mock-only. It is: it matches the mock's\n` +
      `PAYLOAD_TOO_LARGE and nothing the host sends, so in production the function has one\n` +
      `branch — the fallback.`,
  );
  assert.ok(/#343/.test(src), `${KV_APP} must point at #343, where the host's strings get pinned`);
  // The exact claim that was false: the copy is correct, and unreachable.
  assert.ok(
    !/stays correct either way/i.test(src),
    `${KV_APP} still claims the copy "stays correct either way". It does not — the arm never\n` +
      `fires against the host, so the actionable copy is unreachable in production.`,
  );
});

test('the PERMISSIVE divergence is called out as such at every site', () => {
  // The direction is the actionable half. A restrictive divergence costs a
  // confusing local failure; a permissive one ships a block that fails in
  // production, which is the exact bug this whole change exists to end.
  const permissive = DIVERGENCE_LEDGER.filter((d) => d.direction === 'PERMISSIVE');
  assert.ok(permissive.length > 0, 'ledger records no permissive divergence — update this test with it');
  for (const site of SITES) {
    const caveat = caveatOf(site);
    assert.ok(
      /permissive/i.test(caveat),
      `${site.file} must list #${permissive.map((d) => d.issue).join('/')} and never says the word\n` +
        `"permissive". A reader who skims the list has no way to tell that one of these lets a\n` +
        `write PASS locally and fail live, while the others do the opposite.`,
    );
  }
});
