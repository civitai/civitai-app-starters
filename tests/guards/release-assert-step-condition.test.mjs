/**
 * Guards the `if:` on release.yml's post-publish registry assertion.
 *
 * WHY THIS EXISTS — a measured defect, not a hypothetical. `release.yml`'s step
 * `Assert the published versions actually exist on npm` (`pnpm assert:published`)
 * had NO `if:`, and a GitHub Actions step with no `if:` defaults to
 * `if: success()`. So the moment `changeset publish` exited non-zero, the one
 * thing that asks the REGISTRY what actually landed was SKIPPED — precisely when
 * the registry state is unknown and possibly inconsistent.
 *
 * Measured on release run 33785932215 (2026-09-03):
 *   attempt 1  publish "succeeded" (2 of 4 packages really landed) -> this step
 *              RAN and correctly failed: 35 log lines, `PUBLISH DID NOT HAPPEN`.
 *   attempt 2  publish FAILED (`E409 Cannot publish over previously staged
 *              version "0.4.1"`) after taking `blocks-react@0.45.1` live -> this
 *              step contributed 0 lines and is absent from the run's step list.
 * That second run is the one that broke every consumer (a live dependent
 * exact-pinning a staged dependency -> ETARGET on install), and it is exactly the
 * run where the guard did not run.
 *
 * 🔴 THIS ASSERTS THE STEP'S OWN PARSED `if:` VALUE, NOT A SUBSTRING OF THE FILE.
 * A file-wide grep for `always` passes while the step is conditioned on something
 * else entirely (another step's `if:`, a comment, a job-level `if:`, the word
 * inside a `run:` block). So the step is located by name, its own block is walked
 * indentation-aware, and the scalar on ITS `if:` key is compared against an
 * explicit allowlist of conditions that are known to run after a previous step
 * failed. Same walk shape as `workflow-action-pins.test.mjs`'s step-level check,
 * for the same reason: comments are skipped rather than treated as terminators,
 * because YAML ignores comment indentation and a `# note` at the step's own
 * indent would otherwise end the walk early and hide the line after it.
 *
 * 🔴 KNOWN LIMITS — do not read past them:
 *   - It is a LINE walk, not a YAML parse (this suite has no YAML dependency, by
 *     the same offline-by-design constraint as the rest of tests/guards). An
 *     `if:`-shaped line inside a `run: |` block scalar nested in this step would
 *     be collected. That direction is safe: it fails loudly rather than passing
 *     silently. The step under guard is a one-line `run:`, so it cannot happen
 *     today.
 *   - The allowlist is about WHEN the step runs, not about whether the step is
 *     correct. It says nothing about `assert-published-versions.mjs` itself —
 *     `tests/guards/assert-published-versions.test.mjs` owns that.
 *   - Nothing here proves the step runs in a real workflow run; that needs
 *     Actions, and `release.yml` has no `pull_request` trigger. This is the same
 *     structural gap `workflow-action-pins.test.mjs` documents, closed the same
 *     way: assert the file, from a PR-triggered required job.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE_YML = join(REPO_ROOT, '.github', 'workflows', 'release.yml');

/** The step this file is about, matched on its `- name:` line. */
const STEP_NAME = 'Assert the published versions actually exist on npm';

/**
 * Conditions that make a step run when an EARLIER STEP FAILED. Exact, normalised
 * strings — deliberately an allowlist and not a shape check, because "contains
 * the word always" is satisfiable by conditions that do not have this property
 * at all.
 *
 * `!cancelled()` is what release.yml uses and why: `always()` also runs through a
 * cancellation, and this step sleeps under a 10-minute cap while the release
 * `concurrency` lane has no `cancel-in-progress`, so a cancelled run would hold
 * the lane against a release a human deliberately stopped. `always()` stays on
 * the list because it satisfies the invariant this test is named for; choosing it
 * is a judgement call, not a regression.
 */
const RUNS_AFTER_FAILURE = new Set([
  '${{ !cancelled() }}',
  '${{ ! cancelled() }}',
  'always()',
  '${{ always() }}',
  '${{ success() || failure() }}',
  '${{ failure() || success() }}',
]);

/**
 * Returns the lines belonging to the named step's own mapping (everything more
 * indented than its `- name:` line), or null when the step is not found.
 */
function stepBodyLines(lines, name) {
  const idx = lines.findIndex((l) => new RegExp(`^\\s*-\\s*name:\\s*['"]?${name}['"]?\\s*$`).test(l));
  if (idx === -1) return null;
  const indent = lines[idx].match(/^\s*/)[0].length;
  const body = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue; // blank + comment lines are not terminators
    if (l.match(/^\s*/)[0].length <= indent) break; // dedent / next step
    body.push(l);
  }
  return body;
}

