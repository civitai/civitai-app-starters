#!/usr/bin/env node
/**
 * ci-lanes.mjs
 * ------------
 * The ONE place that decides which `.github/workflows/ci.yml` jobs a run needs.
 * The `lanes` job runs it and exposes one output per job id; every other job
 * carries the same job-level condition,
 *
 *     needs: lanes
 *     if: ${{ !cancelled() && needs.lanes.outputs.<job-id> != 'false' }}
 *
 * (the matrix job `starter` reads the same output from its steps instead; see
 * `STEP_GATED_JOBS`) so a job is skipped ONLY when this script positively wrote
 * the string `false` for it. Everything else runs the job: `lanes` failed, `lanes` was skipped, the
 * script crashed before writing, the output is missing or misspelt. That is the
 * FAIL-OPEN contract, and it is carried by the comparison (`!= 'false'`), not by
 * this file being correct.
 *
 * WHY JOB-LEVEL, NOT A WORKFLOW `paths:` FILTER. Branch protection on `main`
 * names job contexts. A job skipped by a job-level `if:` reports `skipped`,
 * which satisfies a required context; a workflow that never starts (a `paths:`
 * filter) leaves the context pending forever and the PR unmergeable.
 *
 * THE LANES
 *   full       every `core` job, plus the `advisory` jobs whose inputs the PR
 *              touches. `push` (to main) and `workflow_dispatch` run everything,
 *              and so does any other event (there is no `schedule` trigger).
 *
 * In this lane set no core job is ever off; the per-job outputs for core jobs
 * and the `starter` matrix's step gating exist for the lanes that turn core
 * jobs off (the release-PR lane and the push-to-main tested-tree skip). They
 * are not dead code.
 *
 * ADVISORY jobs are the five non-required jobs that depend on something outside
 * the tree at run time (a published schema, the npm registry, the orchestrator
 * spec, a live civitai/civitai checkout, three browser engines), so on a PR that
 * does not touch what the job reads its verdict is mostly a fact about that
 * outside thing, not the PR.
 * On a PR they run only when the diff touches their inputs (`RULES` below).
 *
 * 🔴 A PATH THE TABLE DOES NOT KNOW RUNS EVERY ADVISORY JOB. `RULES` classifies
 * positively in BOTH directions: a rule either names the jobs that read a path
 * or says, with an empty list, that no advisory job reads it. A path no rule
 * matches is unclassified and selects all five. So a new top-level file or a new
 * package directory cannot silently fall out of coverage; it costs five jobs
 * until somebody decides.
 *
 * USAGE
 *   node scripts/ci-lanes.mjs              # in Actions: writes $GITHUB_OUTPUT
 *   node scripts/ci-lanes.mjs --explain a/b.ts c.md   # local: classify paths
 *
 * TESTS  tests/guards/ci-lanes.test.mjs (the decision table) and
 *        tests/guards/ci-lanes-ledger.test.mjs (ci.yml against `JOBS`).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THE LEDGER: every job in ci.yml except `lanes` itself, and the kind that
 * decides its lane behaviour. `tests/guards/ci-lanes-ledger.test.mjs` fails when
 * ci.yml's job set and this map differ in EITHER direction, so a job cannot be
 * added, removed or renamed without deciding its lane here.
 *
 *   core      runs on every pull_request, push and workflow_dispatch.
 *   advisory  path-scoped on pull_request; always on push and dispatch.
 */
export const JOBS = Object.freeze({
  sdk: 'core',
  'schema-drift': 'advisory',
  'starter-pins': 'advisory',
  'orchestrator-catalog-drift': 'advisory',
  'civitai-sdk': 'core',
  'blocks-react': 'core',
  'design-system': 'core',
  'design-system-cross-browser': 'advisory',
  'design-system-drift-guard': 'advisory',
  'readme-snippets': 'core',
  starter: 'core',
  examples: 'core',
  packaging: 'core',
  'public-types': 'core',
});

/**
 * Jobs whose lane output is read by their STEPS rather than by a job-level
 * `if:`. They always start, in every lane, and a `false` output turns off every
 * step outside `UNGATED_STEPS`.
 *
 * `starter` is the one such job, for two independent reasons. It is a matrix,
 * and a matrix job skipped at job level is never expanded, so it would report
 * one `Starter` context while the five required `Starter (<name>)` contexts
 * stayed pending. And it runs `pnpm test:guards`, which has to run on every
 * event and in every lane.
 */
export const STEP_GATED_JOBS = Object.freeze(['starter']);

/** The steps of a step-gated job that run in EVERY lane, matched on `uses:`/`run:`. */
export const UNGATED_STEPS = Object.freeze([
  'actions/checkout',
  'pnpm/action-setup',
  'actions/setup-node',
  'pnpm test:guards',
  'node scripts/check-starter-workspace-overrides.mjs',
]);

