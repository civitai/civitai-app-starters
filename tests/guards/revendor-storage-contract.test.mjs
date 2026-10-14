/**
 * `scripts/revendor-storage-contract.sh` — the storage-contract twin of
 * `revendor-canonical-schema.sh`, run by the same scheduled workflow. Pins that it
 * keeps that script's status handling (200 re-vendors byte-exact, 404/410 fails,
 * anything else skips, an empty body is refused) and that, unlike it, it writes NO
 * changeset: the contract is not published.
 *
 * Node built-ins only: `pnpm test:guards` runs before `pnpm install` in CI.
 * The script runs against a local HTTP server through its `CONTRACT_URL` override,
 * in a temp copy of the repo layout, so the real vendored file is never touched.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = 'revendor-storage-contract.sh';
const CONTRACT_REL = join('packages', 'civitai-sdk', 'schemas', 'app-block', 'storage-contract.v1.json');

const OLD = `${JSON.stringify({ version: 1, cases: [{ name: 'a', steps: [] }] }, null, 2)}\n`;
const NEW = `${JSON.stringify({ version: 1, cases: [{ name: 'a', steps: [] }, { name: 'b', steps: [] }] }, null, 2)}\n`;

function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), 'revendor-contract-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(REPO_ROOT, 'scripts', SCRIPT), join(root, 'scripts', SCRIPT));
  mkdirSync(dirname(join(root, CONTRACT_REL)), { recursive: true });
  writeFileSync(join(root, CONTRACT_REL), body);
  return root;
}

const changesets = (root) => (existsSync(join(root, '.changeset')) ? readdirSync(join(root, '.changeset')) : []);

async function run(root, url) {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [join(root, 'scripts', SCRIPT)], {
      env: { ...process.env, CONTRACT_URL: url },
      cwd: tmpdir(),
    });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (e) {
    return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

let server;
let url;
let respond = { status: 200, body: '' };

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(respond.status, { 'content-type': 'application/json' });
    res.end(respond.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/storage-contract.v1.json`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

describe('revendor-storage-contract.sh', () => {
  const cases = [
    // [name, served status, served body, expected exit, expected bytes after]
    ['drift on a 200: re-vendors the served bytes exactly, and writes NO changeset', 200, NEW, 0, NEW],
    ['identical on a 200: a no-op', 200, OLD, 0, OLD],
    ['a 404 fails loudly and leaves the copy alone', 404, 'not found', 1, OLD],
    ['a 410 fails loudly and leaves the copy alone', 410, 'gone', 1, OLD],
    ['a 503 is transient: skip quietly, copy untouched', 503, 'upstream unavailable', 0, OLD],
    ['an empty 200 is refused, never blanking the copy', 200, '', 1, OLD],
    ['a non-object 200 is refused', 200, '[1,2]', 1, OLD],
  ];
  for (const [name, status, body, code, after] of cases) {
    test(name, async () => {
      const root = fixture(OLD);
      try {
        respond = { status, body };
        const r = await run(root, url);
        assert.equal(r.code, code, `exit ${r.code}\n${r.out}`);
        assert.equal(readFileSync(join(root, CONTRACT_REL), 'utf8'), after);
        assert.deepEqual(changesets(root), [], 'the contract is not published; no changeset');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test('the scheduled workflow runs it, gated on the open-PR guard', () => {
    const wf = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'revendor-canonical-schema.yml'), 'utf8');
    assert.match(wf, /- name: Re-vendor storage contract\n\s+if: steps\.guard\.outputs\.open == ''\n\s+run: \.\/scripts\/revendor-storage-contract\.sh/);
    assert.match(wf, /pnpm --filter @civitai\/sdk test/, 'the contract re-vendor is validated against the fake before a PR opens');
  });
});
