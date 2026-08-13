/**
 * Fixture harness for the release-guard scripts in `scripts/`.
 *
 * Both guards derive their repo root from their OWN location
 * (`join(dirname(fileURLToPath(import.meta.url)), '..')`), so a test drives
 * them by COPYING the real script into a synthetic tree and running it there.
 * Nothing in the scripts is made test-only: the file under test is byte-for-byte
 * the file CI runs.
 *
 * The synthetic tree mirrors the real repo's shape:
 *
 *   <tmp>/package.json                     root, with `pnpm.overrides`
 *   <tmp>/scripts/<guard>.mjs              copied verbatim
 *   <tmp>/packages/<dir>/package.json      first-party workspace packages
 *   <tmp>/starters/<name>/package.json     tiged-consumed starters
 *   <tmp>/starters/examples/<name>/pkg     in-repo examples (workspace: allowed)
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
const REAL_SCRIPTS = join(REPO_ROOT, 'scripts');

/**
 * The real repo's starter pin ledger, mirrored exactly: 5 tiged-consumed
 * starters declaring 15 published-range `@civitai/*` pins between them.
 * A test that wants a PASS must start from a tree at or above the guard's
 * coverage floor, so this default is the real shape, not a toy.
 */
export const DEFAULT_STARTERS = {
  'next-app': {
    '@civitai/app-sdk': '^0.31.0',
    '@civitai/components': '^0.3.0',
    '@civitai/components-react': '^0.3.0',
    '@civitai/theme': '^0.2.0',
  },
  'react-pwa': {
    '@civitai/app-sdk': '^0.31.0',
    '@civitai/components-react': '^0.3.0',
    '@civitai/theme': '^0.2.0',
  },
  'svelte-pwa': {
    '@civitai/app-sdk': '^0.31.0',
    '@civitai/components': '^0.3.0',
    '@civitai/theme': '^0.2.0',
  },
  'sveltekit-app': {
    '@civitai/app-sdk': '^0.31.0',
    '@civitai/components': '^0.3.0',
    '@civitai/theme': '^0.2.0',
  },
  'civitai-block-starter': {
    '@civitai/app-sdk': '^0.31.0',
    '@civitai/blocks-react': '^0.39.0',
  },
};

export const DEFAULT_EXAMPLES = {
  'hello-world': { '@civitai/app-sdk': 'workspace:^', '@civitai/blocks-react': 'workspace:^' },
  'kv-storage': { '@civitai/app-sdk': 'workspace:^', '@civitai/blocks-react': 'workspace:^' },
};

export const DEFAULT_OVERRIDES = {
  '@civitai/app-sdk': 'workspace:*',
  '@civitai/blocks-react': 'workspace:*',
  '@civitai/components': 'workspace:*',
  '@civitai/components-react': 'workspace:*',
  '@civitai/theme': 'workspace:*',
};

/** Local workspace package versions, matching the DEFAULT_STARTERS pins. */
export const DEFAULT_PACKAGES = {
  'civitai-app-sdk': { name: '@civitai/app-sdk', version: '0.31.0' },
  'civitai-blocks-react': { name: '@civitai/blocks-react', version: '0.39.0' },
  'civitai-components': { name: '@civitai/components', version: '0.3.0' },
  'civitai-components-react': { name: '@civitai/components-react', version: '0.3.0' },
  'civitai-theme': { name: '@civitai/theme', version: '0.2.0' },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Build a synthetic repo. Every section defaults to the real repo's shape;
 * pass `null` for a section to omit it entirely.
 *
 * @param {object} [opts]
 * @param {object|null} [opts.overrides]  root pnpm.overrides
 * @param {object|null} [opts.starters]   { <dir>: { <pkg>: <range> } }
 * @param {object|null} [opts.examples]   { <dir>: { <pkg>: <range> } }
 * @param {object|null} [opts.packages]   { <dir>: { name, version } }
 * @param {string[]}    [opts.scripts]    guard filenames to copy in
 * @param {string}      [opts.depField]   dependency field to write pins into
 */
export function createFixture(opts = {}) {
  const {
    overrides = DEFAULT_OVERRIDES,
    starters = DEFAULT_STARTERS,
    examples = DEFAULT_EXAMPLES,
    packages = DEFAULT_PACKAGES,
    scripts = ['check-starter-workspace-overrides.mjs', 'check-starter-pins.mjs'],
    depField = 'dependencies',
  } = opts;

  const dir = mkdtempSync(join(tmpdir(), 'starter-guard-'));

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      { name: 'fixture-root', version: '0.0.0', private: true, pnpm: { overrides: clone(overrides ?? {}) } },
      null,
      2,
    ) + '\n',
  );

  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const s of scripts) cpSync(join(REAL_SCRIPTS, s), join(dir, 'scripts', s));

  for (const [name, deps] of Object.entries(starters ?? {})) {
    const d = join(dir, 'starters', name);
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, 'package.json'),
      JSON.stringify({ name, version: '0.0.0', private: true, [depField]: clone(deps) }, null, 2) + '\n',
    );
  }

  for (const [name, deps] of Object.entries(examples ?? {})) {
    const d = join(dir, 'starters', 'examples', name);
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, 'package.json'),
      JSON.stringify({ name, version: '0.0.0', private: true, [depField]: clone(deps) }, null, 2) + '\n',
    );
  }

  for (const [d0, meta] of Object.entries(packages ?? {})) {
    const d = join(dir, 'packages', d0);
    mkdirSync(d, { recursive: true });
    // `private` defaults to false (a publishable first-party package) but is
    // honoured when a test sets it — assert-published-versions.mjs must SKIP a
    // private package, and that arm needs a fixture that can express one.
    writeFileSync(
      join(d, 'package.json'),
      JSON.stringify({ ...meta, private: meta.private === true }, null, 2) + '\n',
    );
  }

  return dir;
}

