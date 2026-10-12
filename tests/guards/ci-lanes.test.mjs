/**
 * The decision table for `scripts/ci-lanes.mjs`: given an event and a changed-
 * file list, which ci.yml jobs run.
 *
 * Expected values are written out as literals, row by row. They are NOT derived
 * from `RULES`: a table computed from the implementation agrees with it by
 * construction and cannot see a wrong rule.
 *
 * The property that matters most is FAIL OPEN, so it has the most rows: a diff
 * that could not be computed, an empty one, a malformed entry and a path the
 * table has never heard of must each run MORE, never less.
 *
 * What this cannot see: whether ci.yml reads these outputs
 * (`ci-lanes-ledger.test.mjs`), and whether GitHub evaluates the job condition
 * the way ci.yml's comment says (only a real run shows that).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  JOBS,
  ADVISORY_JOBS,
  CORE_JOBS,
  RELEASE_BRANCH,
  blobFetcher,
  checkReleaseContent,
  classifyPath,
  decide,
  fetchPullRequestFiles,
  globToRegExp,
  isReleaseHead,
  packageJsonBumpProblem,
  pushGate,
} from '../../scripts/ci-lanes.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'ci-lanes.mjs');

const SCHEMA = 'schema-drift';
const PINS = 'starter-pins';
const CATALOG = 'orchestrator-catalog-drift';
const XBROWSER = 'design-system-cross-browser';
const DRIFT = 'design-system-drift-guard';
const ALL_FIVE = [SCHEMA, PINS, CATALOG, XBROWSER, DRIFT];

const pr = (...paths) => ({ event: 'pull_request', files: paths.map((filename) => ({ filename })) });
/** The advisory jobs a decision runs, sorted, so rows compare as sets. */
const advisoryRun = (d) => ADVISORY_JOBS.filter((id) => d.jobs[id]).sort();
const coreRun = (d) => CORE_JOBS.filter((id) => d.jobs[id]);

describe('pull_request: an advisory job runs only when the diff touches what it reads', () => {
  /** [label, changed paths, the advisory jobs that must run] */
  const ROWS = [
    ['docs only', ['README.md', 'docs/guide/intro.md', 'claudedocs/handoff.md'], []],
    ['a package README is still inside that package', ['packages/civitai-theme/README.md'], [XBROWSER, DRIFT]],
    ['the vendored schema', ['packages/civitai-app-sdk/schemas/app-block/v1.json'], [SCHEMA]],
    ['the schema check script', ['scripts/check-canonical-schema.sh'], [SCHEMA]],
    ['the catalog fixture', ['packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json'], [CATALOG]],
    ['the catalog source', ['packages/civitai-app-sdk/src/orchestrator/index.ts'], [CATALOG]],
    ['the catalog check script', ['scripts/check-orchestrator-catalogs.mjs'], [CATALOG]],
    ['the module the catalog check imports', ['scripts/orchestrator-catalog-placeholder.mjs'], [CATALOG]],
    ['the pins check script', ['scripts/check-starter-pins.mjs'], [PINS]],
    ['a starter pin', ['starters/next-app/package.json'], [PINS]],
    ['an example pin, two levels down', ['starters/examples/hello-world/package.json'], [PINS]],
    ['a package version (the bound the pins check reads)', ['packages/civitai-blocks-react/package.json'], [PINS]],
    ['starter source, not its package.json', ['starters/next-app/src/app/page.tsx'], []],
    ['another SDK source file', ['packages/civitai-app-sdk/src/oauth/pkce.ts'], []],
    ['blocks-react source', ['packages/civitai-blocks-react/src/index.ts'], []],
    ['theme source', ['packages/civitai-theme/src/theme.source.ts'], [XBROWSER, DRIFT]],
    ['components source', ['packages/civitai-components/src/elements/button.ts'], [XBROWSER]],
    ['@civitai/sdk source', ['packages/civitai-sdk/src/index.ts'], [XBROWSER]],
    ['the lockfile', ['pnpm-lock.yaml'], [XBROWSER, DRIFT]],
    ['the root manifest', ['package.json'], [XBROWSER, DRIFT]],
    ['an unrelated script', ['scripts/measure-css-split.mjs'], []],
    ['a guard test', ['tests/guards/boot-skeleton.test.mjs'], []],
    ['another workflow', ['.github/workflows/release.yml'], []],
    ['ci.yml itself', ['.github/workflows/ci.yml'], ALL_FIVE],
    ['the classifier itself', ['scripts/ci-lanes.mjs'], ALL_FIVE],
    ['an UNKNOWN top-level file', ['Makefile'], ALL_FIVE],
    ['an UNKNOWN package directory', ['packages/civitai-new-thing/src/index.ts'], ALL_FIVE],
    ['one unknown path among known ones', ['README.md', 'tools/x.sh'], ALL_FIVE],
    ['the union over several files', ['README.md', 'scripts/check-canonical-schema.sh', 'starters/react-pwa/package.json'], [SCHEMA, PINS]],
  ];

  for (const [label, paths, expected] of ROWS) {
    test(label, () => {
      const d = decide(pr(...paths));
      assert.deepEqual(advisoryRun(d), [...expected].sort());
      assert.deepEqual(coreRun(d), CORE_JOBS, 'a core job was turned off on a pull request');
      assert.equal(d.lane, 'full');
    });
  }

  test('a rename counts under BOTH names', () => {
    const d = decide({
      event: 'pull_request',
      files: [{ filename: 'docs/v1.json', previous_filename: 'packages/civitai-app-sdk/schemas/app-block/v1.json' }],
    });
    assert.deepEqual(advisoryRun(d), [SCHEMA]);
  });
});

