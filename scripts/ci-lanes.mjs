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
 *   only       a `workflow_dispatch` whose `only` input names one job id in
 *              `JOBS`: that job runs, every other job is `false`. `all`, an
 *              empty value, or a name not in `JOBS` -> `full`. Exists so a manual
 *              re-check of one job does not queue every job on the org's shared
 *              runners. (`starter` still starts all five legs either way: it is
 *              step-gated, so for any other `only` its legs run the every-lane
 *              guards only, under `[only <job>] Starter (<name>)`.) It narrows
 *              ONLY after every page of open pull requests positively shows
 *              none has this commit as its head; an open one (fork PRs
 *              included), or a failed lookup, is the full lane (see
 *              `decideLane` and `openPullRequestsAtSha`).
 *   release    the changesets Version Packages PR, when its diff is ONLY release
 *              machinery (`RELEASE_FILES`) AND every package.json in it changed
 *              only `version` and workspace-dependency versions (read from the
 *              two blobs, not from the path). Runs `RELEASE_LANE_JOBS`: the
 *              install + build + tarball check (`packaging`), the pin guard
 *              (`starter-pins`), and the `starter` legs' every-lane steps, which
 *              are `pnpm test:guards` and the workspace-override guard. Anything
 *              short of a clean positive classification -> `full`.
 *   tree-already-tested
 *              a push to main whose commit TREE is byte-for-byte a tree that a
 *              completed, green, FULL-lane pull_request run already tested
 *              (`pushGate`). Core jobs off; the advisory five still run,
 *              because they read live services and a PR run says nothing about
 *              those today. Anything short of a verified match -> `full`.
 *
 * The per-job outputs for core jobs and the `starter` matrix's step gating are
 * how the release lane (and the push-to-main tested-tree skip) turn core jobs
 * off. They are not dead code.
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
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE LEDGER: every job in ci.yml except `lanes` itself, and the kind that
 * decides its lane behaviour. `tests/guards/ci-lanes-ledger.test.mjs` fails when
 * ci.yml's job set and this map differ in EITHER direction, so a job cannot be
 * added, removed or renamed without deciding its lane here.
 *
 *   core      runs on every pull_request, push and workflow_dispatch (except a
 *             dispatch narrowed by `only` to another job).
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
  'agent-runner': 'core',
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
  'node scripts/check-generated-version.mjs',
]);

/** The head branch `changesets/action` (release.yml) force-pushes the Version Packages PR to. */
export const RELEASE_BRANCH = 'changeset-release/main';

/**
 * What runs on a release-lane PR, as a set: every other job's output is `false`.
 * `starter` is not here, so its heavy steps are off; its every-lane steps
 * (`UNGATED_STEPS`, which include both release guards) still run in all five legs.
 *
 * THE TRADE, AS IT ACTUALLY IS. A version bump does not change what any job
 * BUILDS against: the root `pnpm.overrides` pin every `@civitai/*` workspace
 * package to `workspace:*`, so the starters and packages resolve the same
 * local code whatever the carets say. It can still break a job that READS a
 * version. The one known case is a `version.generated.ts` left behind its
 * package.json, which `design-system` (off in this lane) is the only job to
 * check; that check therefore also runs as an every-lane step
 * (`UNGATED_STEPS`). No other version-reading check in a dropped job is known,
 * and none is covered here if one exists. What the lane drops beyond that is
 * the release PR RE-TESTING MAIN'S CODE right before a publish. `release.yml` publishes on
 * the merge push and does not wait for CI, so if main ever carries a red core
 * job, a green release-lane PR can merge and publish it. The full-suite run on
 * the release PR was the last thing that would have been red in front of
 * whoever merges. Measured exposure when this was written: 0 of 100 recent
 * push-to-main runs were red on a core job, and 2 of 17 release-PR runs with a
 * core failure failed on a step this lane drops: both were `playwright install
 * --with-deps` in dropped jobs, and 0 were a typecheck, test or build step.
 */
