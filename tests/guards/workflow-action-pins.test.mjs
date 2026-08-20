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
 * The rule is deliberately an ALLOWLIST, not "pin everything". The criterion is
 * BLAST RADIUS WITHOUT PR COVERAGE: an action used only in workflows that have no
 * `pull_request` trigger cannot be validated by a bump PR's own checks, so a bad
 * version merges green and breaks after the fact. Measured 2026-08-20, exactly two
 * actions here qualify — `changesets/action` (release.yml, `push: main` only) and
 * `peter-evans/create-pull-request` (revendor-canonical-schema.yml, schedule only).
 * `actions/checkout`, `actions/setup-node` and `pnpm/action-setup` also appear in
 * `ci.yml`, so a PR does exercise them; they stay on tags on purpose.
 * `.github/dependabot.yml` carries the matching major-version ignores.
 *
 * Read as a regression test: at b335c0e (pre-pin) the `changesets/action` case
 * FAILS with `pinned by tag/branch ref "v1"`.
 *
 * 🔴 KNOWN LIMITS — do not read past them:
 *   - It checks that a version label is PRESENT, never that it is ACCURATE. A
 *     correct SHA carrying a wrong `# vX.Y.Z` passes. Resolving a SHA to a tag
 *     needs the network and this suite is offline by design. Accuracy rests on
 *     Dependabot rewriting the `uses:` line it bumps; see the note in
 *     revendor-canonical-schema.yml.
 *   - It is a LINE regex, not a YAML parse, so a `uses:`-shaped line inside a
 *     `run: |` block scalar is collected too. That direction is safe — it fails
 *     loudly with a wrong file:line rather than passing silently — but if it ever
 *     fires on a heredoc, that is why.
 *   - `SHA` requires LOWERCASE hex. Git accepts uppercase; this repo does not, so
 *     the pin has one canonical spelling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/**
 * Actions reachable ONLY from workflows with no `pull_request` trigger, so no bump
 * PR's own checks can validate them. Each entry names why, so a future reader can
 * judge whether to remove it rather than deleting a rule whose purpose is
 * unrecorded. Keep in sync with the ignores in `.github/dependabot.yml`.
 */
const MUST_PIN = {
  'changesets/action':
    'only in release.yml (`push: main`), so no PR exercises it; and ' +
    'scripts/assert-published-versions.mjs depends on prepareBranch()/pushChanges() ' +
    'committing the version bump and leaving HEAD on it',
  'peter-evans/create-pull-request':
    'only in revendor-canonical-schema.yml (schedule + workflow_dispatch), so no PR ' +
    'exercises it; it also opens PRs with repo write credentials',
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
  // Floor is set just under the real population (34 as of 2026-08-20) rather than
  // at a token value: at `>= 10`, three of the four workflows could vanish and
  // this control would still report green.
  assert.ok(
    uses.length >= 25,
    `expected the workflow dir to yield many \`uses:\` refs, got ${uses.length}. ` +
      `The parser or the workflow layout changed; fix this before trusting the pin checks.`,
  );
  assert.ok(
    uses.some((u) => u.action === 'actions/checkout'),
    'expected actions/checkout among the parsed refs — the parser is not seeing real lines',
  );
});

test('MUST_PIN is non-empty (positive control on the allowlist itself)', () => {
  // The per-action tests below are GENERATED from MUST_PIN, so emptying it does not
  // fail anything — it silently removes the tests. Measured: `MUST_PIN = {}` drops
  // the suite from 4 tests to 2 and reports `pass 2 / fail 0`. The parser control
  // above cannot see this, because the parser is still fine.
  assert.ok(
    Object.keys(MUST_PIN).length >= 2,
    `MUST_PIN has ${Object.keys(MUST_PIN).length} entries; expected at least the two ` +
      `actions with no PR coverage (changesets/action, peter-evans/create-pull-request). ` +
      `Removing an entry must be a deliberate edit here, not a silent loss of coverage.`,
  );
  for (const reason of Object.values(MUST_PIN)) {
    assert.ok(reason && reason.length > 20, 'every MUST_PIN entry must record WHY it is listed');
  }
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

// NOTE the name: PRESENT, not correct. This asserts a label exists, never that it
// matches the SHA — a correct SHA with a wrong `# vX.Y.Z` passes here. See KNOWN
// LIMITS at the top of this file.
test('SHA-pinned actions carry a version label on the `uses:` line (present, not verified)', () => {
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
