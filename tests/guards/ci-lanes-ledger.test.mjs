/**
 * The LEDGER guard: `.github/workflows/ci.yml` against `JOBS` in
 * `scripts/ci-lanes.mjs`.
 *
 * WHAT IT IS FOR. `scripts/ci-lanes.mjs` decides which LANES a CI run needs,
 * and ci.yml runs each lane as steps of one HOST job (`HOSTS`), every step and
 * every host reading the `lanes` job's outputs. That is a RELATIONSHIP between
 * two files, and each half can drift alone:
 *
 *   - a job or a step added to ci.yml with no lane condition runs in every lane
 *     and nobody decided that;
 *   - a lane added to the ledger with no host, or no step, checks nothing; with
 *     no `lanes` output it reads an empty string, so the script "skips" it and
 *     it runs anyway;
 *   - a condition rewritten to `== 'true'`, or to one with no status function,
 *     turns FAIL-OPEN into fail-skip: a broken classifier then reports every
 *     required context as `skipped`, which branch protection accepts.
 *
 * So the host set is compared with ci.yml's jobs in BOTH directions, every
 * lane must sit in exactly one host and gate at least one of its steps, every
 * job condition is compared as a whole string, every host step is either one
 * of its pinned setup steps or gated on exactly one of its lanes, and the
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
import {
  JOBS,
  HOSTS,
  ADVISORY_JOBS,
  CORE_JOBS,
  STEP_GATED_JOBS,
  UNGATED_STEPS,
  RELEASE_LANE_JOBS,
  RECORD_ARTIFACT_PREFIX,
  RECORD_ARTIFACT_SUFFIX,
  RECORD_JOB_NAME,
  classifyPath,
  decide,
  narrowedNamePrefix,
} from '../../scripts/ci-lanes.mjs';
import {
  parseJobs,
  parseSteps,
  problems as rawProblems,
  laneCondition,
  hostCondition,
  gatedLane,
  evaluateConjunction,
  LANES_JOB,
  RECORD_JOB,
} from './lib/ci-workflow.mjs';

const SHAPE = { hosts: HOSTS, stepGated: STEP_GATED_JOBS, ungatedSteps: UNGATED_STEPS };
const problems = (t, ledger, hosts = HOSTS) => rawProblems(t, ledger, { ...SHAPE, hosts });

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
 * The contexts branch protection on `main` must require once this layout
 * merges, written out as GitHub matches them (exact strings). Until the
 * required-check list is swapped it still names the eleven per-job contexts
 * the old layout wrote (SDK, blocks-react, README snippets, design-system,
 * Packaging, Public type closure and five `Starter (<name>)` legs), and
 * `OLD_REQUIRED_CONTEXTS` pins that none of them is written any more, so a
 * stale required list fails loudly (pending) instead of matching something.
 * The hosts behind these may never carry an advisory lane, and what they
 * report on pull_request may never change.
 */
const REQUIRED_CONTEXTS = ['Core (all packages)', 'Starters (all five)'];
const REQUIRED_HOSTS = ['core', 'starters'];
const OLD_REQUIRED_CONTEXTS = [
  'SDK (typecheck + test + build)',
  'blocks-react (typecheck + test + build)',
  'README snippets (typecheck)',
  'Starter (civitai-block-starter)',
  'Starter (next-app)',
  'Starter (react-pwa)',
  'Starter (svelte-pwa)',
  'Starter (sveltekit-app)',
  'design-system (theme + components + components-react)',
  'Packaging (shipped sourcemaps)',
  'Public type closure (built .d.ts)',
];

/** The `name:` expressions jobs may carry: the required hosts', fed by `lanes`. */
const EXPRESSION_NAMES = {
  core: "${{ format('{0}Core (all packages)', needs.lanes.outputs.name-prefix) }}",
  starters: "${{ format('{0}Starters (all five)', needs.lanes.outputs.name-prefix) }}",
};

/**
 * Does a host job RUN for a `lanes` decision? Read from its own job-level
 * condition, the way GitHub would: the bare status function always runs, and
 * otherwise the job runs when any lane its condition names is on. Any other
 * shape throws rather than being guessed at.
 */
function hostRuns(job, d) {
  if (job.if === '${{ !cancelled() }}') return true;
  const named = [...(job.if ?? '').matchAll(/needs\.lanes\.outputs\.([\w-]+) != 'false'/g)].map((m) => m[1]);
  if (!named.length) throw new Error(`cannot evaluate the condition of ${job.id}: ${job.if}`);
  return named.some((l) => d.jobs[l]);
}

/**
 * The check-run name a job writes for a decision. A static name as written; a
 * `format('{0}<text>', needs.lanes.outputs.name-prefix)` name evaluated the
 * way GitHub would when the job RUNS, and written LITERALLY when it is skipped
 * (GitHub never evaluates a skipped job's name). Any other expression is
 * reported as unevaluable rather than guessed at.
 */