export const RELEASE_LANE_JOBS = Object.freeze(['packaging', 'starter-pins']);

/**
 * The files a Version Packages PR may touch, with the change kind it may make.
 * MEASURED, not designed: the union over the 14 release PRs merged between
 * 2026-10-03 and 2026-10-12 (`gh api pulls/<n>/files`) was exactly these six
 * shapes, plus ONE test file a human pushed onto the release branch by hand
 * (#535), which is the case that must get the full suite and does, by not
 * being here. No release PR in that sample touched `pnpm-lock.yaml`: the root
 * `pnpm.overrides` pin every workspace package to `workspace:*`, so the
 * lockfile does not churn on a bump. A lockfile change is therefore NOT release
 * machinery here and runs the full suite.
 *
 * `content` names the blob check `checkReleaseContent` applies; a path is
 * release-only only if its status matches AND its content check passes.
 */
export const RELEASE_FILES = Object.freeze([
  { glob: '.changeset/*.md', status: 'removed', content: null },
  { glob: 'packages/*/CHANGELOG.md', status: 'modified', content: null },
  { glob: 'packages/*/package.json', status: 'modified', content: 'package-json' },
  { glob: 'packages/*/src/version.generated.ts', status: 'modified', content: 'version-constant' },
  { glob: 'starters/*/package.json', status: 'modified', content: 'package-json' },
  { glob: 'starters/examples/*/package.json', status: 'modified', content: 'package-json' },
]);

/**
 * THE TESTED-TREE RECORD. ci.yml's `record-tree` job, on a pull_request run
 * whose `lanes` output was `full` and whose every CORE job ran its full step
 * set and succeeded, uploads an artifact named
 * `${RECORD_ARTIFACT_PREFIX}<tree sha>${RECORD_ARTIFACT_SUFFIX}`, where the tree
 * is the tested MERGE commit's (`refs/pull/<n>/merge`), i.e. what a squash
 * merge produces when main has not moved since.
 *
 * The suffix names the lane. A release-lane run never records, and the gate
 * only looks a FULL record up, so a lane-limited run cannot vouch for a tree
 * even if a later edit made it record.
 */
export const RECORD_ARTIFACT_PREFIX = 'ci-tested-tree-';
export const RECORD_ARTIFACT_SUFFIX = '-full';
export const RECORD_JOB_NAME = 'Record the tested tree';
export const WORKFLOW_PATH = '.github/workflows/ci.yml';

/**
 * Changed between the previous main tip and the pushed commit -> no skip.
 *   - ci.yml and this script: the gate's own definition. A PR run that tested
 *     this tree ran the PR's copy of them; a change to WHAT is gated must be
 *     seen running in full on main once.
 *   - pnpm-lock.yaml and the root package.json (`packageManager`): the inputs
 *     of `setup-node`'s pnpm cache key. Pull-request runs RESTORE caches from
 *     main but cannot write them there; a main that skips every install after
 *     a lockfile change leaves every later PR on a cold cache.
 */
export const GATE_INPUTS = Object.freeze([WORKFLOW_PATH, 'scripts/ci-lanes.mjs', 'pnpm-lock.yaml', 'package.json']);

/**
 * The files that DEFINE a record: the workflow that uploads it and the
 * classifier that decides the lane it was uploaded under. A run vouches for a
 * tree only if its head commit carries the same blobs of these as the pushed
 * commit does.
 */
export const RECORD_DEFINITION = Object.freeze([WORKFLOW_PATH, 'scripts/ci-lanes.mjs']);

/** A skip never rests on a record older than this (the artifact's `created_at`). */
export const MAX_RECORD_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** What runs on main when the exact tree already passed: the advisory five, nothing else. */
export const TREE_LANE = 'tree-already-tested';

/** A manual run narrowed to one job by its `only` input. */
export const ONLY_LANE = 'only';

