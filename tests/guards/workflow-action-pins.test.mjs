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
 * `peter-evans/create-pull-request` (revendor-canonical-schema.yml, schedule +
 * workflow_dispatch — no `pull_request` either way).
 * `actions/checkout`, `actions/setup-node` and `pnpm/action-setup` also appear in
 * `ci.yml`, so a PR does exercise them; they stay on tags on purpose.
 *
 * Read as a regression test: at b335c0e (pre-pin) three of these fail. The
 * `changesets/action` case fails on a line containing the literal substring
 * `pins changesets/action@v1` — quoted as a substring on purpose, because a
 * paraphrase of a multi-line assertion message is not checkable, and two earlier
 * drafts of this line quoted strings that occurred zero times in the real output.
 * Re-derive rather than trust it:
 *   git worktree add --detach /tmp/vp b335c0e
 *   cp tests/guards/workflow-action-pins.test.mjs /tmp/vp/tests/guards/
 *   (cd /tmp/vp && node --test tests/guards/workflow-action-pins.test.mjs)
 *   git worktree remove --force /tmp/vp
 *
 * 🔴 KNOWN LIMITS — do not read past them:
 *   - 🔴 NO CHECK HERE PROVES A LABEL NAMES THE RELEASE ITS SHA ACTUALLY BELONGS TO.
 *     That needs the network; this suite is offline by design. What IS enforced, and
 *     the residue, measured per action rather than asserted in general:
 *       · a label edited alone, or a `PINNED.version` edited alone → caught, both
 *         actions (they must agree).
 *       · label AND `PINNED.version` edited together → for `changesets/action`,
 *         caught, because `RELEASING.md` carries a third copy this file cross-checks.
 *         For `peter-evans/create-pull-request` there is no third copy, so it
 *         SURVIVES — verified, 6/6 green under exactly that mutation.
 *       · any other SHA-pinned action (none today): only that SOME label is present.
 *     Two earlier drafts of this block were wrong in BOTH directions — one claimed a
 *     wrong label "is caught" full stop (two mutants survived it), the next claimed
 *     the both-together case always lies (it does not, for changesets/action). An
 *     overstated LIMIT is still a false claim; that is why this is enumerated.
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
 * to changesets/action v2.1.1 satisfied a shape-only guard 5/5, while v2 renames
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

/**
 * Every `uses:` occurrence across the workflow dir, as
 * {action, ref, label, file, line}. `label` is the trailing `# …` token on the same
 * line (the version annotation), or null when there is none.
 */
