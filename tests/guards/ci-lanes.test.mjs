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
import { JOBS, ADVISORY_JOBS, CORE_JOBS, classifyPath, decide, fetchPullRequestFiles, globToRegExp } from '../../scripts/ci-lanes.mjs';

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

describe('there is no scheduled lane', () => {
  test('a `schedule` event is treated like any non-PR event: every job', () => {
    // ci.yml has no `schedule:` trigger (the ledger guard pins that). If one is
    // ever added, this is what it gets until somebody writes a lane for it.
    const d = decide({ event: 'schedule' });
    assert.equal(d.lane, 'full');
    assert.deepEqual(advisoryRun(d), [...ALL_FIVE].sort());
    assert.deepEqual(coreRun(d), CORE_JOBS);
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
    const { outputs } = run({ vars: { GITHUB_EVENT_NAME: 'push' } });
    assert.deepEqual(Object.keys(outputs), ['lane', ...Object.keys(JOBS)]);
    assert.equal(outputs.lane, 'full');
    for (const id of Object.keys(JOBS)) assert.equal(outputs[id], 'true');
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