/**
 * The `lanes` output the `Starter` job's `name:` reads. Empty in every lane but
 * a narrowed dispatch (`only` naming a job other than `starter`), so on
 * pull_request, push, release, tree-skip and unnarrowed dispatch runs the five
 * legs keep their required names `Starter (<name>)` byte for byte. In a
 * narrowed run the legs do only their guards, and the prefix keeps that
 * success off the required contexts.
 *
 * Why only Starter is renamed: GitHub never evaluates a `name:` expression of
 * a job it skips (the check run shows the literal `${{ ... }}`), and the
 * release and tree-skip lanes skip required jobs, which must still report
 * `skipped` under their exact names. Starter is never skipped by its lane (it
 * is step-gated), so its name expression is always evaluated. The skipped jobs
 * of a narrowed run keep their names; `decide` refuses to narrow at the head of
 * an open pull request instead.
 */
export const NAME_PREFIX_OUTPUT = 'name-prefix';
export const narrowedNamePrefix = (only) => `[only ${only}] `;

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

  // schema-drift: curl + diff of the vendored manifest schema…
  { glob: 'packages/civitai-app-sdk/schemas/app-block/v1.json', jobs: ['schema-drift'] },
  { glob: 'scripts/check-canonical-schema.sh', jobs: ['schema-drift'] },
  // …and the document-store contract @civitai/sdk vendors, byte-diffed the same way.
  { glob: 'packages/civitai-sdk/schemas/app-block/storage-contract.v1.json', jobs: ['schema-drift'] },
  { glob: 'scripts/check-storage-contract.sh', jobs: ['schema-drift'] },

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
  { glob: 'packages/civitai-agent-runner/**', jobs: NONE },
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

const RELEASE_COMPILED = RELEASE_FILES.map((r) => ({ ...r, re: globToRegExp(r.glob) }));

/**
 * The release-file rule a changed-file entry satisfies, or a string saying why
 * it is not release machinery. Pure; the blob half is `checkReleaseContent`.
 */
export function releaseRuleFor(f) {
  if (typeof f?.filename !== 'string' || f.filename === '') return 'a changed-file entry has no filename';
  if (f.previous_filename) return `${f.filename} is a rename`;
  const rule = RELEASE_COMPILED.find((r) => r.re.test(f.filename));
  if (!rule) return `${f.filename} is not release machinery`;
  if (f.status !== rule.status) return `${f.filename} is ${f.status ?? 'of unknown status'}, a release only ever ${rule.status} it`;
  return rule;
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
/** What `changeset version` writes: a plain version, or a caret/tilde/>= range on one. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RELEASE_RANGE = /^(?:[\^~]|>=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?: <\d+\.\d+\.\d+)?$/;

/**
 * Why `head` is more than a version bump of `base`, or null when it is not.
 * Masks `version` and every WORKSPACE package's entry in the four dependency
 * maps, then requires the rest of the document to be identical; each masked
 * value that changed must still look like a version (a `workspace:`, `file:`
 * or git specifier does not).
 */
export function packageJsonBumpProblem(baseText, headText, workspaceNames) {
  let base;
  let head;
  try {
    base = JSON.parse(baseText);
    head = JSON.parse(headText);
  } catch (err) {
    return `does not parse as JSON (${err.message})`;
  }
  if (!base || !head || typeof base !== 'object' || typeof head !== 'object') return 'is not a JSON object';
  const mask = (doc) => {
    const copy = structuredClone(doc);
    delete copy.version;
    for (const field of DEP_FIELDS) {
      if (!copy[field] || typeof copy[field] !== 'object') continue;
      for (const name of Object.keys(copy[field])) if (workspaceNames.has(name)) copy[field][name] = '<release>';
    }
    return JSON.stringify(copy);
  };
  if (mask(base) !== mask(head)) return 'changes something other than `version` and workspace dependency versions';
  if (base.version !== head.version && (typeof head.version !== 'string' || !VERSION.test(head.version))) {
    return `sets version to ${JSON.stringify(head.version)}`;
  }
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(head[field] ?? {})) {
      if (!workspaceNames.has(name) || base[field]?.[name] === head[field][name]) continue;
      const v = head[field][name];
      if (typeof v !== 'string' || !RELEASE_RANGE.test(v)) return `sets ${field}.${name} to ${JSON.stringify(v)}`;
    }
  }
  return null;
}