describe('FAIL OPEN: anything that is not a clean classification runs every job', () => {
  const everything = Object.keys(JOBS);
  const ROWS = [
    ['the diff could not be computed', { event: 'pull_request', filesError: 'HTTP 502' }],
    ['a diff error wins over a file list that looks fine', { event: 'pull_request', filesError: 'x', files: [{ filename: 'README.md' }] }],
    ['an empty diff', { event: 'pull_request', files: [] }],
    ['no file list at all', { event: 'pull_request' }],
    ['a file list that is not a list', { event: 'pull_request', files: { filename: 'README.md' } }],
    ['an entry with no filename', { event: 'pull_request', files: [{ filename: 'README.md' }, {}] }],
    ['an entry whose filename is not a string', { event: 'pull_request', files: [{ filename: 7 }] }],
    ['a null entry', { event: 'pull_request', files: [null] }],
    ['push to main', { event: 'push' }],
    // Path scoping is a pull_request behaviour only, even if a file list is somehow present.
    ['push to main carrying a docs-only file list', { event: 'push', files: [{ filename: 'README.md' }] }],
    ['workflow_dispatch', { event: 'workflow_dispatch' }],
    ['an event this script has never heard of', { event: 'merge_group' }],
    ['no event at all', {}],
  ];
  for (const [label, input] of ROWS) {
    test(label, () => {
      const d = decide(input);
      assert.deepEqual(Object.keys(d.jobs).filter((id) => d.jobs[id]), everything);
    });
  }

  test('the three error rows say FAIL OPEN in the reason a human reads', () => {
    for (const input of [{ event: 'pull_request', filesError: 'HTTP 502' }, { event: 'pull_request', files: [] }]) {
      assert.match(decide(input).reason, /^FAIL OPEN, every job: /);
    }
    assert.match(decide({ event: 'pull_request', filesError: 'HTTP 502' }).reason, /HTTP 502/);
  });
});

describe('schedule: the advisory jobs and nothing else', () => {
  test('all five advisory jobs run and every core job is off', () => {
    const d = decide({ event: 'schedule' });
    assert.deepEqual(advisoryRun(d), [...ALL_FIVE].sort());
    assert.deepEqual(coreRun(d), []);
    assert.equal(d.lane, 'scheduled');
  });
});

describe('the decision always covers the whole ledger', () => {
  test('every input yields exactly one boolean per ledger job', () => {
    for (const input of [{ event: 'schedule' }, { event: 'push' }, pr('README.md'), { event: 'pull_request', filesError: 'x' }]) {
      const d = decide(input);
      assert.deepEqual(Object.keys(d.jobs), Object.keys(JOBS));
      for (const v of Object.values(d.jobs)) assert.equal(typeof v, 'boolean');
    }
  });
});

describe('globs', () => {
  test('`*` stops at a slash, `**` does not, and a leading `**/` matches the root', () => {
    assert.ok(globToRegExp('packages/*/package.json').test('packages/a/package.json'));
    assert.ok(!globToRegExp('packages/*/package.json').test('packages/a/b/package.json'));
    assert.ok(globToRegExp('starters/**/package.json').test('starters/package.json'));
    assert.ok(globToRegExp('starters/**/package.json').test('starters/a/b/package.json'));
    assert.ok(!globToRegExp('starters/**/package.json').test('starters/a/package.json.bak'));
    assert.ok(globToRegExp('**/*.md').test('README.md'));
    assert.ok(globToRegExp('**/*.md').test('a/b/c.md'));
    assert.ok(!globToRegExp('**/*.md').test('a/b/c.mdx'));
    // A dot is a dot: `package.json` must not match `packageXjson`.
    assert.ok(!globToRegExp('package.json').test('packageXjson'));
    assert.ok(!globToRegExp('package.json').test('sub/package.json'));
  });

  test('an unmatched path is reported as unclassified, not as "nobody reads it"', () => {
    assert.deepEqual(classifyPath('Makefile'), { classified: false, jobs: [...ADVISORY_JOBS] });
    assert.deepEqual(classifyPath('LICENSE'), { classified: true, jobs: [] });
  });
});

