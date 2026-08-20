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
 *
 * Read as a regression test: at b335c0e (pre-pin) the `changesets/action` case
 * FAILS with `pinned by tag/branch ref "v1"`.
 *
 * 🔴 KNOWN LIMITS — do not read past them:
 *   - The version-label check asserts the label is PRESENT, never that it is
 *     ACCURATE — resolving a SHA to a tag needs the network and this suite is
 *     offline by design. For the two PINNED actions this does not matter: their
 *     `version` is asserted against an exact `sha` above, so a wrong label there is
 *     caught. It matters only for any future SHA-pinned action NOT in PINNED.
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
 * Actions reachable ONLY from workflows with no `pull_request` trigger, pinned to an
 * EXACT commit. This file runs inside `ci.yml`'s `Starter` job, which IS
 * `pull_request`-triggered and IS a required context — so pinning the exact SHA here
 * is what supplies the PR coverage those workflows structurally lack. Any bump,
 * Dependabot's or a human's, turns a required check red on the PR that proposes it.
 *
 * 🔴 This is deliberately an exact-value assertion, not a shape check. A shape check
 * (`is it 40 hex?`) passes a bump to a BREAKING version — measured: swapping the pin
 * to changesets/action v2.1.1 satisfied a shape-only guard 4/4, while v2 renames
 * every input release.yml passes and would wedge the release lane after merge.
 *
 * Deliberately NOT solved with a `.github/dependabot.yml` ignore. That was the first
 * attempt and it is blunter than it looks: `v1.9.0` is the LAST v1.x tag upstream
 * (next is v2.0.0), so ignoring majors means zero bump PRs for this action ever; and
 * per GitHub's options reference `ignore` also suppresses Dependabot SECURITY update
 * PRs. Blocking the merge is what we want; blocking the notification is not.
 *
 * To bump one of these: read the upstream diff for the behaviour named in `why`,
 * confirm it still holds, then update `sha` + `version` here and the `uses:` line.
 * Editing this file is the acknowledgement.
 */
const PINNED = {
  'changesets/action': {
    sha: 'a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d',
    version: 'v1.9.0',
    why:
      'only in release.yml (`push: main`), so no PR exercises it; and ' +
      'scripts/assert-published-versions.mjs depends on prepareBranch()/pushChanges() ' +
      'committing the version bump and leaving HEAD on it — a MINOR bump can change ' +
      'those internals just as freely as a major, which is why this pins the exact sha',
  },
  'peter-evans/create-pull-request': {
    sha: '5f6978faf089d4d20b00c7766989d076bb2fc7f1',
    version: 'v8.1.1',
    why:
      'only in revendor-canonical-schema.yml (schedule + workflow_dispatch), so no PR ' +
      'exercises it; it also opens PRs with repo write credentials',
  },
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

test('PINNED is non-empty (positive control on the allowlist itself)', () => {
  // The per-action tests below are GENERATED from PINNED, so emptying it does not
  // fail anything — it silently removes the tests. Measured: `PINNED = {}` drops
  // the suite from 5 tests to 2 and reports `pass 2 / fail 0`. The parser control
  // above cannot see this, because the parser is still fine.
  assert.ok(
    Object.keys(PINNED).length >= 2,
    `PINNED has ${Object.keys(PINNED).length} entries; expected at least the two ` +
      `actions with no PR coverage (changesets/action, peter-evans/create-pull-request). ` +
      `Removing an entry must be a deliberate edit here, not a silent loss of coverage — ` +
      `and if you are legitimately retiring one (e.g. deleting the workflow it lives in), ` +
      `lower this floor in the same commit rather than working around it.`,
  );
  for (const [action, e] of Object.entries(PINNED)) {
    assert.match(e.sha, SHA, `${action}: PINNED.sha must be a lowercase 40-hex commit`);
    assert.ok(e.version, `${action}: PINNED.version must name the release the sha corresponds to`);
    assert.ok(e.why && e.why.length > 20, `${action}: PINNED entry must record WHY it is listed`);
  }
});

for (const [action, { sha, version, why }] of Object.entries(PINNED)) {
  test(`${action} is pinned to exactly ${sha.slice(0, 7)} (${version})`, () => {
    const found = collectUses().filter((u) => u.action === action);

    // Presence check FIRST. A rename or a deleted workflow would otherwise leave
    // zero occurrences and report green while the pin was gone.
    assert.ok(
      found.length > 0,
      `PINNED lists ${action} but no workflow references it. Either restore the ` +
        `reference or remove it from PINNED deliberately. Reason it was listed: ${why}`,
    );

    for (const u of found) {
      assert.equal(
        u.ref,
        sha,
        `${u.file}:${u.line} pins ${action}@${u.ref}\n` +
          `  expected exactly ${sha} (${version})\n` +
          `  Why this action is pinned to an exact commit: ${why}\n` +
          `  The workflow this lives in has no \`pull_request\` trigger, so NOTHING ELSE in a\n` +
          `  PR exercises it — this assertion is that PR's only coverage. A shape-only check\n` +
          `  ("is it 40 hex?") would pass a bump to a breaking version.\n` +
          `  If this bump is intended: read the upstream diff for the behaviour named above,\n` +
          `  confirm it still holds, then update PINNED.sha + PINNED.version in\n` +
          `  tests/guards/workflow-action-pins.test.mjs and the \`# ${version}\` label on the\n` +
          `  \`uses:\` line. Editing this file is the acknowledgement.`,
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