/** The `VERSION = "x"` literal of a generated version module, or null. */
const versionConstant = (text) => text.match(/^export const VERSION = "([^"]+)";$/m)?.[1] ?? null;

/**
 * Why a release PR's blobs are more than a version bump, or null when every
 * changed file is. `fetchBlob(path, side)` returns the file's text at the
 * PR's `base` or `head` commit and THROWS on any failure; a throw here is
 * caught by the caller and fails open.
 */
export async function checkReleaseContent(files, { fetchBlob, workspaceNames }) {
  if (!(workspaceNames instanceof Set) || workspaceNames.size === 0) return 'no workspace package names to mask';
  for (const f of files) {
    const rule = releaseRuleFor(f);
    if (typeof rule === 'string') return rule;
    if (rule.content === 'package-json') {
      const problem = packageJsonBumpProblem(await fetchBlob(f.filename, 'base'), await fetchBlob(f.filename, 'head'), workspaceNames);
      if (problem) return `${f.filename} ${problem}`;
    } else if (rule.content === 'version-constant') {
      const [base, head] = [await fetchBlob(f.filename, 'base'), await fetchBlob(f.filename, 'head')];
      const headVersion = versionConstant(head);
      if (!headVersion || !versionConstant(base)) return `${f.filename} has no parseable VERSION constant`;
      if (base.replace(versionConstant(base), '<v>') !== head.replace(headVersion, '<v>')) {
        return `${f.filename} changes more than its VERSION constant`;
      }
      // Whether the stamped version MATCHES package.json is not decided here.
      // A drifted module is most often one that was not regenerated, so it is
      // absent from the diff and no file walk can see it; the every-lane step
      // `node scripts/check-generated-version.mjs` reads the tree instead.
    }
  }
  return null;
}

/**
 * The decision, as a pure function of what the run knows.
 *
 * @param {object} input
 * @param {string} input.event        `github.event_name`
 * @param {Array<{filename: string, previous_filename?: string}>} [input.files]
 *        the pull request's changed files (pull_request only)
 * @param {string} [input.filesError] set when the file list could not be computed
 * @param {object} [input.release] pull_request only, and only when the head is
 *        `RELEASE_BRANCH` in this repository: `{ problem }`, where `problem` is
 *        null when `checkReleaseContent` found nothing but a version bump
 * @param {object} [input.pushGate] push only: `pushGate`'s verdict; ONLY
 *        `skip === true` skips anything, and only on `push`
 * @param {string} [input.only] workflow_dispatch only: the `only` input. Only
 *        an own key of `JOBS` narrows anything, and only on `workflow_dispatch`
 * @param {number[]} [input.openPrsAtSha] workflow_dispatch only: open pull
 *        requests whose head is this commit. Narrowing needs an EMPTY list;
 *        absent (lookup failed or not made) is the full lane
 * @param {string} [input.prLookupError] why that lookup failed, for the reason
 * @returns {{ lane: string, reason: string, jobs: Record<string, boolean>, namePrefix: string }}
 */
export function decide(input = {}) {
  // `namePrefix` is '' in every lane but a narrowed one; see NAME_PREFIX_OUTPUT.
  return { namePrefix: '', ...decideLane(input) };
}