describe('fetching the changed files never returns a partial list', () => {
  const page = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ filename: `f${from + i}.md` }));
  const respond = (pages) => async (url) => {
    const p = Number(new URL(url).searchParams.get('page'));
    const body = pages[p - 1];
    if (body instanceof Error) throw body;
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  const args = (fetchImpl) => ({ api: 'https://api.invalid', repo: 'o/r', number: 1, token: 't', fetchImpl });

  test('it follows pages until a short one', async () => {
    const files = await fetchPullRequestFiles(args(respond([page(100), page(100, 100), page(3, 200)])));
    assert.equal(files.length, 203);
  });
  test('a failing LATER page rejects instead of returning the first page', async () => {
    await assert.rejects(fetchPullRequestFiles(args(respond([page(100), 502]))), /HTTP 502/);
  });
  test('a transport error rejects', async () => {
    await assert.rejects(fetchPullRequestFiles(args(respond([new Error('ECONNRESET')]))), /ECONNRESET/);
  });
  test('a body that is not a list rejects', async () => {
    await assert.rejects(fetchPullRequestFiles(args(respond([{ message: 'Not Found' }]))), /not a list/);
  });
  test('the API cap is treated as truncation', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => page(100, i * 100));
    await assert.rejects(fetchPullRequestFiles(args(respond(pages))), /truncated/);
  });
});

describe('the command, as the workflow runs it', () => {
  /** Runs the script with a scrubbed environment; returns the parsed $GITHUB_OUTPUT. */
  function run(env) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-lanes-'));
    try {
      const out = join(dir, 'out');
      writeFileSync(out, '');
      const event = join(dir, 'event.json');
      writeFileSync(event, JSON.stringify(env.payload ?? {}));
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, GITHUB_EVENT_PATH: event, ...env.vars },
      });
      const outputs = Object.fromEntries(
        readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      );
      return { stdout, outputs };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('it writes `lane` plus one true/false per ledger job', () => {
    const { outputs } = run({ vars: { GITHUB_EVENT_NAME: 'schedule' } });
    assert.deepEqual(Object.keys(outputs), ['lane', ...Object.keys(JOBS)]);
    assert.equal(outputs.lane, 'scheduled');
    assert.equal(outputs.sdk, 'false');
    assert.equal(outputs['schema-drift'], 'true');
  });

  test('an unreachable API on a pull request exits 0 with every job on, and warns', () => {
    const { stdout, outputs } = run({
      // Port 9 (discard) on loopback: refused at once, no network involved.
      vars: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: 'http://127.0.0.1:9' },
      payload: { pull_request: { number: 1 } },
    });
    for (const id of Object.keys(JOBS)) assert.equal(outputs[id], 'true', `${id} was not run on a diff error`);
    assert.match(stdout, /::warning title=ci-lanes failed open::/);
  });

  test('a pull_request event with no number in its payload fails open the same way', () => {
    const { outputs } = run({ vars: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'o/r' }, payload: {} });
    for (const id of Object.keys(JOBS)) assert.equal(outputs[id], 'true');
  });
});