export const ADVISORY_JOBS = Object.freeze(
  Object.keys(JOBS).filter((id) => JOBS[id] === 'advisory'),
);
export const CORE_JOBS = Object.freeze(Object.keys(JOBS).filter((id) => JOBS[id] === 'core'));

const ALL = ADVISORY_JOBS;
const NONE = Object.freeze([]);
/** The two advisory jobs that run `pnpm install`, so the install's inputs are theirs. */
const INSTALLERS = Object.freeze(['design-system-cross-browser', 'design-system-drift-guard']);

/**
 * Path -> the advisory jobs that read it. A path gets the UNION over every rule
 * that matches it, so a broad "nobody reads this directory" rule and a narrow
 * "this one file is job X's input" rule compose without ordering. `jobs: NONE`
 * is a positive statement, not a default.
 *
 * Globs: `*` is one path segment, `**` is any depth, and a `**` segment may
 * also match nothing (so a double-star-slash prefix matches the repo root).
 */
export const RULES = Object.freeze([
  // The workflow and this classifier change what every job does.
  { glob: '.github/workflows/ci.yml', jobs: ALL },
  { glob: 'scripts/ci-lanes.mjs', jobs: ALL },

  // schema-drift: curl + diff of ONE vendored file.
  { glob: 'packages/civitai-app-sdk/schemas/app-block/v1.json', jobs: ['schema-drift'] },
  { glob: 'scripts/check-canonical-schema.sh', jobs: ['schema-drift'] },

  // starter-pins: every starter/example pin, bounded by the LOCAL package versions.
  { glob: 'starters/**/package.json', jobs: ['starter-pins'] },
  { glob: 'packages/*/package.json', jobs: ['starter-pins'] },
  { glob: 'scripts/check-starter-pins.mjs', jobs: ['starter-pins'] },

  // orchestrator-catalog-drift: the transcribed fixture against the live spec,
  // plus a placeholder sweep over the SDK's catalog source.
  {
    glob: 'packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json',
    jobs: ['orchestrator-catalog-drift'],
  },
  { glob: 'packages/civitai-app-sdk/src/orchestrator/index.ts', jobs: ['orchestrator-catalog-drift'] },
  { glob: 'scripts/check-orchestrator-catalogs.mjs', jobs: ['orchestrator-catalog-drift'] },
  { glob: 'scripts/orchestrator-catalog-placeholder.mjs', jobs: ['orchestrator-catalog-drift'] },

  // design-system-drift-guard builds and tests @civitai/theme against a live
  // civitai/civitai checkout. design-system-cross-browser builds theme, sdk and
  // components and runs the elements' contract in three browser engines.
  // (How those engines are provisioned is that job's business; the inputs
  // listed here are what it builds from this tree.)
  { glob: 'packages/civitai-theme/**', jobs: INSTALLERS },
  { glob: 'packages/civitai-sdk/**', jobs: ['design-system-cross-browser'] },
  { glob: 'packages/civitai-components/**', jobs: ['design-system-cross-browser'] },
  { glob: 'package.json', jobs: INSTALLERS },
  { glob: 'pnpm-lock.yaml', jobs: INSTALLERS },
  { glob: 'pnpm-workspace.yaml', jobs: INSTALLERS },

  // Positively read by NO advisory job. Narrower rules above still win, by union.
  { glob: '**/*.md', jobs: NONE },
  { glob: 'docs/**', jobs: NONE },
  { glob: 'claudedocs/**', jobs: NONE },
  { glob: '.changeset/**', jobs: NONE },
  { glob: '.github/**', jobs: NONE },
  { glob: 'tests/guards/**', jobs: NONE },
  { glob: 'scripts/**', jobs: NONE },
  { glob: 'starters/**', jobs: NONE },
  { glob: 'packages/civitai-app-sdk/**', jobs: NONE },
  { glob: 'packages/civitai-blocks-react/**', jobs: NONE },
  { glob: 'packages/civitai-components-react/**', jobs: NONE },
  { glob: 'packages/civitai-components-chat/**', jobs: NONE },
  { glob: 'LICENSE', jobs: NONE },
  { glob: '.editorconfig', jobs: NONE },
  { glob: '.gitignore', jobs: NONE },
  { glob: '.envrc', jobs: NONE },
  { glob: '.nvmrc', jobs: NONE },
  { glob: 'flake.nix', jobs: NONE },
  { glob: 'flake.lock', jobs: NONE },
]);

/** `*` = one segment, `**` = any depth; a `**` segment may match nothing. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

const COMPILED = RULES.map((r) => ({ ...r, re: globToRegExp(r.glob) }));

/**
 * One path -> `{ classified, jobs }`. `classified: false` means no rule matched,
 * which the caller must treat as "every advisory job".
 */
