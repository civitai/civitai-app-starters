/**
 * PARITY GUARD — the standalone starters' shared session-refresh and estimate
 * code is COPIED into each starter, and this keeps the copies identical.
 *
 * Each starter is copied out on its own by `npx tiged`, so none can import a
 * sibling and the code has to live in every one of them. Before these copies
 * existed, next-app had the fixes for #804, #855 (session refresh) and #853,
 * #854 (estimate) while sveltekit-app, react-pwa and svelte-pwa still cleared
 * the session on any refresh failure and showed an absent cost as 0 Buzz: a
 * fix made in one starter stayed missing from the other three. This turns
 * "remember to port it" into a check.
 *
 * WHAT IT PINS, as whole files (not a sample of them):
 *   - `refresh-tokens.ts`: next-app and sveltekit-app `src/lib/`, the PWAs
 *     `server/` (their BFF compiles from `server/` alone).
 *   - `src/lib/estimate.ts` in all four.
 *   - `tests/estimate.test.mjs` in all four, and `tests/refresh-tokens.test.mjs`
 *     in all four except its one `const MODULE = …` line, which names where
 *     that starter keeps the module.
 *   - `scripts/probe-expired-session.mjs` in sveltekit-app and the two PWAs
 *     (next-app's drives `next start` and is its own file).
 *
 * 🔴 TEXT IDENTITY ONLY. It cannot tell you the shared code is CORRECT — that
 * is the unit tests' and the probes' job, and they run in every starter. It
 * also cannot tell you a starter USES the module; the seam guards
 * (`starter-estimate-seam.test.mjs`, `starter-refresh-seam.test.mjs`) do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTERS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'starters');

/** The copies of each shared file. The first entry is the one the rest must match. */
export const COPIES = {
  'refresh-tokens.ts': [
    'next-app/src/lib/refresh-tokens.ts',
    'sveltekit-app/src/lib/refresh-tokens.ts',
    'react-pwa/server/refresh-tokens.ts',
    'svelte-pwa/server/refresh-tokens.ts',
  ],
  'estimate.ts': [
    'next-app/src/lib/estimate.ts',
    'sveltekit-app/src/lib/estimate.ts',
    'react-pwa/src/lib/estimate.ts',
    'svelte-pwa/src/lib/estimate.ts',
  ],
  'estimate.test.mjs': [
    'next-app/tests/estimate.test.mjs',
    'sveltekit-app/tests/estimate.test.mjs',
    'react-pwa/tests/estimate.test.mjs',
    'svelte-pwa/tests/estimate.test.mjs',
  ],
  'refresh-tokens.test.mjs': [
    'next-app/tests/refresh-tokens.test.mjs',
    'sveltekit-app/tests/refresh-tokens.test.mjs',
    'react-pwa/tests/refresh-tokens.test.mjs',
    'svelte-pwa/tests/refresh-tokens.test.mjs',
  ],
  'probe-expired-session.mjs': [
    'sveltekit-app/scripts/probe-expired-session.mjs',
    'react-pwa/scripts/probe-expired-session.mjs',
    'svelte-pwa/scripts/probe-expired-session.mjs',
  ],
};

/** Where each starter keeps `refresh-tokens.ts`, as its test file must import it. */
const MODULE_LINE = {
  'next-app': "const MODULE = '../src/lib/refresh-tokens.ts';",
  'sveltekit-app': "const MODULE = '../src/lib/refresh-tokens.ts';",
  'react-pwa': "const MODULE = '../server/refresh-tokens.ts';",
  'svelte-pwa': "const MODULE = '../server/refresh-tokens.ts';",
};

const read = (rel) => readFileSync(resolve(STARTERS, rel), 'utf8');

/**
 * The text that must match. For the refresh-tokens test, the starter's own
 * `MODULE` line is checked and then replaced by a placeholder, so a copy that
 * points at ANOTHER starter's path (or anywhere else) fails rather than
 * normalising away.
 */
function normalised(name, rel, text) {
  if (name !== 'refresh-tokens.test.mjs') return text;
  const starter = rel.split('/')[0];
  const want = MODULE_LINE[starter];
  const lines = text.split('\n').filter((l) => l.startsWith('const MODULE = '));
  assert.deepEqual(lines, [want], `${rel} must import the module from exactly: ${want}`);
  return text.replace(want, '<MODULE>');
}

/** The problems with one set of copies, as strings. Empty = identical. */
export function parityProblems(name, texts) {
  const [first, ...rest] = Object.entries(texts);
  const problems = [];
  for (const [rel, text] of rest) {
    if (text !== first[1]) {
      const a = first[1].split('\n');
      const b = text.split('\n');
      let line = 0;
      while (line < Math.max(a.length, b.length) && a[line] === b[line]) line += 1;
      problems.push(
        `${rel} differs from ${first[0]} at line ${line + 1}:\n` +
          `  ${first[0]}: ${JSON.stringify(a[line])}\n  ${rel}: ${JSON.stringify(b[line])}`,
      );
    }
  }
  return problems;
}

for (const [name, rels] of Object.entries(COPIES)) {
  test(`${name}: every starter's copy is identical`, () => {
    const missing = rels.filter((rel) => !existsSync(resolve(STARTERS, rel)));
    assert.deepEqual(missing, [], `missing copies of ${name}`);
    const texts = Object.fromEntries(rels.map((rel) => [rel, normalised(name, rel, read(rel))]));
    assert.deepEqual(parityProblems(name, texts), []);
  });
}

// --- negative controls: the comparison can go red --------------------------

test('control: a one-character change in one copy is reported against that copy', () => {
  const [a, b, c] = COPIES['estimate.ts'];
  const text = read(a);
  const changed = text.replace('Number.isFinite(value)', 'Number.isFinite(value) || value === 0');
  assert.notEqual(changed, text, 'the control edit must change the text');
  const problems = parityProblems('estimate.ts', { [a]: text, [b]: changed, [c]: text });
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} differs`));
});

test('control: a refresh-tokens test pointing at another starter\'s module is refused', () => {
  const rel = 'react-pwa/tests/refresh-tokens.test.mjs';
  const wrong = read(rel).replace(MODULE_LINE['react-pwa'], MODULE_LINE['next-app']);
  assert.throws(() => normalised('refresh-tokens.test.mjs', rel, wrong), /must import the module from exactly/);
});