describe('release lane: the Version Packages PR, when it is ONLY a version bump', () => {
  // Synthetic, but shaped like the real thing: the six file shapes and the
  // statuses seen across 14 merged release PRs.
  const WS = new Set(['@civitai/app-sdk', '@civitai/blocks-react', '@civitai/components', '@civitai/theme']);
  const RELEASE_FILES_SEEN = [
    { filename: '.changeset/brave-cats-sing.md', status: 'removed' },
    { filename: 'packages/civitai-app-sdk/CHANGELOG.md', status: 'modified' },
    { filename: 'packages/civitai-app-sdk/package.json', status: 'modified' },
    { filename: 'packages/civitai-components/package.json', status: 'modified' },
    { filename: 'packages/civitai-components/src/version.generated.ts', status: 'modified' },
    { filename: 'starters/next-app/package.json', status: 'modified' },
    { filename: 'starters/examples/hello-world/package.json', status: 'modified' },
  ];
  const pkg = (version, deps = {}, extra = {}) =>
    JSON.stringify({ name: 'x', version, ...extra, dependencies: { zod: '^3.0.0', ...deps } }, null, 2) + '\n';
  const vmod = (v) => `/* AUTOGENERATED. */\n\n/** stamped. */\nexport const VERSION = "${v}";\n`;
  /** A world where every file is a clean bump; `override` replaces one blob. */
  const world = (override = {}) => {
    const blobs = {
      'packages/civitai-app-sdk/package.json': [pkg('1.2.0'), pkg('1.3.0')],
      'packages/civitai-components/package.json': [
        pkg('2.0.0', { '@civitai/theme': '^0.4.0' }),
        pkg('2.0.1', { '@civitai/theme': '^0.5.0' }),
      ],
      'packages/civitai-components/src/version.generated.ts': [vmod('2.0.0'), vmod('2.0.1')],
      'starters/next-app/package.json': [pkg('0.0.0', { '@civitai/app-sdk': '^1.2.0' }), pkg('0.0.0', { '@civitai/app-sdk': '^1.3.0' })],
      'starters/examples/hello-world/package.json': [
        pkg('0.0.0', { '@civitai/blocks-react': '^0.9.0' }),
        pkg('0.0.0', { '@civitai/blocks-react': '^0.10.0' }),
      ],
      ...override,
    };
    let reads = 0;
    const fetchBlob = async (path, side) => {
      const pair = blobs[path];
      if (!pair) throw new Error(`no blob for ${path}`);
      reads++;
      return pair[side === 'base' ? 0 : 1];
    };
    return { fetchBlob, reads: () => reads };
  };
  const check = (files, w = world()) => checkReleaseContent(files, { fetchBlob: w.fetchBlob, workspaceNames: WS });
  const releaseDecision = async (files, w) => decide({ event: 'pull_request', files, release: { problem: await check(files, w) } });
  const on = (d) => Object.keys(d.jobs).filter((k) => d.jobs[k]);

  test('POSITIVE CONTROL: the clean world is a release, and its blobs were actually read', async () => {
    const w = world();
    assert.equal(await check(RELEASE_FILES_SEEN, w), null);
    // 4 package.json x 2 sides + the version module x 2 + its package.json once.
    assert.equal(w.reads(), 11);
    const d = await releaseDecision(RELEASE_FILES_SEEN);
    assert.equal(d.lane, 'release');
    assert.deepEqual(on(d), ['starter-pins', 'packaging']);
  });

  /** [label, the one change to the clean world, the problem it must report] */
  const NOT_A_BUMP = [
    ['a source file rides along (the #535 shape)', { files: [...RELEASE_FILES_SEEN, { filename: 'tests/guards/x.test.mjs', status: 'modified' }] }, /tests\/guards\/x\.test\.mjs is not release machinery/],
    ['the lockfile changed', { files: [...RELEASE_FILES_SEEN, { filename: 'pnpm-lock.yaml', status: 'modified' }] }, /pnpm-lock\.yaml is not release machinery/],
    ['a changeset ADDED rather than consumed', { files: [{ filename: '.changeset/new.md', status: 'added' }] }, /is added, a release only ever removed it/],
    ['a package.json added', { files: [{ filename: 'starters/new/package.json', status: 'added' }] }, /is added/],
    ['a renamed CHANGELOG', { files: [{ filename: 'packages/a/CHANGELOG.md', status: 'renamed', previous_filename: 'packages/b/CHANGELOG.md' }] }, /is a rename/],
    ['a script added to a package.json', { blob: ['packages/civitai-app-sdk/package.json', pkg('1.2.0'), pkg('1.3.0', {}, { scripts: { test: 'true' } })] }, /changes something other than/],
    ['an `exports` change', { blob: ['packages/civitai-app-sdk/package.json', pkg('1.2.0', {}, { exports: { '.': './a.js' } }), pkg('1.3.0', {}, { exports: { '.': './b.js' } })] }, /changes something other than/],
    ['a `files` change', { blob: ['packages/civitai-app-sdk/package.json', pkg('1.2.0', {}, { files: ['dist'] }), pkg('1.3.0', {}, { files: ['dist', 'src'] })] }, /changes something other than/],
    ['a THIRD-PARTY dependency range moved', { blob: ['packages/civitai-app-sdk/package.json', pkg('1.2.0'), pkg('1.3.0', { zod: '^4.0.0' })] }, /changes something other than/],
    ['a workspace dependency ADDED', { blob: ['starters/next-app/package.json', pkg('0.0.0', { '@civitai/app-sdk': '^1.2.0' }), pkg('0.0.0', { '@civitai/app-sdk': '^1.3.0', '@civitai/theme': '^0.5.0' })] }, /changes something other than/],
    ['a workspace dependency moved to workspace:*', { blob: ['starters/next-app/package.json', pkg('0.0.0', { '@civitai/app-sdk': '^1.2.0' }), pkg('0.0.0', { '@civitai/app-sdk': 'workspace:*' })] }, /sets dependencies\.@civitai\/app-sdk to "workspace:\*"/],
    ['a version that is not a version', { blob: ['packages/civitai-app-sdk/package.json', pkg('1.2.0'), pkg('latest')] }, /sets version to "latest"/],
    ['a package.json that does not parse', { blob: ['packages/civitai-app-sdk/package.json', pkg('1.2.0'), '{'] }, /does not parse/],
    ['a version module stamping the wrong version', { blob: ['packages/civitai-components/src/version.generated.ts', vmod('2.0.0'), vmod('2.0.2')] }, /stamps 2\.0\.2 but packages\/civitai-components\/package\.json is 2\.0\.1/],
    ['a version module carrying more than the constant', { blob: ['packages/civitai-components/src/version.generated.ts', vmod('2.0.0'), vmod('2.0.1') + 'export const X = 1;\n'] }, /changes more than its VERSION constant/],
  ];
  for (const [label, change, problem] of NOT_A_BUMP) {
    test(`${label} -> full suite`, async () => {
      const files = change.files ?? RELEASE_FILES_SEEN;
      const w = change.blob ? world({ [change.blob[0]]: [change.blob[1], change.blob[2]] }) : world();
      const found = await check(files, w);
      assert.match(found ?? '(null: classified as a pure bump)', problem);
      const d = decide({ event: 'pull_request', files, release: { problem: found } });
      assert.equal(d.lane, 'full');
      assert.deepEqual(CORE_JOBS.filter((id) => !d.jobs[id]), [], 'a core job was off for a release branch carrying a non-bump change');
      assert.match(d.reason, /^release branch, but NOT a pure version bump/);
    });
  }

  test('a blob that cannot be fetched throws, which the caller turns into the full suite', async () => {
    const w = world({ 'starters/next-app/package.json': undefined });
    await assert.rejects(check(RELEASE_FILES_SEEN, w), /no blob/);
    // What main() does with that throw: `problem` becomes a string.
    const d = decide({ event: 'pull_request', files: RELEASE_FILES_SEEN, release: { problem: 'the release content check failed (no blob)' } });
    assert.equal(d.lane, 'full');
  });

  test('anything but problem === null is not a release', () => {
    for (const release of [{}, { problem: undefined }, { problem: '' }, { problem: false }, { problem: 'x' }]) {
      assert.equal(decide({ event: 'pull_request', files: RELEASE_FILES_SEEN, release }).lane, 'full', JSON.stringify(release));
    }
  });

  test('a diff error on the release branch is still the full suite, everything on', () => {
    // With a clean-looking file list beside the error: the error must still win.
    for (const files of [undefined, RELEASE_FILES_SEEN]) {
      const d = decide({ event: 'pull_request', filesError: 'HTTP 502', files, release: { problem: null } });
      assert.deepEqual(on(d), Object.keys(JOBS));
    }
  });

  test('a release-shaped diff on any OTHER branch is not a release', () => {
    // `release` is absent when isReleaseHead said no; the same files then take
    // the ordinary lane, with every core job on.
    const d = decide({ event: 'pull_request', files: RELEASE_FILES_SEEN });
    assert.equal(d.lane, 'full');
    assert.deepEqual(CORE_JOBS.filter((id) => !d.jobs[id]), []);
  });

  test('no workspace names means nothing can be masked, so not a release', async () => {
    assert.match(await checkReleaseContent(RELEASE_FILES_SEEN, { fetchBlob: world().fetchBlob, workspaceNames: new Set() }), /no workspace package names/);
  });

  test('the peer-range shape changesets writes is accepted, a git URL is not', () => {
    const ws = new Set(['@civitai/sdk']);
    const peer = (v) => JSON.stringify({ version: '1.0.0', peerDependencies: { '@civitai/sdk': v } });
    assert.equal(packageJsonBumpProblem(peer('>=0.1.0 <1.0.0'), peer('>=0.2.0 <1.0.0'), ws), null);
    assert.match(packageJsonBumpProblem(peer('^0.1.0'), peer('github:civitai/x'), ws), /sets peerDependencies/);
  });
});