export function classifyPath(path) {
  const hits = COMPILED.filter((r) => r.re.test(path));
  if (hits.length === 0) return { classified: false, jobs: [...ALL] };
  return { classified: true, jobs: ADVISORY_JOBS.filter((id) => hits.some((r) => r.jobs.includes(id))) };
}

const everyJob = (value) => Object.fromEntries(Object.keys(JOBS).map((id) => [id, value]));

/**
 * The decision, as a pure function of what the run knows.
 *
 * @param {object} input
 * @param {string} input.event        `github.event_name`
 * @param {Array<{filename: string, previous_filename?: string}>} [input.files]
 *        the pull request's changed files (pull_request only)
 * @param {string} [input.filesError] set when the file list could not be computed
 * @returns {{ lane: string, reason: string, jobs: Record<string, boolean> }}
 */
export function decide({ event, files, filesError } = {}) {
  if (event !== 'pull_request') {
    // push, workflow_dispatch, and any event this file has never heard of.
    return { lane: 'full', reason: `${event || 'unknown event'}: every job`, jobs: everyJob(true) };
  }

  const runAll = (why) => ({ lane: 'full', reason: `FAIL OPEN, every job: ${why}`, jobs: everyJob(true) });
  if (filesError) return runAll(`the changed-file list could not be computed (${filesError})`);
  if (!Array.isArray(files)) return runAll('no changed-file list was supplied');
  // A pull request with no changed files is not a state this can tell apart from
  // an API that answered with nothing.
  if (files.length === 0) return runAll('the changed-file list is empty');

  const jobs = everyJob(true);
  for (const id of ADVISORY_JOBS) jobs[id] = false;
  const unclassified = [];
  for (const f of files) {
    // A rename moves content out of one path and into another; both are inputs.
    if (typeof f?.filename !== 'string' || f.filename === '') return runAll('a changed-file entry has no filename');
    for (const p of [f.filename, f.previous_filename]) {
      if (p === undefined || p === null) continue;
      if (typeof p !== 'string' || p === '') return runAll('a changed-file entry has no usable path');
      const c = classifyPath(p);
      if (!c.classified) unclassified.push(p);
      for (const id of c.jobs) jobs[id] = true;
    }
  }
  const ran = ADVISORY_JOBS.filter((id) => jobs[id]);
  const reason = unclassified.length
    ? `unclassified path(s) select every advisory job: ${unclassified.slice(0, 5).join(', ')}`
    : ran.length
      ? `advisory jobs whose inputs changed: ${ran.join(', ')}`
      : 'no advisory job reads any changed path';
  return { lane: 'full', reason, jobs };
}

/** GitHub caps `pulls/{n}/files` at 3000 entries; a list that long is truncated. */
const FILES_API_CAP = 3000;

/** Every changed file of a pull request, or a thrown error. Never a partial list. */
export async function fetchPullRequestFiles({ api, repo, number, token, fetchImpl = fetch }) {
  const files = [];
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`${api}/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`pulls/${number}/files page ${page} answered HTTP ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(`pulls/${number}/files page ${page} is not a list`);
    files.push(...batch);
    if (files.length >= FILES_API_CAP) throw new Error(`${files.length} files reaches the API cap; the list is truncated`);
    if (batch.length < 100) return files;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--explain') {
    for (const p of argv.slice(1)) {
      const c = classifyPath(p);
      console.log(`${p}\t${c.classified ? (c.jobs.join(',') || '(no advisory job)') : 'UNCLASSIFIED -> all'}`);
    }
    return;
  }

  const env = process.env;
  const event = env.GITHUB_EVENT_NAME ?? '';
  const input = { event };
  if (event === 'pull_request') {
    try {
      const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      const number = payload?.pull_request?.number;
      if (!Number.isInteger(number)) throw new Error('the event payload carries no pull request number');
      input.files = await fetchPullRequestFiles({
        api: env.GITHUB_API_URL ?? 'https://api.github.com',
        repo: env.GITHUB_REPOSITORY,
        number,
        token: env.GITHUB_TOKEN,
      });
    } catch (err) {
      input.filesError = String(err?.message ?? err);
    }
  }

  const d = decide(input);
  const lines = [`lane=${d.lane}`, ...Object.entries(d.jobs).map(([id, run]) => `${id}=${run}`)];
  console.log(`lane: ${d.lane}\nreason: ${d.reason}`);
  for (const [id, run] of Object.entries(d.jobs)) console.log(`  ${run ? 'run ' : 'skip'}  ${id}`);
  if (input.filesError) console.log(`::warning title=ci-lanes failed open::${d.reason}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries(d.jobs).map(([id, run]) => `| \`${id}\` | ${JOBS[id]} | ${run ? 'run' : 'skip'} |`);
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### CI lane: \`${d.lane}\`\n\n${d.reason}\n\n| job | kind | decision |\n|---|---|---|\n${rows.join('\n')}\n`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