function decideLane({ event, files, filesError, release, pushGate, only, openPrsAtSha, prLookupError } = {}) {
  if (event === 'workflow_dispatch' && typeof only === 'string' && Object.hasOwn(JOBS, only)) {
    // A narrowed run writes check runs for this commit under the SAME names a
    // full run does: the jobs it turns off come back `skipped` (branch
    // protection counts that as passing), and the Starter legs succeed having
    // run only their guards. At the head of an open pull request those would
    // become the newest results for its required contexts and could turn a
    // failed one green. So narrowing needs a POSITIVE "no open pull request
    // has this head"; an open one, or a lookup that failed, runs everything.
    if (!Array.isArray(openPrsAtSha)) {
      return {
        lane: 'full',
        reason: `workflow_dispatch with only=${only}, but whether this commit heads an open pull request is unknown (${prLookupError ?? 'not looked up'}): every job runs`,
        jobs: everyJob(true),
      };
    }
    if (openPrsAtSha.length > 0) {
      return {
        lane: 'full',
        reason: `workflow_dispatch with only=${only}, but this commit is the head of open pull request ${openPrsAtSha.map((n) => `#${n}`).join(', ')}: a narrowed run would report under its required check names, so every job runs`,
        jobs: everyJob(true),
      };
    }
    return {
      lane: ONLY_LANE,
      reason: `workflow_dispatch with only=${only}: ${only} runs, every other job is off`,
      jobs: Object.fromEntries(Object.keys(JOBS).map((id) => [id, id === only])),
      // The Starter legs still run (step-gated), so give them names no required
      // context matches. `only=starter` runs them in full: their real verdict
      // under their real names.
      namePrefix: only === 'starter' ? '' : narrowedNamePrefix(only),
    };
  }
  if (event === 'push' && pushGate?.skip === true) {
    return {
      lane: TREE_LANE,
      reason: `tree ${pushGate.tree} already passed in full on pull_request run ${pushGate.runId}: core jobs off, advisory jobs on`,
      jobs: Object.fromEntries(Object.keys(JOBS).map((id) => [id, JOBS[id] === 'advisory'])),
    };
  }
  if (event !== 'pull_request') {
    // push, workflow_dispatch, and any event this file has never heard of.
    const why = event === 'push' && pushGate?.reason ? ` (no skip: ${pushGate.reason})` : '';
    return { lane: 'full', reason: `${event || 'unknown event'}: every job${why}`, jobs: everyJob(true) };
  }

  const runAll = (why) => ({ lane: 'full', reason: `FAIL OPEN, every job: ${why}`, jobs: everyJob(true) });
  if (filesError) return runAll(`the changed-file list could not be computed (${filesError})`);
  if (!Array.isArray(files)) return runAll('no changed-file list was supplied');
  // A pull request with no changed files is not a state this can tell apart from
  // an API that answered with nothing.
  if (files.length === 0) return runAll('the changed-file list is empty');

  // The release lane needs BOTH halves: the head is the release branch of this
  // repository (decided by the caller from the payload, never from the actor)
  // AND `checkReleaseContent` came back with no problem. That function is the
  // ONE walk over the files: it applies `releaseRuleFor` (path + status) to
  // every entry before any blob check, so a non-release path is a problem
  // there and is not re-derived here. `problem === null` is the only accepted
  // value; undefined, a string, or a missing `release` all fall through to the
  // ordinary pull_request lane below.
  let releaseNote = '';
  if (release) {
    if (release.problem === null) {
      return {
        lane: 'release',
        reason: `release PR, version bump only (${files.length} files): ${RELEASE_LANE_JOBS.join(', ')} + the starter guards`,
        jobs: Object.fromEntries(Object.keys(JOBS).map((id) => [id, RELEASE_LANE_JOBS.includes(id)])),
      };
    }
    releaseNote = `release branch, but NOT a pure version bump (${release.problem ?? 'content not checked'}); full suite. `;
  }

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
  const reason = releaseNote + (unclassified.length
    ? `unclassified path(s) select every advisory job: ${unclassified.slice(0, 5).join(', ')}`
    : ran.length
      ? `advisory jobs whose inputs changed: ${ran.join(', ')}`
      : 'no advisory job reads any changed path');
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

const HEX40 = /^[0-9a-f]{40}$/;

/** At most this many pages of open pull requests are read; more is "unknown". */
export const MAX_OPEN_PR_PAGES = 10;

/**
 * Numbers of the OPEN pull requests whose head is exactly `sha`, or a thrown
 * error. Never a guess: a malformed sha, a non-200, a non-list body, a `next`
 * link off the API origin, or more than `MAX_OPEN_PR_PAGES` pages all throw,
 * and the caller then runs every job.
 *
 * It reads `pulls?state=open` (every page, following the `Link: rel="next"`
 * header) and matches `head.sha`, rather than asking `commits/{sha}/pulls`:
 * that endpoint omits pull requests from forks, and for a commit already on
 * the default branch it lists only the merged pull request that introduced it.
 * The open list sees both, and a second branch at the same sha still matches.
 */
export async function openPullRequestsAtSha({ api, repo, sha, token, fetchImpl = fetch }) {
  if (typeof sha !== 'string' || !HEX40.test(sha)) throw new Error(`no commit sha (${sha})`);
  const found = [];
  let url = `${api}/repos/${repo}/pulls?state=open&per_page=100`;
  for (let page = 1; url; page++) {
    if (page > MAX_OPEN_PR_PAGES) throw new Error(`more than ${MAX_OPEN_PR_PAGES} pages of open pull requests; the list is not read in full`);
    const res = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`open pull requests page ${page} answered HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error(`open pull requests page ${page} is not a list`);
    for (const p of list) if (p?.head?.sha === sha && Number.isInteger(p?.number)) found.push(p.number);
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
    // The token rides on every request, so a next page must stay on the API.
    if (next !== undefined && !next.startsWith(`${api}/`)) throw new Error(`next page ${next} is not on ${api}`);
    url = next;
  }
  return found;
}

/**
 * May this push to main skip its core jobs? Returns `{ skip, reason, tree?, runId? }`
 * and NEVER throws: every error is `skip: false`. `skip` is true only when ALL of:
 *
 *   1. `before` is a real commit and the push is a fast-forward of it;
 *   2. none of `GATE_INPUTS` changed between `before` and `sha`, judged from a
 *      complete compare (300 files is the compare API's cap; at the cap the
 *      list may be truncated and a gate input could hide past it);
 *   3. an unexpired `<prefix><tree><suffix>` artifact, no older than
 *      `MAX_RECORD_AGE_MS`, exists, uploaded by a run of THIS repository's
 *      ci.yml on a pull_request from THIS repository;
 *   4. that run's CURRENT state, read now and not from the artifact, is
 *      `completed`/`success` (a re-run that failed flips it), and its latest
 *      attempt's `Record the tested tree` job concluded `success`;
 *   5. the run's head commit carries the SAME `ci.yml` and `scripts/ci-lanes.mjs`
 *      blobs as the pushed commit (`RECORD_DEFINITION`).
 *
 * 🔴 WHO CAN FORGE A RECORD, AND WHAT (5) IS FOR. A pull_request run executes
 * the PR's own copy of ci.yml, so ANY pull request whose branch edits ci.yml
 * can upload an artifact under any name without testing anything, a
 * same-repository branch just as easily as a fork. Excluding forks (3) removes
 * the people without write access; it does not make a same-repository run
 * honest. (5) narrows that, and only that: a run may vouch only if the workflow
 * and classifier on its head are byte-for-byte the ones on the pushed commit,
 * so the record was uploaded by the DEFINITION main is about to trust (the real
 * `record-tree` condition and its real tree computation), not by an edited
 * copy. It binds the workflow definition to the pushed commit. It does NOT
 * bind the artifact's name to the tree the run tested by any independent
 * means: that the name carries the tested tree is a property of that trusted
 * definition, and is as good as it is. The run actually executed its MERGE
 * commit's copies; where those differ from its head's, they came from main as
 * it was then.
 */
export async function pushGate({ api, repo, token, sha, before, fetchImpl = fetch, now = Date.now() }) {
  const no = (reason) => ({ skip: false, reason });
  try {
    if (!HEX40.test(sha ?? '')) return no('no pushed sha');
    if (!HEX40.test(before ?? '') || /^0+$/.test(before)) return no('no previous main tip to compare with');
    const get = async (path) => {
      const res = await fetchImpl(`${api}/repos/${repo}/${path}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`${path.split('?')[0]} answered HTTP ${res.status}`);
      return res.json();
    };

    const tree = (await get(`git/commits/${sha}`))?.tree?.sha;
    if (!HEX40.test(tree ?? '')) return no('the pushed commit has no readable tree');

    const cmp = await get(`compare/${before}...${sha}`);
    if (cmp?.status !== 'ahead') return no(`the push is not a fast-forward of ${before} (compare: ${cmp?.status})`);
    if (!Array.isArray(cmp.files) || cmp.files.length >= 300) return no('the compare file list is missing or may be truncated');
    const touched = cmp.files
      .flatMap((f) => [f?.filename, f?.previous_filename])
      .filter((p) => GATE_INPUTS.includes(p));
    if (touched.length) return no(`the push changes ${[...new Set(touched)].join(', ')}`);

    const name = `${RECORD_ARTIFACT_PREFIX}${tree}${RECORD_ARTIFACT_SUFFIX}`;
    const listed = await get(`actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
    if (!Array.isArray(listed?.artifacts)) return no('the artifact listing is not a list');
    const fresh = (a) => {
      const age = now - Date.parse(a.created_at);
      return Number.isFinite(age) && age >= 0 && age <= MAX_RECORD_AGE_MS;
    };
    const candidates = listed.artifacts
      .filter((a) => a?.name === name && a.expired === false && fresh(a))
      .filter((a) => a.workflow_run && a.workflow_run.repository_id === a.workflow_run.head_repository_id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 5);
    if (!candidates.length) return no(`no unexpired same-repository record under ${MAX_RECORD_AGE_MS / 86_400_000} days old named ${name}`);

    const blobOf = async (path, ref) => {
      const blob = (await get(`contents/${path}?ref=${ref}`))?.sha;
      if (!HEX40.test(blob ?? '')) throw new Error(`no blob sha for ${path}@${ref}`);
      return blob;
    };
    const pushed = {};
    for (const path of RECORD_DEFINITION) pushed[path] = await blobOf(path, sha);

    const rejected = [];
    for (const a of candidates) {
      const id = a.workflow_run.id;
      const run = await get(`actions/runs/${id}`);
      const why =
        run?.event !== 'pull_request' ? `event ${run?.event}`
        : run?.path !== WORKFLOW_PATH ? `workflow ${run?.path}`
        : run?.head_repository?.full_name !== repo ? `head repository ${run?.head_repository?.full_name}`
        : run?.status !== 'completed' ? `status ${run?.status}`
        : run?.conclusion !== 'success' ? `conclusion ${run?.conclusion}`
        : null;
      if (why) {
        rejected.push(`run ${id}: ${why}`);
        continue;
      }
      const jobs = await get(`actions/runs/${id}/jobs?filter=latest&per_page=100`);
      const record = (jobs?.jobs ?? []).filter((j) => j?.name === RECORD_JOB_NAME);
      if (record.length !== 1 || record[0].conclusion !== 'success') {
        rejected.push(`run ${id}: its latest ${RECORD_JOB_NAME} job is ${record.map((j) => j.conclusion).join(',') || 'absent'}`);
        continue;
      }
      if (!HEX40.test(run.head_sha ?? '')) {
        rejected.push(`run ${id}: no head sha`);
        continue;
      }
      let differs = null;
      for (const path of RECORD_DEFINITION) {
        if ((await blobOf(path, run.head_sha)) !== pushed[path]) differs = path;
      }
      if (differs) {
        rejected.push(`run ${id}: its head has a different ${differs} than the pushed commit`);
        continue;
      }
      return { skip: true, reason: `matched run ${id}`, tree, runId: id };
    }
    return no(`a record exists but no run vouches for it (${rejected.join('; ')})`);
  } catch (err) {
    return no(`API error: ${err?.message ?? err}`);
  }
}

/**
 * The Version Packages PR: head branch `RELEASE_BRANCH`, pushed to THIS
 * repository (a fork can name a branch anything), into `main`. The actor is
 * deliberately not consulted; a human pushing to the branch is the case the
 * content check exists for.
 */
export function isReleaseHead(payload, repository) {
  const pr = payload?.pull_request;
  return (
    pr?.head?.ref === RELEASE_BRANCH &&
    typeof repository === 'string' &&
    pr?.head?.repo?.full_name === repository &&
    pr?.base?.ref === 'main'
  );
}

/** `@civitai/*` names of the packages in this checkout's `packages/` directory. */
export function workspacePackageNames(root = fileURLToPath(new URL('..', import.meta.url))) {
  const names = new Set();
  for (const e of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const file = join(root, 'packages', e.name, 'package.json');
    if (e.isDirectory() && existsSync(file)) names.add(JSON.parse(readFileSync(file, 'utf8')).name);
  }
  return names;
}

/** `fetchBlob(path, 'base'|'head')` over the contents API; throws on anything but a 200. */
export function blobFetcher({ api, repo, token, shas, fetchImpl = fetch }) {
  return async (path, side) => {
    const sha = shas?.[side];
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no ${side} sha`);
    const res = await fetchImpl(`${api}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, {
      headers: {
        accept: 'application/vnd.github.raw+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`contents ${path}@${side} answered HTTP ${res.status}`);
    return res.text();
  };
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
      if (isReleaseHead(payload, env.GITHUB_REPOSITORY)) {
        input.release = { problem: 'content not checked' };
        try {
          input.release.problem = await checkReleaseContent(input.files, {
            fetchBlob: blobFetcher({
              api: env.GITHUB_API_URL ?? 'https://api.github.com',
              repo: env.GITHUB_REPOSITORY,
              token: env.GITHUB_TOKEN,
              shas: { base: payload.pull_request.base.sha, head: payload.pull_request.head.sha },
            }),
            workspaceNames: workspacePackageNames(),
          });
        } catch (err) {
          input.release.problem = `the release content check failed (${err?.message ?? err})`;
        }
      }
    } catch (err) {
      input.filesError = String(err?.message ?? err);
    }
  }

  if (event === 'workflow_dispatch') {
    // The dispatch inputs ride in the event payload; an unreadable payload
    // leaves `only` unset, which is the full lane (fail open).
    try {
      const only = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))?.inputs?.only;
      if (typeof only === 'string') input.only = only;
    } catch {
      // full lane
    }
    // Only a narrowing `only` needs to know; a failed lookup runs everything.
    if (typeof input.only === 'string' && Object.hasOwn(JOBS, input.only)) {
      try {
        input.openPrsAtSha = await openPullRequestsAtSha({
          api: env.GITHUB_API_URL ?? 'https://api.github.com',
          repo: env.GITHUB_REPOSITORY,
          sha: env.GITHUB_SHA,
          token: env.GITHUB_TOKEN,
        });
      } catch (err) {
        input.prLookupError = String(err?.message ?? err);
        console.log(`::warning title=only ignored::the open pull request lookup failed (${input.prLookupError}); every job runs`);
      }
    }
  }

  if (event === 'push') {
    let before;
    try {
      before = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))?.before;
    } catch {
      before = undefined;
    }
    input.pushGate = await pushGate({
      api: env.GITHUB_API_URL ?? 'https://api.github.com',
      repo: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
      sha: env.GITHUB_SHA,
      before,
    });
  }

  const d = decide(input);
  const lines = [
    `lane=${d.lane}`,
    ...Object.entries(d.jobs).map(([id, run]) => `${id}=${run}`),
    `${NAME_PREFIX_OUTPUT}=${d.namePrefix}`,
  ];
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