describe('release lane: who counts as the release branch', () => {
  const REPO = 'civitai/civitai-app-starters';
  const payload = (headRef, headRepo, baseRef = 'main') => ({
    pull_request: { head: { ref: headRef, repo: { full_name: headRepo } }, base: { ref: baseRef } },
  });
  test('the release branch of THIS repository into main', () => {
    assert.equal(RELEASE_BRANCH, 'changeset-release/main');
    assert.equal(isReleaseHead(payload(RELEASE_BRANCH, REPO), REPO), true);
  });
  test('the same branch name pushed from a FORK', () => {
    assert.equal(isReleaseHead(payload(RELEASE_BRANCH, 'someone/civitai-app-starters'), REPO), false);
  });
  test('another branch, another base, a missing payload', () => {
    assert.equal(isReleaseHead(payload('feature/x', REPO), REPO), false);
    assert.equal(isReleaseHead(payload(RELEASE_BRANCH, REPO, 'next'), REPO), false);
    assert.equal(isReleaseHead({}, REPO), false);
    assert.equal(isReleaseHead(payload(RELEASE_BRANCH, REPO), undefined), false);
  });
});

describe('the blob fetcher', () => {
  const SHA = 'a'.repeat(40);
  test('reads the raw file at the requested side, and throws on a non-200', async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return url.includes('missing') ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => 'body' };
    };
    const get = blobFetcher({ api: 'https://api.invalid', repo: 'o/r', shas: { base: SHA, head: 'b'.repeat(40) }, fetchImpl });
    assert.equal(await get('packages/a/package.json', 'base'), 'body');
    assert.equal(seen[0], `https://api.invalid/repos/o/r/contents/packages/a/package.json?ref=${SHA}`);
    await assert.rejects(get('missing.json', 'head'), /HTTP 404/);
  });
  test('a missing or malformed sha throws before any request', async () => {
    const get = blobFetcher({ api: 'x', repo: 'o/r', shas: { base: 'main' }, fetchImpl: async () => assert.fail('fetched') });
    await assert.rejects(get('a', 'base'), /no base sha/);
    await assert.rejects(get('a', 'head'), /no head sha/);
  });
});

