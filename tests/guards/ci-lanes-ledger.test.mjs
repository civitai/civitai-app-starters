/**
 * The LEDGER guard: `.github/workflows/ci.yml` against `JOBS` in
 * `scripts/ci-lanes.mjs`.
 *
 * WHAT IT IS FOR. `scripts/ci-lanes.mjs` decides which jobs a CI run needs and
 * ci.yml's jobs each read one output of the `lanes` job. That is a RELATIONSHIP
 * between two files, and each half can drift alone:
 *
 *   - a job added to ci.yml with no condition runs in every lane (the scheduled
 *     run included) and nobody decided that;
 *   - a job added to the ledger with no `lanes` output reads an empty string,
 *     so the script "skips" it and it runs anyway;
 *   - a condition rewritten to `== 'true'`, or to one with no status function,
 *     turns FAIL-OPEN into fail-skip: a broken classifier then reports every
 *     required context as `skipped`, which branch protection accepts.
 *
 * So the job set is compared in BOTH directions (grow and shrink fail under
 * different messages), every condition is compared as a whole string, and the
 * `lanes` outputs are compared key by key.
 *
 * 🔴 EVERY CHECK HAS A NEGATIVE CONTROL IN THIS FILE. The structural checks live
 * in `lib/ci-workflow.mjs` as a function returning problem strings; the tests at
 * the bottom hand it the real ci.yml with ONE thing broken and assert that the
 * breakage is reported under its own tag. A green "0 problems" over the real
 * file is only worth something beside those.
 *
 * NOT COVERED HERE: that GitHub evaluates the condition the way the comment in
 * ci.yml says (a failed or skipped `needs` job still runs its dependents). That
 * is expression semantics and only a real run shows it; the pull request that
 * introduced this records the runs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { JOBS, ADVISORY_JOBS, CORE_JOBS, STEP_GATED_JOBS, UNGATED_STEPS, RELEASE_LANE_JOBS, classifyPath } from '../../scripts/ci-lanes.mjs';
import { parseJobs, parseSteps, problems as rawProblems, laneCondition, stepIsGated, LANES_JOB } from './lib/ci-workflow.mjs';

const SHAPE = { stepGated: STEP_GATED_JOBS, ungatedSteps: UNGATED_STEPS };
const problems = (t, ledger) => rawProblems(t, ledger, SHAPE);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI_YML = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const text = readFileSync(CI_YML, 'utf8');

/**
 * The advisory five, written out. Deliberately a second copy of what `JOBS`
 * says: moving a job between kinds changes which pull requests run it, so it
 * takes an edit here as well as there.
 */
const ADVISORY_PINNED = [
  'design-system-cross-browser',
  'design-system-drift-guard',
  'orchestrator-catalog-drift',
  'schema-drift',
  'starter-pins',
];

/**
 * The contexts branch protection on `main` requires, by job id. They may never
 * be advisory (path-scoped), and their display names may never change.
 */
const REQUIRED = {
  sdk: 'SDK (typecheck + test + build)',
  'blocks-react': 'blocks-react (typecheck + test + build)',
  'readme-snippets': 'README snippets (typecheck)',
  starter: 'Starter',
  'design-system': 'design-system (theme + components + components-react)',
  packaging: 'Packaging (shipped sourcemaps)',
  'public-types': 'Public type closure (built .d.ts)',
};