test('release.yml still has the post-publish registry-assertion step (positive control)', () => {
  // Without this, every assertion below would pass vacuously over an empty set
  // the moment the step were renamed or deleted — the reassuring-zero failure
  // mode. If the step is legitimately renamed, move STEP_NAME with it; do not
  // delete this file.
  const lines = readFileSync(RELEASE_YML, 'utf8').split(/\r?\n/);
  const body = stepBodyLines(lines, STEP_NAME);
  assert.ok(
    body !== null,
    `release.yml has no step named "${STEP_NAME}". That step is the only thing that ` +
      `asks the REGISTRY whether a release landed; nothing else in the toolchain can ` +
      `see a staged or failed publish. If it was renamed, update STEP_NAME in ` +
      `tests/guards/release-assert-step-condition.test.mjs in the same commit.`,
  );
  assert.ok(
    body.some((l) => /^\s*run:\s*pnpm\s+assert:published\s*$/.test(l)),
    `the "${STEP_NAME}" step no longer runs \`pnpm assert:published\`. This guard would ` +
      `otherwise keep pinning the \`if:\` of a step that no longer does the check.\n` +
      `  step body read: ${JSON.stringify(body.join('\n'))}`,
  );
});

test('the registry assertion runs even when the publish step FAILED', () => {
  const lines = readFileSync(RELEASE_YML, 'utf8').split(/\r?\n/);
  const body = stepBodyLines(lines, STEP_NAME);
  assert.ok(body !== null, `release.yml has no step named "${STEP_NAME}" (see the control above)`);

  const ifLines = body.filter((l) => /^\s*if\s*:/.test(l));
  assert.equal(
    ifLines.length,
    1,
    ifLines.length === 0
      ? `the "${STEP_NAME}" step in release.yml has NO \`if:\`.\n` +
          `  A step with no \`if:\` defaults to \`if: success()\`, so it is SKIPPED whenever an\n` +
          `  earlier step failed — i.e. exactly when the registry state is unknown and this\n` +
          `  check matters most. Measured on release run 33785932215: attempt 1 (publish\n` +
          `  "succeeded") ran this step and caught a half-landed release in 35 log lines;\n` +
          `  attempt 2 (publish failed with E409 over a STAGED version, after taking\n` +
          `  blocks-react@0.45.1 live) contributed 0 lines and the step is absent from the\n` +
          `  run's step list. That second run is the one that broke consumers.\n` +
          `  Add \`if: \${{ !cancelled() }}\` to the step.`
      : `the "${STEP_NAME}" step in release.yml has ${ifLines.length} \`if:\` lines; expected ` +
          `exactly one. Lines: ${JSON.stringify(ifLines)}`,
  );

  // Normalise the scalar: strip the key, surrounding whitespace, a trailing
  // comment, and optional quotes. What is left is the condition itself.
  const raw = ifLines[0].replace(/^\s*if\s*:\s*/, '').trim();
  const cond = raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();

  assert.ok(
    RUNS_AFTER_FAILURE.has(cond),
    `the "${STEP_NAME}" step in release.yml is conditioned on \`${cond}\`, which is not a ` +
      `condition known to run after a previous step FAILED.\n` +
      `  This step exists to answer "what actually landed on npm?", and a failed publish is ` +
      `the state that most needs that answer — see the docblock at the top of this file for ` +
      `run 33785932215, where the skipped run is the one that broke every consumer.\n` +
      `  Allowed: ${[...RUNS_AFTER_FAILURE].join(', ')}\n` +
      `  release.yml uses \`\${{ !cancelled() }}\` deliberately: \`always()\` would also run ` +
      `through a CANCELLATION, and this step can sleep for minutes under a 10-minute cap ` +
      `while the release \`concurrency\` lane has no \`cancel-in-progress\`, so subsequent ` +
      `releases queue behind it.\n` +
      `  If you are widening this on purpose, add the new condition to RUNS_AFTER_FAILURE ` +
      `here — editing this file is the acknowledgement.`,
  );
});

test('the step body walk can actually see an `if:` (positive control on the parser)', () => {
  // The walk above returns [] for a step it cannot parse, and `[].filter(...)`
  // is a perfectly green empty list — so the assertions above would report a
  // clean "expected exactly one" failure for a parser bug and a real regression
  // alike. Feed the same walk a synthetic step whose `if:` is on a line AFTER a
  // comment sitting at the step's own indent, which is the exact shape the
  // comment-skipping exists for, and watch it come back.
  const synthetic = [
    'jobs:',
    '  release:',
    '    steps:',
    '      - name: Synthetic control step',
    '      # a comment at the step indent — YAML ignores its indentation',
    '        if: ${{ !cancelled() }}',
    '        run: true',
    '      - name: Next step',
    '        run: true',
  ];
  const body = stepBodyLines(synthetic, 'Synthetic control step');
  assert.deepEqual(
    body,
    ['        if: ${{ !cancelled() }}', '        run: true'],
    'the step-body walk did not return the synthetic step\'s own lines — it is either ' +
      'stopping at the comment or running past the next step, so every verdict it ' +
      'produces above is a fact about the parser, not about release.yml',
  );
});