describe('push gate: main skips its core jobs only for an exact, verified, full-lane tested tree', () => {
  const REPO = 'civitai/civitai-app-starters';
  const SHA = '1'.repeat(40);
  const BEFORE = '2'.repeat(40);
  const TREE = '3'.repeat(40);
  const OTHER_TREE = '4'.repeat(40);
  const RUN = 900;
  const REPO_ID = 77;
  const NAME = `ci-tested-tree-${TREE}-full`;

  /** A fake GitHub API in which the push is skip-eligible; `edit` perturbs ONE thing. */
  function world(edit = (w) => w) {
    const w = edit({
      commit: { tree: { sha: TREE } },
      compare: { status: 'ahead', files: [{ filename: 'packages/civitai-app-sdk/src/x.ts' }] },
      artifacts: [
        {
          name: NAME,
          expired: false,
          created_at: '2000-01-01T00:00:00Z',
          workflow_run: { id: RUN, repository_id: REPO_ID, head_repository_id: REPO_ID },
        },
      ],
      run: {
        id: RUN,
        event: 'pull_request',
        path: '.github/workflows/ci.yml',
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: REPO },
      },
      jobs: [{ name: 'Record the tested tree', conclusion: 'success' }, { name: 'SDK (typecheck + test + build)', conclusion: 'success' }],
      fail: null,
    });
    const calls = [];
    const fetchImpl = async (url) => {
      const path = url.replace(`https://api.invalid/repos/${REPO}/`, '');
      calls.push(path);
      const route = path.startsWith('git/commits/')
        ? 'commit'
        : path.startsWith('compare/')
          ? 'compare'
          : path.startsWith('actions/artifacts')
            ? 'artifacts'
            : /^actions\/runs\/\d+\/jobs/.test(path)
              ? 'jobs'
              : /^actions\/runs\/\d+$/.test(path)
                ? 'run'
                : 'unknown';
      if (w.fail === route) return { ok: false, status: 502, json: async () => ({}) };
      if (w.fail === `${route}:throw`) throw new Error('ECONNRESET');
      const id = Number(path.match(/^actions\/runs\/(\d+)/)?.[1]);
      const body = {
        commit: w.commit,
        compare: w.compare,
        artifacts: { artifacts: w.artifacts },
        run: w.runs?.[id] ?? w.run,
        jobs: { jobs: w.jobsById?.[id] ?? w.jobs },
      }[route];
      return { ok: true, status: 200, json: async () => body };
    };
    return { fetchImpl, calls };
  }
  const gate = (w, over = {}) => pushGate({ api: 'https://api.invalid', repo: REPO, token: 't', sha: SHA, before: BEFORE, fetchImpl: w.fetchImpl, ...over });

  test('POSITIVE CONTROL: the clean world skips, after asking every endpoint', async () => {
    const w = world();
    const g = await gate(w);
    assert.deepEqual(g, { skip: true, reason: `matched run ${RUN}`, tree: TREE, runId: RUN });
    assert.deepEqual(
      w.calls.map((c) => c.split('?')[0]),
      [`git/commits/${SHA}`, `compare/${BEFORE}...${SHA}`, 'actions/artifacts', `actions/runs/${RUN}`, `actions/runs/${RUN}/jobs`],
    );
    assert.ok(w.calls[2].includes(`name=${NAME}`), 'the artifact lookup is not by the full-lane name');
    assert.ok(w.calls[4].includes('filter=latest'), 'the record job is not read from the LATEST attempt');
    const d = decide({ event: 'push', pushGate: g });
    assert.equal(d.lane, 'tree-already-tested');
    assert.deepEqual(Object.keys(d.jobs).filter((k) => d.jobs[k]).sort(), [...ADVISORY_JOBS].sort());
  });

  /** [label, the one perturbation, the reason it must give] */
  const FAIL_OPEN = [
    ['tree mismatch: the only record is for another tree', (w) => ({ ...w, artifacts: [{ ...w.artifacts[0], name: `ci-tested-tree-${OTHER_TREE}-full` }] }), /no unexpired same-repository record/],
    ['no record at all', (w) => ({ ...w, artifacts: [] }), /no unexpired same-repository record/],
    ['a LANE-LIMITED record (no -full suffix)', (w) => ({ ...w, artifacts: [{ ...w.artifacts[0], name: `ci-tested-tree-${TREE}` }] }), /no unexpired/],
    ['a release-lane record', (w) => ({ ...w, artifacts: [{ ...w.artifacts[0], name: `ci-tested-tree-${TREE}-release` }] }), /no unexpired/],
    ['an expired record', (w) => ({ ...w, artifacts: [{ ...w.artifacts[0], expired: true }] }), /no unexpired/],
    ['a record uploaded by a FORK pull request', (w) => ({ ...w, artifacts: [{ ...w.artifacts[0], workflow_run: { id: RUN, repository_id: REPO_ID, head_repository_id: 5 } }] }), /no unexpired same-repository/],
    ['recording run no longer success (a failed re-run)', (w) => ({ ...w, run: { ...w.run, conclusion: 'failure' } }), /conclusion failure/],
    ['recording run still in progress (a re-run underway)', (w) => ({ ...w, run: { ...w.run, status: 'in_progress', conclusion: null } }), /status in_progress/],
    ['recording run was a push run', (w) => ({ ...w, run: { ...w.run, event: 'push' } }), /event push/],
    ['recording run was another workflow', (w) => ({ ...w, run: { ...w.run, path: '.github/workflows/release.yml' } }), /workflow \.github\/workflows\/release\.yml/],
    ['recording run head is a fork', (w) => ({ ...w, run: { ...w.run, head_repository: { full_name: 'x/y' } } }), /head repository x\/y/],
    ['partial match: record job skipped in the latest attempt', (w) => ({ ...w, jobs: [{ name: 'Record the tested tree', conclusion: 'skipped' }] }), /latest Record the tested tree job is skipped/],
    ['partial match: record job absent in the latest attempt', (w) => ({ ...w, jobs: [] }), /is absent/],
    ['ci.yml changed in the push', (w) => ({ ...w, compare: { ...w.compare, files: [{ filename: '.github/workflows/ci.yml' }] } }), /changes \.github\/workflows\/ci\.yml/],
    ['the classifier changed in the push', (w) => ({ ...w, compare: { ...w.compare, files: [{ filename: 'scripts/ci-lanes.mjs' }] } }), /changes scripts\/ci-lanes\.mjs/],
    ['a cache-key input (lockfile) changed', (w) => ({ ...w, compare: { ...w.compare, files: [{ filename: 'pnpm-lock.yaml' }] } }), /changes pnpm-lock\.yaml/],
    ['a cache-key input (root package.json) changed', (w) => ({ ...w, compare: { ...w.compare, files: [{ filename: 'package.json' }] } }), /changes package\.json/],
    ['ci.yml renamed AWAY in the push', (w) => ({ ...w, compare: { ...w.compare, files: [{ filename: 'x.yml', previous_filename: '.github/workflows/ci.yml' }] } }), /changes \.github\/workflows\/ci\.yml/],
    ['not a fast-forward (force push)', (w) => ({ ...w, compare: { ...w.compare, status: 'diverged' } }), /not a fast-forward/],
    ['compare list at the API cap', (w) => ({ ...w, compare: { status: 'ahead', files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })) } }), /truncated/],
    ['API failure: commit', (w) => ({ ...w, fail: 'commit' }), /API error: git\/commits\/.* HTTP 502/],
    ['API failure: compare', (w) => ({ ...w, fail: 'compare' }), /API error: compare.* HTTP 502/],
    ['API failure: artifacts', (w) => ({ ...w, fail: 'artifacts' }), /API error: actions\/artifacts answered HTTP 502/],
    ['API failure: run', (w) => ({ ...w, fail: 'run' }), /API error: actions\/runs\/900 answered HTTP 502/],
    ['API failure: jobs', (w) => ({ ...w, fail: 'jobs' }), /API error: actions\/runs\/900\/jobs answered HTTP 502/],
    ['transport error', (w) => ({ ...w, fail: 'run:throw' }), /API error: ECONNRESET/],
    ['a commit with no tree', (w) => ({ ...w, commit: {} }), /no readable tree/],
    ['an artifact listing that is not a list', (w) => ({ ...w, artifacts: null }), /not a list/],
  ];
  for (const [label, edit, reason] of FAIL_OPEN) {
    test(`${label} -> no skip`, async () => {
      const g = await gate(world(edit));
      assert.equal(g.skip, false);
      assert.match(g.reason, reason);
      const d = decide({ event: 'push', pushGate: g });
      assert.equal(d.lane, 'full');
      assert.deepEqual(Object.keys(d.jobs).filter((k) => !d.jobs[k]), []);
    });
  }

  test('a first push / missing before / malformed sha -> no skip, and no request made', async () => {
    for (const over of [{ before: '0'.repeat(40) }, { before: undefined }, { sha: 'main' }]) {
      const w = world();
      const g = await gate(w, over);
      assert.equal(g.skip, false, JSON.stringify(over));
      assert.deepEqual(w.calls, []);
    }
  });

  test('a later candidate can vouch when the newest cannot, and the newest is tried first', async () => {
    const w = world((w) => ({
      ...w,
      artifacts: [w.artifacts[0], { ...w.artifacts[0], created_at: '2000-01-02T00:00:00Z', workflow_run: { ...w.artifacts[0].workflow_run, id: 901 } }],
      runs: { 901: { ...w.run, id: 901, conclusion: 'failure' } },
    }));
    const g = await gate(w);
    assert.deepEqual([g.skip, g.runId], [true, RUN]);
    assert.ok(w.calls.indexOf('actions/runs/901') < w.calls.indexOf(`actions/runs/${RUN}`));
  });

  test('when no candidate vouches, every rejection is named', async () => {
    const w = world((w) => ({
      ...w,
      artifacts: [w.artifacts[0], { ...w.artifacts[0], created_at: '2000-01-02T00:00:00Z', workflow_run: { ...w.artifacts[0].workflow_run, id: 901 } }],
      runs: { 901: { ...w.run, id: 901, conclusion: 'failure' } },
      jobsById: { [RUN]: [{ name: 'Record the tested tree', conclusion: 'failure' }] },
    }));
    const g = await gate(w);
    assert.equal(g.skip, false);
    assert.match(g.reason, /run 901: conclusion failure; run 900: its latest Record the tested tree job is failure/);
  });

  test('workflow_dispatch and schedule never take the tree lane, whatever the gate said', () => {
    const skip = { skip: true, tree: TREE, runId: RUN };
    assert.equal(decide({ event: 'workflow_dispatch', pushGate: skip }).lane, 'full');
    assert.deepEqual(Object.values(decide({ event: 'workflow_dispatch', pushGate: skip }).jobs).filter((v) => !v), []);
    assert.equal(decide({ event: 'schedule', pushGate: skip }).lane, 'scheduled');
    assert.equal(decide({ event: 'pull_request', files: [{ filename: 'README.md' }], pushGate: skip }).lane, 'full');
  });

  test('only skip === true skips', () => {
    for (const g of [{ skip: 'true' }, { skip: 1 }, {}, null, undefined]) {
      assert.equal(decide({ event: 'push', pushGate: g }).lane, 'full', JSON.stringify(g));
    }
  });
});