describe('ci.yml agrees with the lane ledger', () => {
  test('POSITIVE CONTROL: the walk finds the jobs, their conditions and the lanes outputs', () => {
    const jobs = parseJobs(text);
    assert.ok(jobs.length >= 15, `parsed ${jobs.length} jobs, expected >= 15; the walk is broken, not the workflow`);
    const sdk = jobs.find((j) => j.id === 'sdk');
    assert.ok(sdk, 'no `sdk` job parsed');
    assert.deepEqual(sdk.needs, [LANES_JOB]);
    assert.equal(sdk.if, "${{ !cancelled() && needs.lanes.outputs.sdk != 'false' }}");
    const lanes = jobs.find((j) => j.id === LANES_JOB);
    assert.equal(lanes.outputs.sdk, '${{ steps.decide.outputs.sdk }}');
    const steps = parseSteps(jobs.find((j) => j.id === 'starter'));
    assert.ok(steps.length >= 12, `parsed ${steps.length} steps in the starter job, expected >= 12`);
    assert.equal(steps.filter((s) => stepIsGated(s.if, 'starter')).length, steps.length - UNGATED_STEPS.length);
    assert.ok(steps.some((s) => s.label === 'pnpm test:guards' && s.if === null));
  });

  test('the step-gated set and its every-lane steps are the pinned ones', () => {
    // A second copy on purpose, like ADVISORY_PINNED: which steps survive a
    // lane that turned the job off is a decision, not a derivation.
    assert.deepEqual([...STEP_GATED_JOBS], ['starter']);
    assert.deepEqual([...UNGATED_STEPS], [
      'actions/checkout',
      'pnpm/action-setup',
      'actions/setup-node',
      'pnpm test:guards',
      'node scripts/check-starter-workspace-overrides.mjs',
    ]);
  });

  test('the job set, every condition and every lanes output match the ledger', () => {
    assert.deepEqual(problems(text, JOBS), []);
  });

  test('the advisory set is exactly the pinned five; everything else is core', () => {
    assert.deepEqual([...ADVISORY_JOBS].sort(), ADVISORY_PINNED);
    assert.equal(ADVISORY_JOBS.length + CORE_JOBS.length, Object.keys(JOBS).length);
    for (const kind of Object.values(JOBS)) assert.ok(['core', 'advisory'].includes(kind), `unknown kind ${kind}`);
  });

  test('the release lane runs exactly the pinned set, and it covers both release guards', () => {
    // A second copy on purpose. Widening or narrowing what a Version Packages
    // PR runs is the operator's trade, so it takes an edit here too.
    assert.deepEqual([...RELEASE_LANE_JOBS].sort(), ['packaging', 'starter-pins']);
    for (const id of RELEASE_LANE_JOBS) assert.ok(id in JOBS, `release-lane job ${id} is not in the ledger`);
    // The override guard and `pnpm test:guards` are not release-lane JOBS: they
    // are every-lane STEPS of the starter matrix, which is what keeps them
    // running when the release lane turns the matrix's heavy steps off.
    assert.ok(UNGATED_STEPS.includes('node scripts/check-starter-workspace-overrides.mjs'));
    assert.ok(UNGATED_STEPS.includes('pnpm test:guards'));
    assert.ok(!RELEASE_LANE_JOBS.includes('starter'), 'starter is step-gated; listing it would run its heavy steps');
  });

  test('no required context is path-scoped, and none was renamed', () => {
    const jobs = parseJobs(text);
    for (const [id, name] of Object.entries(REQUIRED)) {
      assert.equal(JOBS[id], 'core', `required job \`${id}\` must be core, not ${JOBS[id]}`);
      assert.equal(
        jobs.find((j) => j.id === id)?.name,
        name,
        `job \`${id}\` is a required context under the name "${name}"; renaming it leaves that context pending on every PR`,
      );
    }
  });
});

describe('every file an advisory job reads selects that job', () => {
  // The table in ci-lanes.mjs says, with `scripts/**` and several package
  // directories, that NO advisory job reads them. That is only true while the
  // advisory jobs' own steps agree, so read the steps.
  const jobs = parseJobs(text).filter((j) => ADVISORY_JOBS.includes(j.id));
  const packageDirs = Object.fromEntries(
    readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(REPO_ROOT, 'packages', e.name, 'package.json')))
      .map((e) => [JSON.parse(readFileSync(join(REPO_ROOT, 'packages', e.name, 'package.json'), 'utf8')).name, e.name]),
  );

  /** `scripts/x` and, one level down, the relative modules it imports. */
  function scriptClosure(rel) {
    const out = [rel];
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs) || !/\.m?js$/.test(rel)) return out;
    for (const m of readFileSync(abs, 'utf8').matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
      out.push(join(dirname(rel), m[1]).replaceAll('\\', '/'));
    }
    return out;
  }

  test('POSITIVE CONTROL: the advisory jobs reference scripts and packages at all', () => {
    assert.equal(jobs.length, 5);
    const all = jobs.flatMap((j) => j.body.join('\n').match(/scripts\/[\w./-]+/g) ?? []);
    assert.ok(all.length >= 3, `found ${all.length} script references in the advisory jobs, expected >= 3`);
    assert.ok(Object.keys(packageDirs).includes('@civitai/theme'), 'packages/*/package.json names were not read');
  });

  for (const job of jobs) {
    test(`${job.id}: its scripts and filtered packages classify to it`, () => {
      // Comment lines describe; only live step lines say what the job runs.
      const live = job.body.filter((l) => !/^\s*#/.test(l)).join('\n');
      const scripts = [...new Set(live.match(/scripts\/[\w./-]+/g) ?? [])].flatMap(scriptClosure);
      const filtered = [...live.matchAll(/--filter\s+(@[\w./-]+)/g)].map((m) => m[1]);
      const paths = [
        ...scripts,
        ...filtered.flatMap((name) => {
          assert.ok(packageDirs[name], `job ${job.id} filters ${name}, which is not a workspace package`);
          return [`packages/${packageDirs[name]}/package.json`, `packages/${packageDirs[name]}/src/any/file.ts`];
        }),
        ...(/pnpm install/.test(live) ? ['pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml'] : []),
      ];
      const missed = paths.filter((p) => !classifyPath(p).jobs.includes(job.id));
      assert.deepEqual(
        missed,
        [],
        `job \`${job.id}\` reads these paths, but a pull request touching them would not run it. ` +
          'Add a rule for each to RULES in scripts/ci-lanes.mjs.',
      );
    });
  }
});