export function destroyFixture(dir) {
  if (dir && dir.includes('starter-guard-')) rmSync(dir, { recursive: true, force: true });
}

/**
 * Run a guard inside a fixture. Returns { code, stdout, stderr, out }.
 *
 * ASYNC on purpose. `execFileSync` blocks the test process's event loop, which
 * would deadlock against the in-process `startFakeRegistry` server the guard
 * fetches from — the child waits for a response the parent cannot serve.
 */
export async function runGuard(dir, script, env = {}) {
  // 🔴 STRIP the ambient CI variables the guards READ before layering the
  // caller's env on top. GitHub Actions sets GITHUB_SHA to the CI commit, which
  // does not exist inside a temp fixture repo — so a test that deliberately
  // omits GITHUB_SHA silently got the runner's instead, and behaved differently
  // in CI than locally. That made the one control proving `$GITHUB_SHA` is
  // load-bearing die in CI before it could discriminate: 45/45 green locally,
  // 5 required checks red on the PR.
  //
  // A test that WANTS one of these sets it explicitly in `env`, which still
  // wins — the strip only removes what the runner injected behind our back.
  const base = { ...process.env };
  for (const k of ['GITHUB_SHA', 'NPM_REGISTRY', 'PUBLISH_CHECK_FROM_DISK']) delete base[k];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [join(dir, 'scripts', script)], {
      encoding: 'utf8',
      env: { ...base, ...env },
    });
    return { code: 0, stdout, stderr, out: stdout + stderr };
  } catch (err) {
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    return { code: err.code ?? 1, stdout, stderr, out: stdout + stderr };
  }
}

/**
 * A stand-in npm registry. `versions` maps package name -> published version,
 * the literal string 'notfound' (404) or 'error' (503).
 *
 * Serves TWO endpoint shapes, because the two guards ask different questions:
 *   GET /<pkg>/latest     -> check-starter-pins.mjs (what is published NOW)
 *   GET /<pkg>/<version>  -> assert-published-versions.mjs (does THIS exact
 *                            version exist). A request for a version other than
 *                            the mapped one 404s, which is exactly the
 *                            failed-publish state that guard must catch.
 *
 * Returns { origin, close, hits } — `hits` records every path served so a test
 * can assert the guard actually issued the requests it claims to (a guard that
 * silently makes no request would otherwise look identical to a passing one).
 */
export async function startFakeRegistry(versions) {
  const hits = [];
  // `versions` is caller-supplied data, so membership MUST be an own-property
  // test: a bare `versions[pkg]` would resolve inherited keys ('constructor',
  // 'toString') to truthy junk and serve a 200 for a package nobody declared.
  const has = (k) => Object.prototype.hasOwnProperty.call(versions, k);
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url || '');
    hits.push(url);
    const path = url.replace(/^\//, '');

    // Three shapes, and a SCOPED name contains a '/', so they cannot be told
    // apart by counting segments:
    //   /@scope/name            -> name probe (does the package exist at all)
    //   /@scope/name/latest     -> dist-tag read
    //   /@scope/name/<version>  -> exact-version read
    // A declared package name always wins, so the probe is unambiguous.
    let pkg;
    let requested = null;
    if (has(path)) {
      pkg = path;
    } else {
      const i = path.lastIndexOf('/');
      pkg = i > 0 ? path.slice(0, i) : path;
      requested = i > 0 ? path.slice(i + 1) : null;
    }

    const v = has(pkg) ? versions[pkg] : undefined;
    if (v === undefined || v === 'notfound') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (v === 'error') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    // Name probe: the package EXISTS, whatever versions it may have.
    if (requested === null) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: pkg, 'dist-tags': { latest: v } }));
      return;
    }
    // Exact-version request for a version this registry does not have.
    if (requested !== 'latest' && requested !== v) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'version not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: pkg, version: v }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((resolve) => {
        // undici keeps connections alive, so a bare close() never resolves.
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
