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
  // #343 — "the error string a rejection carries" — was HERE and is CLOSED.
  // The mock now emits the host's own messages, drawn from
  // `packages/civitai-app-sdk/src/blocks/appStorageErrors.ts`; that membership
  // is guarded by `tests/guards/app-storage-error-strings.test.mjs` and the
  // per-ceiling behaviour by `mockHostScenarios.test.tsx`. Deleting the row is
  // the point of the ledger: the docs must stop listing it in the same commit,
  // which is what the tests below enforce.
  { issue: 345, what: 'the byte gate refuses a shrinking overwrite the host admits', direction: 'restrictive' },
  { issue: 347, what: 'the byte budget is counted in wire bytes, the host counts stored bytes', direction: 'PERMISSIVE' },
  // 🔴 ADDED WITH #343's FIX, NOT BY IT. Both of these were already true before
  // the mock started emitting the host's own messages; they were simply absent
  // from this ledger, so both READMEs rendered a list of "two known
  // divergences" that was short by two. A list that is SHORT is the dangerous
  // shape — it reads as exhaustive. #366 wrote them down; neither is fixed.
  {
    // 🔴 PERMISSIVE, not restrictive — corrected after the label was read
    // against this file's own definition (see the `direction` note below).
    // The host enforces two APP-WIDE gates the mock has no model of at all
    // (`apps.router.ts:782` bytes, `:790` rows), so the mock ADMITS a write
    // the host would refuse. That the two messages are also unreachable
    // locally is the same fact seen from the block's side; the actionable
    // half is that `dev:mock` says yes where production says no.
    issue: 368,
    what: 'no mock models the app-wide umbrella, so a write the host refuses with `app quota exceeded` / `app row limit exceeded` succeeds locally, and neither message is reachable outside production',
    direction: 'PERMISSIVE',
  },
  {
    issue: 369,
    what: 'lowering `valueCapBytes` moves the gate but not the message, which still names the host’s real cap',
    direction: 'neither',
  },
  {
    // 🔴 PERMISSIVE, same direction as #368 and for the same reason: a gate the
    // host has and the mock does not. It is a ZOD bound (`apps.router.ts:460`,
    // `const keyInput = z.string().min(1).max(200)`), so it throws no
    // `TRPCError` and is invisible to the re-derivation recipe in
    // `appStorageErrors.ts` — which is how it stayed unlisted while that file
    // claimed the ceiling set was closed.
    issue: 370,
    what: 'neither the mock nor `useAppStorage` caps a storage `key`, while the host refuses one over 200 characters zod-side — an over-length key saves locally, fails forever live, and classifies `null`',
    direction: 'PERMISSIVE',
  },
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
// #343's consequence in the one example a reader copies from — now CLOSED.
//
// TWO tests lived here (this file went 7 -> 5), plus the `errorArmPatternOf`
// helper they shared:
//   - 'INVARIANT GUARD — the kv-storage example matches the MOCK string and NOT
//     the host message (#343)'
//   - 'the kv-storage example DOCUMENTS the arm as mock-only, and no longer
//     claims otherwise'
// Both pinned the shape of the defect — that `kv-storage`'s
// `storageFailureMessage()` matched the MOCK's `PAYLOAD_TOO_LARGE` and nothing
// the host sends, and that the file said so out loud ("MOCK-ONLY"). Both
// asserted the bug, correctly, while it existed. They are gone with it — a
// guard that pins a fixed defect goes red on the fix, and leaving it to be
// "adjusted" is how a test ends up asserting the opposite of the truth.
//
// The count is here so a later reader can verify the deletion was complete
// against `git show <base>:<this file>`; it said "three" until #366, and it was
// wrong.
//
// The successor claims live in `tests/guards/app-storage-error-strings.test.mjs`:
// the example branches on `classifyAppStorageError()` and spells no host
// message of its own, and every rejection the mock emits is drawn from the
// exported set. Positive claims, not an absence.
// ---------------------------------------------------------------------------

/**
 * The PARAGRAPH of a site's caveat that makes the permissive claim — the block
 * of non-blank lines around the first line naming "permissive".
 *
 * Bounded to the paragraph, not "to the end of the caveat": the claim and the
 * issue numbers backing it are written as one sentence, and a wider region
 * would start counting issue references from unrelated prose that happens to
 * follow.
 */
function permissiveClaimOf(site) {
  const lines = caveatOf(site).split('\n');
  const at = lines.findIndex((l) => /permissive/i.test(l));
  if (at < 0) return { at, text: '' };
  let start = at;
  while (start > 0 && lines[start - 1].trim() !== '') start -= 1;
  let end = at;
  while (end < lines.length - 1 && lines[end + 1].trim() !== '') end += 1;
  return { at, text: lines.slice(start, end + 1).join('\n') };
}

test('every site names EXACTLY the PERMISSIVE divergences the ledger holds', () => {
  // The direction is the actionable half. A restrictive divergence costs a
  // confusing local failure; a permissive one ships a block that fails in
  // production, which is the exact bug this whole change exists to end.
  //
  // 🔴 THIS PINS THE COUNT, NOT THE WORD — and the previous version pinned the
  // word. It asserted `/permissive/i.test(caveat)`, which was green while both
  // READMEs said #347 was permissive "**alone among them**" — the defect — and
  // stayed green when #368 was correctly added as a second one. A guard that
  // cannot tell those two states apart is not guarding the correction; it is
  // guarding the presence of a word, which any wording satisfies. So the claim
  // asserted here is the SET: the issue numbers the permissive sentence names
  // must be exactly the ledger's `direction: 'PERMISSIVE'` rows, failing when
  // the prose is short (the dangerous direction) and when it is long.
  const permissive = DIVERGENCE_LEDGER.filter((d) => d.direction === 'PERMISSIVE');
  assert.ok(permissive.length > 0, 'ledger records no permissive divergence — update this test with it');
  const expected = permissive.map((d) => d.issue).sort((a, b) => a - b);
  const word = COUNT_WORDS[permissive.length];

  for (const site of SITES) {
    const { at, text } = permissiveClaimOf(site);
    assert.ok(
      at >= 0,
      `${site.file} must list #${expected.join('/')} as permissive and never says the word\n` +
        `"permissive" anywhere in its divergence caveat. A reader who skims the list has no way\n` +
        `to tell that ${word} of these let a write PASS locally and fail live, while the others\n` +
        `do the opposite.`,
    );

    // The paragraph must be a STRICT slice of the caveat, or the set below is
    // just the full-ledger assertion wearing a different name.
    assert.ok(
      text.length < caveatOf(site).length,
      `${site.file}: the permissive paragraph spans the whole caveat, so comparing its issue\n` +
        `references to the permissive subset is not reading the claim — it is reading the list.`,
    );

    assert.deepEqual(
      issuesIn(text),
      expected,
      `${site.file}'s permissive sentence names ${JSON.stringify(issuesIn(text))}, but the ledger\n` +
        `holds ${permissive.length} permissive divergence(s): ${permissive
          .map((d) => `#${d.issue} (${d.what})`)
          .join('; ')}.\n\n` +
        `        SHORT is the dangerous direction — it was "#347, alone among them", which read as a\n` +
        `        reassuring singular while #368 lets a write the host refuses with \`app quota\n` +
        `        exceeded\` succeed locally. Name every permissive row in the sentence that makes the\n` +
        `        claim, and say how many.\n\n` +
        `        Paragraph read:\n${text
          .split('\n')
          .map((l) => `          ${l}`)
          .join('\n')}`,
    );
  }
});