describe('NEGATIVE CONTROLS: each breakage is reported under its own tag', () => {
  // Only what the breakage ADDS. If the real ci.yml is itself broken, that is
  // the ledger test's failure to report, once, and these stay about the controls.
  const baseline = problems(text, JOBS);
  const tags = (t, ledger = JOBS) =>
    problems(t, ledger)
      .filter((p) => !baseline.includes(p))
      .map((p) => p.match(/^\[([a-z-]+)\]/)?.[1]);
  /** Replace exactly one occurrence, and fail the control itself if the anchor moved. */
  const mutate = (from, to) => {
    assert.equal(text.split(from).length - 1, 1, `control anchor occurs ${text.split(from).length - 1} times: ${from}`);
    return text.replace(from, to);
  };
  const sdkIf = `    if: ${laneCondition('sdk')}\n`;

  test('a job added to ci.yml but not to the ledger', () => {
    const grown = `${text}\n  brand-new:\n    name: New\n    needs: lanes\n    if: ${laneCondition('brand-new')}\n    runs-on: ubuntu-latest\n`;
    assert.deepEqual(tags(grown), ['job-not-in-ledger']);
  });

  test('a job in the ledger that ci.yml does not have', () => {
    assert.deepEqual(tags(text, { ...JOBS, ghost: 'core' }), ['ledger-job-not-in-workflow', 'output-missing']);
  });

  test('a job with no condition at all', () => {
    assert.deepEqual(tags(mutate(sdkIf, '')), ['no-condition']);
  });

  test("a condition rewritten to == 'true' (fail-skip)", () => {
    assert.deepEqual(
      tags(mutate(sdkIf, "    if: ${{ !cancelled() && needs.lanes.outputs.sdk == 'true' }}\n")),
      ['condition-shape'],
    );
  });

  test('a condition with no status function (skipped whenever lanes fails)', () => {
    assert.deepEqual(tags(mutate(sdkIf, "    if: ${{ needs.lanes.outputs.sdk != 'false' }}\n")), ['condition-shape']);
  });

  test("a condition reading ANOTHER job's output", () => {
    assert.deepEqual(
      tags(mutate(sdkIf, "    if: ${{ !cancelled() && needs.lanes.outputs.packaging != 'false' }}\n")),
      ['condition-shape'],
    );
  });

  test('a job that dropped `needs: lanes`', () => {
    assert.deepEqual(tags(mutate(`    needs: lanes\n${sdkIf}`, sdkIf)), ['needs-lanes']);
  });

  test('a lanes output that was deleted, and one wired to the wrong step output', () => {
    const line = '      sdk: ${{ steps.decide.outputs.sdk }}\n';
    assert.deepEqual(tags(mutate(line, '')), ['output-missing']);
    assert.deepEqual(tags(mutate(line, '      sdk: ${{ steps.decide.outputs.packaging }}\n')), ['output-crossed']);
  });

  test('a workflow-level paths filter', () => {
    assert.deepEqual(tags(mutate('  pull_request:\n', "  pull_request:\n    paths: ['packages/**']\n")), [
      'workflow-paths-filter',
    ]);
  });

  test('the matrix job given a job-level lane condition (five required contexts would never report)', () => {
    assert.deepEqual(tags(mutate('    if: ${{ !cancelled() }}\n', `    if: ${laneCondition('starter')}\n`)), ['condition-shape']);
  });

  test('the matrix job with no status function (skipped, guards included, when lanes fails)', () => {
    assert.deepEqual(tags(mutate('    if: ${{ !cancelled() }}\n', '')), ['no-condition']);
  });

  test('a heavy step of the matrix job that ignores the lane output', () => {
    const gated = "      - name: Typecheck\n        if: ${{ needs.lanes.outputs.starter != 'false' }}\n";
    assert.deepEqual(tags(mutate(gated, '      - name: Typecheck\n')), ['step-ungated']);
    // A matrix condition alone is not the lane clause.
    const probe = "        if: ${{ needs.lanes.outputs.starter != 'false' && matrix.starter == 'next-app' }}\n";
    assert.deepEqual(tags(mutate(probe, "        if: matrix.starter == 'next-app'\n")), ['step-ungated']);
    // OR-ing the clause in is not gating either.
    assert.deepEqual(
      tags(mutate(probe, "        if: ${{ needs.lanes.outputs.starter != 'false' || matrix.starter == 'next-app' }}\n")),
      ['step-ungated'],
    );
  });

  test('a new step added to the matrix job without a lane decision', () => {
    const anchor = '      - name: Lint (if defined)\n';
    assert.deepEqual(tags(mutate(anchor, `      - run: pnpm audit\n\n${anchor}`)), ['step-ungated']);
  });

  test('the guards step made conditional, or removed', () => {
    const step = '      - run: pnpm test:guards\n';
    assert.deepEqual(tags(mutate(step, `${step}        if: \${{ needs.lanes.outputs.starter != 'false' }}\n`)), [
      'always-step-conditional',
    ]);
    assert.deepEqual(tags(mutate(step, '')), ['always-step-missing']);
  });

  test('the lanes job made conditional, or no longer running the script', () => {
    const header = '    name: CI lanes (which jobs this run needs)\n';
    assert.deepEqual(tags(mutate(header, `${header}    if: github.event_name == 'pull_request'\n`)), ['lanes-conditional']);
    assert.deepEqual(tags(mutate('        run: node scripts/ci-lanes.mjs\n', '        run: echo skipped\n')), ['lanes-script']);
  });
});
