/**
 * Guards the SHA pins on the workflow actions whose INTERNALS this repo depends on.
 *
 * Why this exists: `scripts/assert-published-versions.mjs` is only correct if
 * `changesets/action` commits the version bump and leaves HEAD on it. That is a
 * claim about the action's source, verified by reading it at a specific commit.
 * `changesets/action@v1` resolved to a BRANCH, not a tag — measured 2026-08-20,
 * `refs/heads/v1` exists and `refs/tags/v1` does not — so an upstream push could
 * invalidate the publish guard with no diff in this repo and nothing to review.
 *
 * The rule is deliberately an ALLOWLIST, not "pin everything": `actions/checkout`,
 * `actions/setup-node` and `pnpm/action-setup` are referenced by tag here on
 * purpose (all measured tag=1 branch=0), and this repo does not depend on their
 * internals. Only actions on MUST_PIN below are load-bearing in that sense.
 *
 * Read as a regression test: at b335c0e (pre-pin) the `changesets/action` case
 * FAILS with `pinned by tag/branch ref "v1"`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/**
 * Actions whose behaviour this repo REASONS ABOUT and therefore must pin to a
 * commit. Each entry names why, so a future reader can judge whether to remove it
 * rather than deleting a rule whose purpose is unrecorded.
 */
const MUST_PIN = {
  'changesets/action':
    'scripts/assert-published-versions.mjs depends on prepareBranch()/pushChanges() ' +
    'committing the version bump and leaving HEAD on it; `v1` is a moving branch',
  'peter-evans/create-pull-request':
    'opens PRs with repo write credentials from a scheduled workflow',
};

const SHA = /^[0-9a-f]{40}$/;
// `uses: owner/repo@ref` — tolerates quotes and a trailing `# comment`.
const USES = /^\s*(?:-\s*)?uses:\s*['"]?([^@'"\s]+)@([^'"\s]+)['"]?/;

/** Every `uses:` occurrence across the workflow dir, as {action, ref, file, line}. */
function collectUses() {
  const out = [];
  for (const name of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(join(WORKFLOW_DIR, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = USES.exec(line);
      if (m && !m[1].startsWith('./')) out.push({ action: m[1], ref: m[2], file: name, line: i + 1 });
    });
  }
  return out;
}

test('the parser finds workflow `uses:` refs at all (positive control)', () => {
  const uses = collectUses();
  // Without this, a regex that matches nothing would make every assertion below
  // pass vacuously over an empty set — the reassuring-zero failure mode.
  assert.ok(
    uses.length >= 10,
    `expected the workflow dir to yield many \`uses:\` refs, got ${uses.length}. ` +
      `The parser or the workflow layout changed; fix this before trusting the pin checks.`,
  );
  assert.ok(
    uses.some((u) => u.action === 'actions/checkout'),
    'expected actions/checkout among the parsed refs — the parser is not seeing real lines',
  );
});

for (const [action, why] of Object.entries(MUST_PIN)) {
  test(`${action} is pinned to a 40-hex commit SHA`, () => {
    const found = collectUses().filter((u) => u.action === action);

    // Presence check FIRST. A rename or a deleted workflow would otherwise leave
    // zero occurrences and report green while the pin was gone.
    assert.ok(
      found.length > 0,
      `MUST_PIN lists ${action} but no workflow references it. Either restore the ` +
        `reference or remove it from MUST_PIN deliberately. Reason it was listed: ${why}`,
    );

    for (const u of found) {
      assert.match(
        u.ref,
        SHA,
        `${u.file}:${u.line} pins ${action} by tag/branch ref "${u.ref}", not a commit SHA.\n` +
          `  Why this action must be SHA-pinned: ${why}\n` +
          `  A tag is movable and a branch moves by definition, so upstream can change ` +
          `behaviour here with no diff in this repo.`,
      );
    }
  });
}

test('SHA-pinned actions carry a version comment so the pin is readable', () => {
  const dir = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));
  const offenders = [];
  for (const name of dir) {
    readFileSync(join(WORKFLOW_DIR, name), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const m = USES.exec(line);
        if (!m || !SHA.test(m[2])) return;
        if (!/#\s*\S/.test(line.slice(line.indexOf(m[2]) + m[2].length))) {
          offenders.push(`${name}:${i + 1} ${m[1]}@${m[2].slice(0, 7)}`);
        }
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `a bare 40-hex SHA is unreadable in review; append \`# vX.Y.Z\`:\n  ${offenders.join('\n  ')}`,
  );
});