function reportedName(job, d) {
  const base = job.name ?? job.id;
  if (!base.includes('${{')) return base;
  const m = base.match(/^\$\{\{ format\('\{0\}([^']*)', needs\.lanes\.outputs\.name-prefix\) \}\}$/);
  if (!m) return `UNEVALUABLE ${base}`;
  const runs = job.id === LANES_JOB || job.id === RECORD_JOB ? true : hostRuns(job, d);
  return runs ? `${d.namePrefix}${m[1]}` : base;
}

/** Every name a run of `src` writes, for that run's `lanes` decision. */
const namesFor = (src, d) => parseJobs(src).map((j) => reportedName(j, d));

describe('ci.yml agrees with the lane ledger', () => {
  test('POSITIVE CONTROL: the walk finds the hosts, their conditions, their lane steps and the lanes outputs', () => {
    const jobs = parseJobs(text);
    assert.deepEqual(
      jobs.map((j) => j.id),
      ['lanes', 'core', 'starters', 'advisory', 'design-system-cross-browser', 'record-tree'],
      'the walk is broken, or the job set moved',
    );
    const core = jobs.find((j) => j.id === 'core');
    assert.deepEqual(core.needs, [LANES_JOB]);
    assert.equal(core.if, hostCondition(HOSTS.core));
    assert.ok(core.if.includes("needs.lanes.outputs.sdk != 'false' || "), core.if);
    const lanes = jobs.find((j) => j.id === LANES_JOB);
    assert.equal(lanes.outputs.sdk, '${{ steps.decide.outputs.sdk }}');
    // Every lane step of core is gated on one of core's lanes, and each lane has steps.
    const coreSteps = parseSteps(core);
    assert.ok(coreSteps.length >= 40, `parsed ${coreSteps.length} steps in core, expected >= 40`);
    const coreLanes = new Set(coreSteps.map((s) => gatedLane(s.if)).filter(Boolean));
    assert.deepEqual([...coreLanes].sort(), [...HOSTS.core].sort());
    const starters = parseSteps(jobs.find((j) => j.id === 'starters'));
    assert.ok(starters.length >= 30, `parsed ${starters.length} steps in starters, expected >= 30`);
    assert.equal(
      starters.filter((s) => gatedLane(s.if) === 'starter').length,
      starters.length - UNGATED_STEPS.starters.length,
    );
    assert.ok(starters.some((s) => s.label === 'pnpm test:guards' && s.if === null));
  });

  test('the hosts, the step-gated set and every host\'s ungated steps are the pinned ones', () => {
    // A second copy on purpose, like ADVISORY_PINNED: which lane runs in which
    // job, and which steps survive a lane that turned the rest off, are
    // decisions, not derivations.
    assert.deepEqual(JSON.parse(JSON.stringify(HOSTS)), {
      core: ['sdk', 'civitai-sdk', 'blocks-react', 'design-system', 'readme-snippets', 'examples', 'packaging', 'public-types', 'agent-runner'],
      starters: ['starter'],
      advisory: ['schema-drift', 'starter-pins', 'orchestrator-catalog-drift', 'design-system-drift-guard'],
      'design-system-cross-browser': ['design-system-cross-browser'],
    });
    assert.deepEqual([...STEP_GATED_JOBS], ['starters']);
    assert.deepEqual(JSON.parse(JSON.stringify(UNGATED_STEPS)), {
      core: ['actions/checkout', 'pnpm/action-setup', 'actions/setup-node', 'pnpm install --frozen-lockfile', 'pnpm -r --filter "./packages/*" build'],
      starters: [
        'actions/checkout',
        'pnpm/action-setup',
        'actions/setup-node',
        'pnpm test:guards',
        'node scripts/check-starter-workspace-overrides.mjs',
        'node scripts/check-generated-version.mjs',
      ],
      advisory: ['actions/checkout', 'pnpm/action-setup', 'actions/setup-node'],
    });
  });

  test('the job set, every condition, every host step and every lanes output match the ledger', () => {
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
    // The override guard and `pnpm test:guards` are not release-lane LANES:
    // they are every-lane STEPS of the `starters` host, which is what keeps them
    // running when the release lane turns its heavy steps off.
    assert.ok(UNGATED_STEPS.starters.includes('node scripts/check-starter-workspace-overrides.mjs'));
    assert.ok(UNGATED_STEPS.starters.includes('pnpm test:guards'));
    // design-system, the only other lane running it, is off in the release lane.
    assert.ok(UNGATED_STEPS.starters.includes('node scripts/check-generated-version.mjs'));
    assert.ok(!RELEASE_LANE_JOBS.includes('starter'), 'starter is step-gated; listing it would run its heavy steps');
  });

  test('no required context is path-scoped: the required hosts carry core lanes only', () => {
    for (const host of REQUIRED_HOSTS) {
      for (const id of HOSTS[host]) assert.equal(JOBS[id], 'core', `lane \`${id}\` of required host \`${host}\` must be core, not ${JOBS[id]}`);
    }
  });
});

/**
 * REQUIRED CONTEXTS: written wherever they are a verdict, never written by a
 * narrowed dispatch's partial hosts.
 *
 * Branch protection matches a required context by its exact name, and takes the
 * newest check run of that name on the head commit. Three ways to get that
 * wrong: rename a required host (the context then stays pending on every PR),
 * let a pull_request lane SKIP a host whose name is an expression (GitHub then
 * writes the expression literally and the context stays pending), or let a
 * dispatch narrowed by `only` write a SUCCESS that tested part of a host under a
 * required name. For the last, both hosts carry the `name-prefix`, and `decide`
 * also refuses to narrow at an open pull request's head; see ci-lanes.test.mjs.
 */
describe('required contexts across lanes', () => {
  const NOT_NARROWED = {
    'pull_request, full lane': decide({ event: 'pull_request', files: [{ filename: 'packages/civitai-sdk/src/x.ts' }] }),
    'pull_request, docs only': decide({ event: 'pull_request', files: [{ filename: 'README.md' }] }),
    'pull_request, release lane': decide({
      event: 'pull_request',
      files: [{ filename: 'packages/civitai-sdk/package.json' }],
      release: { problem: null },
    }),
    'pull_request, diff unreadable': decide({ event: 'pull_request', filesError: 'HTTP 502' }),
    push: decide({ event: 'push' }),
    'dispatch, only=all': decide({ event: 'workflow_dispatch', only: 'all', openPrsAtSha: [] }),
    'dispatch, only=sdk at an open PR head': decide({ event: 'workflow_dispatch', only: 'sdk', openPrsAtSha: [757] }),
    'dispatch, only=sdk, PR lookup failed': decide({ event: 'workflow_dispatch', only: 'sdk', prLookupError: 'HTTP 502' }),
  };

  test('POSITIVE CONTROL: the lanes the table claims to cover are the ones it covers', () => {
    assert.equal(NOT_NARROWED['pull_request, release lane'].lane, 'release');
    assert.equal(NOT_NARROWED['pull_request, diff unreadable'].lane, 'full');
    assert.equal(decide({ event: 'workflow_dispatch', only: 'sdk', openPrsAtSha: [] }).lane, 'only');
    // The evaluator itself: a skipped expression-named host is written literally.
    const tree = decide({ event: 'push', pushGate: { skip: true, tree: 't', runId: 1 } });
    assert.ok(namesFor(text, tree).includes(EXPRESSION_NAMES.core), 'core is skipped in the tree lane; the literal must show');
  });

  test('only the required hosts carry an expression name, and no pull_request lane can skip them', () => {
    for (const job of parseJobs(text)) {
      if (job.id in EXPRESSION_NAMES) {
        assert.equal(job.name, EXPRESSION_NAMES[job.id]);
        continue;
      }
      assert.ok(!(job.name ?? '').includes('${{'), `job \`${job.id}\` has an expression name: ${job.name}`);
    }
    assert.equal(parseJobs(text).find((j) => j.id === 'starters').if, '${{ !cancelled() }}', 'starters must never be skipped');
    // Every pull_request lane decide() can produce keeps at least one core lane on.
    const prLanes = [
      decide({ event: 'pull_request', files: [{ filename: 'README.md' }] }),
      decide({ event: 'pull_request', files: [{ filename: 'packages/civitai-sdk/package.json' }], release: { problem: null } }),
      decide({ event: 'pull_request', filesError: 'x' }),
      decide({ event: 'pull_request', files: [] }),
    ];
    for (const d of prLanes) {
      assert.ok(HOSTS.core.some((l) => d.jobs[l]), `lane ${d.lane} (${d.reason}) skips core; its required context would be written unevaluated`);
    }
  });

  for (const [label, d] of Object.entries(NOT_NARROWED)) {
    test(`${label}: every required context is reported under its exact name, and no old one is`, () => {
      assert.equal(d.namePrefix, '', label);
      const names = new Set(namesFor(text, d));
      assert.deepEqual(REQUIRED_CONTEXTS.filter((c) => !names.has(c)), [], label);
      assert.deepEqual(OLD_REQUIRED_CONTEXTS.filter((c) => names.has(c)), [], label);
    });
  }

  test('a narrowed dispatch: the partial hosts write no required context, under a visible prefix', () => {
    for (const only of Object.keys(JOBS).filter((id) => id !== 'starter')) {
      const d = decide({ event: 'workflow_dispatch', only, openPrsAtSha: [] });
      assert.equal(d.lane, 'only', only);
      assert.equal(d.jobs.starter, false, only);
      const names = namesFor(text, d);
      assert.deepEqual(names.filter((n) => REQUIRED_CONTEXTS.includes(n)), [], only);
      assert.ok(names.includes(`[only ${only}] Starters (all five)`), `${only}: ${names}`);
      if (HOSTS.core.includes(only)) assert.ok(names.includes(`[only ${only}] Core (all packages)`), `${only}: ${names}`);
    }
    // only=starter: the starters host runs in full under its real name, and core is skipped.
    const st = decide({ event: 'workflow_dispatch', only: 'starter', openPrsAtSha: [] });
    assert.ok(namesFor(text, st).includes('Starters (all five)'));
    assert.ok(namesFor(text, st).includes(EXPRESSION_NAMES.core));
    assert.equal(narrowedNamePrefix('sdk'), '[only sdk] ');
  });

  test('NEGATIVE CONTROLS: a static host name, a renamed required host, an expression on a skippable job', () => {
    const once = (from, to) => {
      assert.equal(text.split(from).length - 1, 1, `control anchor occurs ${text.split(from).length - 1} times: ${from}`);
      return text.replace(from, to);
    };
    const narrowed = decide({ event: 'workflow_dispatch', only: 'sdk', openPrsAtSha: [] });
    // Back to a static name: the narrowed run's partial host claims the required context.
    const staticCore = once(`    name: ${EXPRESSION_NAMES.core}\n`, '    name: Core (all packages)\n');
    assert.ok(namesFor(staticCore, narrowed).includes('Core (all packages)'));
    // A required host renamed: its context goes missing on pull_request.
    const renamed = once(`    name: ${EXPRESSION_NAMES.starters}\n`, "    name: ${{ format('{0}Starters', needs.lanes.outputs.name-prefix) }}\n");
    assert.ok(!namesFor(renamed, NOT_NARROWED['pull_request, full lane']).includes('Starters (all five)'));
    // An expression name on the advisory host is caught by the expression-name rule.
    const expr = once('    name: Advisory (live drift checks)\n', "    name: ${{ format('{0}Advisory', needs.lanes.outputs.name-prefix) }}\n");
    assert.ok(parseJobs(expr).some((j) => j.id === 'advisory' && !(j.id in EXPRESSION_NAMES) && j.name.includes('${{')));
    // An expression the evaluator does not know is reported, never guessed.
    const odd = once(`    name: ${EXPRESSION_NAMES.starters}\n`, '    name: ${{ github.job }}\n');
    assert.ok(namesFor(odd, narrowed).some((n) => n.startsWith('UNEVALUABLE')));
  });
});

describe('every file an advisory job reads selects that job', () => {
  // The table in ci-lanes.mjs says, with `scripts/**` and several package
  // directories, that NO advisory job reads them. That is only true while the
  // advisory jobs' own steps agree, so read the steps: the scripts they run,
  // the relative modules those import, the DATA FILES those open by a literal
  // repo-relative path, the packages they `--filter`, and the install inputs.
  //
  // KNOWN LIMIT: a data path is found only when it is spelled as a literal next
  // to the repo root (`resolve(REPO_ROOT, 'a/b.json')`, `join(REPO_ROOT, 'a',
  // 'b.json')`, `"$REPO_ROOT/a/b.json"`). A directory walked at run time
  // (`check-starter-pins.mjs` reads every `starters/**/package.json`) or a path
  // built from a variable is invisible here; those are covered by the RULES
  // rows the table tests pin, not by this derivation.
  // A lane's lines: its host's whole body for a one-lane host gated at job
  // level, otherwise the steps gated on that lane.
  const parsed = parseJobs(text);
  const jobs = ADVISORY_JOBS.map((id) => {
    const host = parsed.find((j) => HOSTS[j.id]?.includes(id));
    assert.ok(host, `advisory lane ${id} has no host job in ci.yml`);
    const body = HOSTS[host.id].length === 1 ? host.body : parseSteps(host).filter((s) => gatedLane(s.if) === id).flatMap((s) => s.body);
    return { id, body };
  });
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

  /** Repo-relative FILE paths a script spells as a literal beside the repo root. */
  function dataPaths(rel) {
    const abs = join(REPO_ROOT, rel);
    return existsSync(abs) ? dataPathsIn(readFileSync(abs, 'utf8')) : [];
  }
  function dataPathsIn(src) {
    const out = [];
    // Two passes, on purpose: find the call's argument text with ONE negated
    // class (`[^)]*`), then pull the quoted segments out of it. A single
    // pattern with a quantified group around quote-comma-whitespace backtracks
    // exponentially on a long argument list.
    for (const m of src.matchAll(/\b(?:resolve|join)\(\s*REPO_ROOT\s*,([^)]*)\)/g)) {
      const segments = [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
      // A non-literal argument (a variable, a template) means the path is not
      // spelled here; that is the known limit above, not a path to guess at.
      const literalOnly = m[1].replace(/'[^']*'|"[^"]*"/g, '').replace(/[\s,]/g, '') === '';
      if (segments.length && literalOnly) out.push(segments.join('/'));
    }
    for (const m of src.matchAll(/\$\{?REPO_ROOT\}?\/([\w./-]+)/g)) out.push(m[1]);
    // A file has an extension; a directory literal is walked at run time and is
    // the known limit above.
    return out.filter((p) => /\.[A-Za-z0-9]+$/.test(p.split('/').pop()));
  }

  test('POSITIVE CONTROL: the advisory lanes reference scripts and packages at all', () => {
    assert.equal(jobs.length, 5);
    for (const j of jobs) assert.ok(j.body.length > 0, `advisory lane ${j.id} has no lines`);
    const all = jobs.flatMap((j) => j.body.join('\n').match(/scripts\/[\w./-]+/g) ?? []);
    assert.ok(all.length >= 3, `found ${all.length} script references in the advisory jobs, expected >= 3`);
    assert.ok(Object.keys(packageDirs).includes('@civitai/theme'), 'packages/*/package.json names were not read');
    // The data-path extraction must see the three data files the drift scripts
    // are known to open; zero would be a reader wired to nothing.
    const data = jobs.flatMap((j) =>
      [...new Set(j.body.filter((l) => !/^\s*#/.test(l)).join('\n').match(/scripts\/[\w./-]+/g) ?? [])].flatMap(dataPaths),
    );
    for (const known of [
      'packages/civitai-app-sdk/schemas/app-block/v1.json',
      'packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json',
      'packages/civitai-app-sdk/src/orchestrator/index.ts',
    ]) {
      assert.ok(data.includes(known), `data-path extraction did not find ${known}; found ${JSON.stringify(data)}`);
    }
    // The install inputs are read per lane: only the drift guard installs in the advisory host.
    assert.ok(jobs.find((j) => j.id === 'design-system-drift-guard').body.join('\n').includes('pnpm install'));
    assert.ok(!jobs.find((j) => j.id === 'schema-drift').body.join('\n').includes('pnpm install'));
  });

  test('the three literal forms are read, a non-literal one is not, and a long argument list is linear', () => {
    assert.deepEqual(dataPathsIn("x = resolve(REPO_ROOT, 'a/b.json');"), ['a/b.json']);
    assert.deepEqual(dataPathsIn('x = join(\n  REPO_ROOT,\n  "a",\n  \'b\',\n  "c.ts",\n);'), ['a/b/c.ts']);
    assert.deepEqual(dataPathsIn('V="$REPO_ROOT/a/b.json"\nW="${REPO_ROOT}/c/d.sh"'), ['a/b.json', 'c/d.sh']);
    // A directory literal and a path built from a variable are the known limit.
    assert.deepEqual(dataPathsIn("join(REPO_ROOT, 'starters'); join(REPO_ROOT, dir, 'package.json');"), []);
    // The previous single-pattern form, `((?:['"][^'"]*['"]\s*,?\s*)+)\)`, is
    // exponential on quoted arguments separated by whitespace WITHOUT a comma
    // and never closed: the optional comma lets `\s*,?\s*` split each gap two
    // ways. Measured on it: ~0.2 s at 24 repetitions, ~4 s at 28, doubling per
    // step. (With commas it is linear, so a comma-separated input proves
    // nothing.) 28 keeps a regression to seconds rather than a hang; the bound
    // is generous because the two-pass scan takes well under a millisecond.
    const hostile = `join(REPO_ROOT, ${"'a' ".repeat(28)}`;
    const t0 = process.hrtime.bigint();
    assert.deepEqual(dataPathsIn(hostile), []);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, `scanning 28 unseparated arguments took ${ms.toFixed(0)} ms; the argument-list scan backtracks`);
  });

  for (const job of jobs) {
    test(`${job.id}: its scripts, their imports and data files, and its filtered packages classify to it`, () => {
      // Comment lines describe; only live step lines say what the job runs.
      const live = job.body.filter((l) => !/^\s*#/.test(l)).join('\n');
      const scripts = [...new Set(live.match(/scripts\/[\w./-]+/g) ?? [])].flatMap(scriptClosure);
      const data = [...new Set(scripts.flatMap(dataPaths))];
      const filtered = [...live.matchAll(/--filter\s+(@[\w./-]+)/g)].map((m) => m[1]);
      const paths = [
        ...scripts,
        ...data,
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

/**
 * The `workflow_dispatch` `only` input's options, read from the `on:` block by
 * the same kind of line walk as `lib/ci-workflow.mjs`. Null when the input or
 * its options list is absent.
 */
function dispatchOnlyOptions(src) {
  const lines = src.split('\n');
  const on = lines.indexOf('on:');
  const end = lines.findIndex((l, i) => i > on && /^\S/.test(l));
  const block = lines.slice(on + 1, end === -1 ? undefined : end);
  const only = block.findIndex((l) => /^ {6}only:\s*$/.test(l));
  if (only === -1) return null;
  const opts = block.findIndex((l, i) => i > only && /^ {8}options:\s*$/.test(l));
  if (opts === -1) return null;
  const out = [];
  for (const l of block.slice(opts + 1)) {
    const m = l.match(/^ {10}- (\S+)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

describe('workflow_dispatch `only`: one option per ledger job, plus `all`', () => {
  // A job missing here cannot be run alone; an option the ledger does not know
  // silently runs EVERY job (decide() fails open on an unknown name). Both
  // directions fail, as sets, under different messages.
  const check = (src) => {
    const opts = dispatchOnlyOptions(src);
    if (opts === null) return ['no-only-input'];
    const want = new Set(['all', ...Object.keys(JOBS)]);
    const got = new Set(opts);
    return [
      ...[...want].filter((o) => !got.has(o)).map((o) => `option-missing:${o}`),
      ...[...got].filter((o) => !want.has(o)).map((o) => `option-unknown:${o}`),
      ...(opts.length !== got.size ? ['option-duplicate'] : []),
    ];
  };

  test('the real ci.yml matches the ledger', () => {
    assert.deepEqual(check(text), []);
    // Positive control on the walk itself: it read a non-trivial list.
    assert.equal(dispatchOnlyOptions(text).length, Object.keys(JOBS).length + 1);
  });

  test('negative controls', () => {
    const once = (from, to) => {
      assert.equal(text.split(from).length - 1, 1, `control anchor occurs ${text.split(from).length - 1} times: ${from}`);
      return text.replace(from, to);
    };
    assert.deepEqual(check(once('          - examples\n', '')), ['option-missing:examples']);
    assert.deepEqual(check(once('          - examples\n', '          - examples\n          - ghost\n')), ['option-unknown:ghost']);
    assert.deepEqual(check(once('          - examples\n', '          - examples\n          - examples\n')), ['option-duplicate']);
    assert.deepEqual(check(once('      only:\n', '      lane:\n')), ['no-only-input']);
  });
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
  const cbIf = `    if: ${laneCondition('design-system-cross-browser')}\n`;
  const coreIf = `    if: ${hostCondition(HOSTS.core)}\n`;
  const tagsH = (hosts) =>
    rawProblems(text, JOBS, { ...SHAPE, hosts })
      .filter((p) => !baseline.includes(p))
      .map((p) => p.match(/^\[([a-z-]+)\]/)?.[1]);

  test('a job added to ci.yml but not to the hosts', () => {
    const grown = `${text}\n  brand-new:\n    name: New\n    needs: lanes\n    if: ${laneCondition('brand-new')}\n    runs-on: ubuntu-latest\n`;
    assert.deepEqual(tags(grown), ['job-not-in-hosts']);
  });

  test('a lane in the ledger that no host runs', () => {
    assert.deepEqual(tags(text, { ...JOBS, ghost: 'core' }).sort(), ['lane-unhosted', 'output-missing', 'record-condition-missing'].sort());
  });

  test('a host that ci.yml does not have, a lane in two hosts, a host lane the ledger does not know', () => {
    assert.ok(tagsH({ ...HOSTS, ghost: ['sdk'] }).includes('host-not-in-workflow'));
    assert.ok(tagsH({ ...HOSTS, ghost: ['sdk'] }).includes('lane-multihosted'));
    assert.ok(tagsH({ ...HOSTS, starters: ['starter', 'phantom'] }).includes('host-lane-unknown'));
  });

  test('a host mixing core and advisory lanes', () => {
    const mixed = { ...HOSTS, advisory: [...HOSTS.advisory, 'sdk'], core: HOSTS.core.filter((l) => l !== 'sdk') };
    assert.ok(tagsH(mixed).includes('host-mixed'));
  });

  test('a host with no condition at all', () => {
    assert.deepEqual(tags(mutate(coreIf, '')), ['no-condition']);
  });

  test("a condition rewritten to == 'true' (fail-skip)", () => {
    assert.deepEqual(
      tags(mutate(cbIf, "    if: ${{ !cancelled() && needs.lanes.outputs.design-system-cross-browser == 'true' }}\n")),
      ['condition-shape'],
    );
    assert.deepEqual(tags(mutate(coreIf, coreIf.replace("sdk != 'false'", "sdk == 'true'"))), ['condition-shape']);
  });

  test('a condition with no status function (skipped whenever lanes fails)', () => {
    assert.deepEqual(tags(mutate(cbIf, "    if: ${{ needs.lanes.outputs.design-system-cross-browser != 'false' }}\n")), ['condition-shape']);
    assert.deepEqual(tags(mutate(coreIf, coreIf.replace('!cancelled() && ', ''))), ['condition-shape']);
  });

  test("a condition reading ANOTHER lane's output, or missing one of the host's lanes", () => {
    assert.deepEqual(
      tags(mutate(cbIf, "    if: ${{ !cancelled() && needs.lanes.outputs.packaging != 'false' }}\n")),
      ['condition-shape'],
    );
    assert.deepEqual(tags(mutate(coreIf, coreIf.replace(" || needs.lanes.outputs.agent-runner != 'false'", ''))), ['condition-shape']);
  });

  test('a host that dropped `needs: lanes`', () => {
    assert.deepEqual(tags(mutate(`    needs: lanes\n${cbIf}`, cbIf)), ['needs-lanes']);
  });

  test('a core step gated on a lane core does not host', () => {
    const step = "      - name: 'sdk: typecheck'\n        if: ${{ !cancelled() && needs.lanes.outputs.sdk != 'false' }}\n";
    assert.deepEqual(
      tags(mutate(step, step.replace('outputs.sdk', 'outputs.schema-drift'))),
      ['step-foreign-lane'],
    );
  });

  test('a lane whose steps all moved to another lane checks nothing', () => {
    // Every agent-runner STEP re-gated on sdk; the job condition (`|| …agent-runner…)`) is untouched.
    const moved = text.replace(
      /^( {8}if: \$\{\{ !cancelled\(\) && needs\.lanes\.outputs\.)agent-runner( != 'false' \}\})$/gm,
      '$1sdk$2',
    );
    assert.notEqual(moved, text, 'control anchor: no agent-runner step condition found');
    assert.deepEqual(tags(moved), ['lane-no-steps']);
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

  test('the step-gated host given a job-level lane condition (the guards would skip with it)', () => {
    assert.deepEqual(tags(mutate('\n    if: ${{ !cancelled() }}\n', `\n    if: ${laneCondition('starter')}\n`)), ['condition-shape']);
  });

  test('the step-gated host with no status function (skipped, guards included, when lanes fails)', () => {
    assert.deepEqual(tags(mutate('\n    if: ${{ !cancelled() }}\n', '\n')), ['no-condition']);
  });

  test('a lane step that ignores the lane output', () => {
    const typecheck = "      - name: 'next-app: typecheck'\n        if: ${{ !cancelled() && needs.lanes.outputs.starter != 'false' }}\n";
    assert.deepEqual(tags(mutate(typecheck, "      - name: 'next-app: typecheck'\n")), ['step-ungated']);
    // Without the status function the clause is not a lane gate either: one red lane would skip the rest.
    assert.deepEqual(
      tags(mutate(typecheck, "      - name: 'next-app: typecheck'\n        if: ${{ needs.lanes.outputs.starter != 'false' }}\n")),
      ['step-ungated'],
    );
    const probe = "        if: ${{ !cancelled() && needs.lanes.outputs.starter != 'false' && steps.build-next-app.outcome == 'success' }}\n";
    // A build-outcome condition alone is not the lane clause.
    assert.deepEqual(tags(mutate(probe, "        if: steps.build-next-app.outcome == 'success'\n")), ['step-ungated']);
    // OR-ing something after the clause is not gating either.
    assert.deepEqual(
      tags(mutate(probe, "        if: ${{ !cancelled() && needs.lanes.outputs.starter != 'false' || steps.build-next-app.outcome == 'success' }}\n")),
      ['step-ungated'],
    );
  });

  test('a new step added to a host without a lane decision', () => {
    const anchor = "      - name: 'next-app: lint (if defined)'\n";
    assert.deepEqual(tags(mutate(anchor, `      - run: pnpm audit\n\n${anchor}`)), ['step-ungated']);
    const coreAnchor = "      - name: 'sdk: typecheck'\n";
    assert.deepEqual(tags(mutate(coreAnchor, `      - run: pnpm audit\n\n${coreAnchor}`)), ['step-ungated']);
  });

  test('the guards step made conditional, gated into a lane, or removed', () => {
    const step = '      - run: pnpm test:guards\n';
    // Conditional: reported as conditional, and the unconditional every-lane step is gone.
    assert.deepEqual(tags(mutate(step, `${step}        if: github.event_name == 'pull_request'\n`)).sort(), ['always-step-conditional', 'always-step-missing']);
    // Gated on the starter lane it is a lane step, and the every-lane guard is gone.
    assert.deepEqual(tags(mutate(step, `${step}        if: \${{ !cancelled() && needs.lanes.outputs.starter != 'false' }}\n`)), [
      'always-step-missing',
    ]);
    assert.deepEqual(tags(mutate(step, '')), ['always-step-missing']);
  });

  test("core's shared build made lane-dependent", () => {
    const build = '      - run: pnpm -r --filter "./packages/*" build\n        if: ${{ !cancelled() }}\n';
    assert.deepEqual(
      tags(mutate(build, '      - run: pnpm -r --filter "./packages/*" build\n        if: github.event_name == \'push\'\n')).sort(),
      ['always-step-conditional', 'always-step-missing'],
    );
  });

  test('a schedule trigger put back', () => {
    assert.deepEqual(tags(mutate('  workflow_dispatch:\n', "  schedule:\n    - cron: '17 5 * * *'\n  workflow_dispatch:\n")), ['schedule-trigger']);
  });

  test('a host added to ci.yml AND to HOSTS but not to record-tree', () => {
    const grown = `${text}\n  brand-new:\n    name: New\n    needs: lanes\n    if: ${laneCondition('brand-new')}\n    runs-on: ubuntu-latest\n`;
    const t = rawProblems(grown, { ...JOBS, 'brand-new': 'core' }, { ...SHAPE, hosts: { ...HOSTS, 'brand-new': ['brand-new'] } })
      .filter((p) => !baseline.includes(p))
      .map((p) => p.match(/^\[([a-z-]+)\]/)?.[1]);
    assert.deepEqual(t.sort(), ['output-missing', 'record-condition-missing', 'record-condition-missing', 'record-needs-missing'].sort());
  });

  test('a host dropped from record-tree needs, and a condition conjunct dropped', () => {
    assert.deepEqual(tags(mutate('\n      - advisory\n', '\n')), ['record-needs-missing']);
    assert.deepEqual(tags(mutate("      && needs.lanes.outputs.lane == 'full'\n", '')), ['record-condition-missing']);
    // The seam: a host that SUCCEEDED with one of its lanes off.
    assert.deepEqual(
      tags(mutate("      && needs.starters.result == 'success' && needs.lanes.outputs.starter == 'true'\n", "      && needs.starters.result == 'success'\n")),
      ['record-condition-missing'],
    );
    assert.deepEqual(tags(mutate("      && needs.lanes.outputs.packaging == 'true'\n", '')), ['record-condition-missing']);
  });

  test('record-tree conditioned on success() or with an OR', () => {
    const anchor = "      ${{ !cancelled()\n";
    assert.deepEqual(tags(mutate(anchor, '      ${{ success()\n')).sort(), ['record-condition-missing', 'record-condition-unknown'].sort());
    assert.deepEqual(tags(mutate("      && needs.lanes.result == 'success'\n", "      || needs.lanes.result == 'success'\n")), ['record-condition-shape']);
  });

  test('record-tree no longer excluding a FAILED advisory host', () => {
    assert.deepEqual(
      tags(mutate("      && needs.advisory.result != 'failure' && needs.advisory.result != 'cancelled'\n", "      && needs.advisory.result != 'cancelled'\n")),
      ['record-condition-missing'],
    );
  });

  test('record-tree uploading a name the gate never looks up', () => {
    assert.deepEqual(tags(mutate('          name: ci-tested-tree-${{ steps.tree.outputs.sha }}-full\n', '          name: ci-tested-tree-${{ steps.tree.outputs.sha }}\n')), [
      'record-artifact-name',
    ]);
  });

  test('the lanes job made conditional, or no longer running the script', () => {
    const header = '    name: CI lanes (which jobs this run needs)\n';
    assert.deepEqual(tags(mutate(header, `${header}    if: github.event_name == 'pull_request'\n`)), ['lanes-conditional']);
    assert.deepEqual(tags(mutate('        run: node scripts/ci-lanes.mjs\n', '        run: echo skipped\n')), ['lanes-script']);
  });
});

describe('THE SEAM: record-tree fires only for a run that tested the whole tree', () => {
  // Builds the needs context GitHub would hand record-tree, from the REAL
  // `decide()` and the REAL condition in ci.yml, so a change on either side of
  // the seam (a new lane, a new step-gated job, an edited condition) is
  // measured here rather than reasoned about.
  const record = parseJobs(text).find((j) => j.id === RECORD_JOB);
  /**
   * results: what each HOST concluded. A host runs when any of its lanes is on
   * (or it is step-gated, or `lanes` failed), and fails when a lane in `fail`
   * is one of its own; a host with every lane off is skipped.
   */
  function ctxFor(decision, { event = 'pull_request', fail = [], lanesResult = 'success' } = {}) {
    const results = { [LANES_JOB]: lanesResult };
    for (const [host, lanes] of Object.entries(HOSTS)) {
      const ran = lanesResult !== 'success' || STEP_GATED_JOBS.includes(host) || lanes.some((l) => decision.jobs[l]);
      results[host] = lanes.some((l) => fail.includes(l)) ? 'failure' : ran ? 'success' : 'skipped';
    }
    const outputs =
      lanesResult === 'success'
        ? { [LANES_JOB]: { lane: decision.lane, ...Object.fromEntries(Object.entries(decision.jobs).map(([k, v]) => [k, String(v)])) } }
        : { [LANES_JOB]: {} };
    return { event, cancelled: false, results, outputs };
  }
  const docsOnly = decide({ event: 'pull_request', files: [{ filename: 'README.md' }] });
  const release = decide({ event: 'pull_request', files: [{ filename: 'packages/a/CHANGELOG.md', status: 'modified' }], release: { problem: null } });

  test('POSITIVE CONTROL: a full-lane PR with advisory jobs lane-skipped DOES record', () => {
    assert.equal(docsOnly.lane, 'full');
    assert.ok(ADVISORY_JOBS.every((id) => !docsOnly.jobs[id]), 'the control needs the advisory jobs skipped');
    assert.equal(evaluateConjunction(record.if, ctxFor(docsOnly)), true);
  });

  test('a release-lane run, every job green, does NOT record', () => {
    assert.equal(release.lane, 'release');
    const ctx = ctxFor(release);
    assert.equal(ctx.results.starters, 'success', 'starters succeeds in the release lane; that is the trap');
    assert.equal(ctx.results.core, 'success', 'core succeeds on packaging alone in the release lane; so is that');
    assert.equal(evaluateConjunction(record.if, ctx), false);
  });

  test('ANY one core lane switched off by its lane output, its host still concluding success, does not record', () => {
    // A host succeeds with some of its lanes off, so each lane's output must be
    // decisive alone: a full-lane decision with ONE core output flipped to
    // false, and its host still reporting success.
    const all = decide({ event: 'pull_request', files: [{ filename: '.github/workflows/ci.yml' }] });
    for (const id of CORE_JOBS) {
      const flipped = { ...all, jobs: { ...all.jobs, [id]: false } };
      const ctx = ctxFor(flipped);
      const host = Object.keys(HOSTS).find((h) => HOSTS[h].includes(id));
      assert.equal(ctx.results[host], 'success', `control: ${host} still succeeds with ${id} off`);
      assert.equal(evaluateConjunction(record.if, ctx), false, `${id} off but successful still recorded the tree`);
    }
  });

  test('a core lane failing does not record, and neither does an ADVISORY lane failing or cancelled', () => {
    // The gate only accepts a run that concluded success; a failed advisory job
    // makes the run a failure, so a record from it could never be used.
    const all = decide({ event: 'pull_request', files: [{ filename: '.github/workflows/ci.yml' }] });
    assert.equal(evaluateConjunction(record.if, ctxFor(all)), true, 'control: every job green records');
    assert.equal(evaluateConjunction(record.if, ctxFor(all, { fail: ['packaging'] })), false);
    for (const id of ADVISORY_JOBS) {
      assert.equal(evaluateConjunction(record.if, ctxFor(all, { fail: [id] })), false, `${id} failed but the tree was recorded`);
      const cancelled = ctxFor(all);
      cancelled.results[Object.keys(HOSTS).find((h) => HOSTS[h].includes(id))] = 'cancelled';
      assert.equal(evaluateConjunction(record.if, cancelled), false, `${id} cancelled but the tree was recorded`);
    }
  });

  test('a failed lanes job runs everything but records nothing', () => {
    assert.equal(evaluateConjunction(record.if, ctxFor(docsOnly, { lanesResult: 'failure' })), false);
  });

  test('push, schedule and tree-skipped runs never record', () => {
    const push = decide({ event: 'push' });
    assert.equal(evaluateConjunction(record.if, ctxFor(push, { event: 'push' })), false);
    const sched = decide({ event: 'schedule' });
    assert.equal(evaluateConjunction(record.if, ctxFor(sched, { event: 'schedule' })), false);
    const skipped = decide({ event: 'push', pushGate: { skip: true, tree: 'a'.repeat(40), runId: 1 } });
    assert.equal(evaluateConjunction(record.if, ctxFor(skipped, { event: 'push' })), false);
  });

  test('the job name and artifact name are the ones the gate looks up', () => {
    assert.equal(record.name, RECORD_JOB_NAME);
    assert.equal(RECORD_ARTIFACT_PREFIX + '<tree>' + RECORD_ARTIFACT_SUFFIX, 'ci-tested-tree-<tree>-full');
  });
});