function collectUses() {
  const out = [];
  for (const name of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(join(WORKFLOW_DIR, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = USES.exec(line);
      if (!m || m[1].startsWith('./')) return;
      // Only the text AFTER the ref, so a `#` inside the ref itself cannot be read
      // as a label.
      const after = line.slice(line.indexOf(m[2]) + m[2].length);
      const c = /#\s*(\S+)/.exec(after);
      out.push({ action: m[1], ref: m[2], label: c ? c[1] : null, file: name, line: i + 1 });
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

// INVARIANT GUARD, not regression coverage: this passes at b335c0e too (ci.yml already
// ran test:guards there). It pins a property no bug has yet violated. Counted as such.
test('this suite is actually wired into a PR-triggered CI job (guard the guard)', () => {
  // Removing the dependabot `ignore` made THIS FILE the sole control on the pins.
  // The `ignore` lived server-side and could not be disarmed from the repo; this can
  // — deleting the `pnpm test:guards` step from ci.yml leaves all five Starter legs
  // reporting and green, so the pin assertion silently stops running. Nothing else
  // reads ci.yml, so nothing else would notice.
  // 🔴 Assert STATE, not spelling. An earlier version matched `/pnpm test:guards/`
  // anywhere in the file and a `pull_request` anywhere in the file. Three ordinary
  // disarms walked straight past it, each passing a full green suite:
  //   - commenting the step out (`# - run: pnpm test:guards`) — the string is still there
  //   - adding `if: github.event_name == 'push'` to the step — both matches still hold
  //   - narrowing the `test:guards` npm script so it no longer globs this file at all
  const ciLines = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8').split(/\r?\n/);

  // (a) A LIVE run step — not a comment — invoking the script.
  const stepIdx = ciLines.findIndex((l) => /^\s*-\s*run:\s*pnpm\s+test:guards\s*$/.test(l));
  assert.ok(
    stepIdx !== -1,
    'ci.yml has no live `- run: pnpm test:guards` step (a commented-out one does not ' +
      'count). The exact-sha pins in this file are only enforced because this suite ' +
      'runs on pull_request. If the step moved, point this assertion at its new home — ' +
      'do not delete it.',
  );

  // (b) That step must be unconditional. An `if:` on it re-opens the gap silently.
  const indent = ciLines[stepIdx].match(/^\s*/)[0].length;
  const sameStep = [];
  for (let i = stepIdx + 1; i < ciLines.length; i++) {
    const l = ciLines[i];
    if (!l.trim()) continue;
    if (l.match(/^\s*/)[0].length <= indent) break; // next step / dedent ends this one
    sameStep.push(l);
  }
  assert.deepEqual(
    sameStep.filter((l) => /^\s*if\s*:/.test(l)),
    [],
    'the `pnpm test:guards` step in ci.yml has an `if:` condition. A guard that can be ' +
      'skipped per-event is not a guard — it would let a bump merge green on a PR.',
  );

  // (c) The npm script must still reach THIS file. Narrowing the glob in package.json
  // disables the pins without touching any workflow.
  const script = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts?.[
    'test:guards'
  ];
  assert.ok(
    script && /tests\/guards\/\*/.test(script),
    `package.json \`test:guards\` is ${JSON.stringify(script)} — it must glob ` +
      '`tests/guards/*` so this file is actually executed. Narrowing it to named files ' +
      'silently drops the pin assertions while ci.yml still looks correct.',
  );

  // (d) `pull_request` must be in the `on:` BLOCK, not merely somewhere in the file.
  // Scoped to the block so a `pull_request:` inside a `run: |` heredoc cannot satisfy
  // it, and written to accept the legal spellings (`"on":`, flow-style sequence).
  const onIdx = ciLines.findIndex((l) => /^["']?on["']?\s*:/.test(l));
  assert.ok(onIdx !== -1, 'ci.yml has no top-level `on:` key');
  const onBlock = [ciLines[onIdx]];
  for (let i = onIdx + 1; i < ciLines.length; i++) {
    if (/^\S/.test(ciLines[i])) break; // next top-level key
    onBlock.push(ciLines[i]);
  }
  assert.ok(
    onBlock.some((l) => /(^|[\s[,])pull_request\s*(:|,|\]|$)/.test(l)),
    'ci.yml lost its `pull_request` trigger — this suite would then only run ' +
      'post-merge, which is the exact gap PINNED exists to close. (Checked inside the ' +
      `\`on:\` block only; block read was: ${JSON.stringify(onBlock.join('\n'))})`,
  );
});

test('PINNED is non-empty (positive control on the allowlist itself)', () => {
  // The per-action tests below are GENERATED from PINNED, so emptying it does not
  // fail anything — it silently REMOVES those tests, and a suite that runs fewer tests
  // still reports green. This floor is the only thing that then fails.
  //
  // 🔴 Deliberately no test-count numbers here. Two successive rounds wrote a
  // "measured: N tests -> M" figure into this comment and both were stale by the time
  // they landed, because the same commit that cited them also added a test. A count is
  // a fact about a tree, not about the mechanism; the mechanism is what this documents.
  // The parser control above cannot see this failure — the parser is still fine.
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
      // ORDER MATTERS: sha first. A real bump moves the sha AND the label together, so
      // whichever assertion runs first is the one whose message the bumper actually
      // reads — and the sha message is the one carrying `why` and the read-the-upstream
      // -diff instruction. Label-first also made the base-tree failure the LABEL message
      // (no label existed at b335c0e), so the sha message was unreachable at base and a
      // docblock quoting it was wrong twice running.
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
      // The label must match the version recorded beside the sha in PINNED. Without
      // this, a wrong `# vX.Y.Z` on a correct sha passes — measured, and exactly the
      // two-majors-stale state `7be170e` left this repo in for months.
      assert.equal(
        u.label,
        version,
        `${u.file}:${u.line} labels ${action} as "${u.label}" but PINNED records ` +
          `${version} for sha ${sha.slice(0, 7)}.\n` +
          `  The label and PINNED.version must agree. If you are bumping, change BOTH ` +
          `(and PINNED.sha); if only the label is wrong, fix the label.\n` +
          `  NOTE: this ties the label to PINNED, offline. It does NOT prove either one ` +
          `names the release that sha actually belongs to — that needs the network. ` +
          `Changing PINNED.version and the label together still lies successfully.`,
      );
    }

    // The runbook repeats the pin. Nothing else asserts that copy, so it rots silently
    // on the next bump — the same citation-rot this PR swept out of RELEASING.md and
    // .changeset/README.md. Keep it checkable rather than trusting a future bumper.
    if (action === 'changesets/action') {
      const releasing = readFileSync(join(REPO_ROOT, 'RELEASING.md'), 'utf8');
      assert.ok(
        new RegExp(`${sha.slice(0, 7)}[^\\n]*${version.replace('.', '\\.')}`).test(releasing),
        `RELEASING.md no longer names this pin as \`${sha.slice(0, 7)}\` (${version}) on one ` +
          `line. Update the runbook in the same commit as the bump — a stale sha there is ` +
          `read by a human doing a release, which is the worst place for it.`,
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
