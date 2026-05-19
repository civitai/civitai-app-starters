#!/usr/bin/env node
/**
 * run-all-e2e.mjs — boot every starter's dev server and run its Playwright e2e
 * suite sequentially.
 *
 * Usage:
 *   node scripts/run-all-e2e.mjs [--civitai-base-url <url>] [--user <id>] [--only <starter>]
 *
 * The script handles, for each starter (next-app → sveltekit-app → react-pwa →
 * svelte-pwa):
 *   1. Freeing the target port if a stale process is bound (cross-platform).
 *   2. Spawning `pnpm dev` (with `--port` for next-app) with NODE_TLS_REJECT_UNAUTHORIZED=0.
 *   3. Waiting for the framework's ready line (or failing on EADDRINUSE / 90s timeout).
 *   4. Pre-warming the dev server with a single fetch so cold-compile doesn't
 *      blow Playwright's per-test timeout.
 *   5. Running `pnpm test:e2e` with APP_URL / CIVITAI_BASE_URL / TEST_USER_ID.
 *   6. Capturing pass/fail + parsed test count, then tearing the dev server down
 *      (SIGTERM → SIGKILL after 5s, plus a re-kill of any zombie on the port).
 *   7. Continuing on failure so every starter gets its turn.
 *
 * At the end the script prints a summary table and exits non-zero if any
 * starter failed.
 *
 * Single-file, no new deps — Node 20+ built-ins only.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const IS_WINDOWS = process.platform === 'win32';

// ---------- CLI ----------------------------------------------------------------

const { values: argv } = parseArgs({
  options: {
    'civitai-base-url': { type: 'string' },
    user: { type: 'string' },
    only: { type: 'string' },
  },
  strict: true,
});

const civitaiBaseUrl = argv['civitai-base-url'] ?? process.env.CIVITAI_BASE_URL;
if (!civitaiBaseUrl) {
  // Match the wording the per-starter e2e suites use when CIVITAI_BASE_URL is missing.
  console.error(
    'CIVITAI_BASE_URL is required for e2e. See playwright.config.ts header for the full prereq list.',
  );
  process.exit(1);
}
const testUserId = argv.user ?? process.env.TEST_USER_ID ?? '1';

// ---------- Starter table ------------------------------------------------------

/**
 * @typedef {Object} Starter
 * @property {string} name        slug used in --only, log prefix, summary
 * @property {string} dir         relative path under repoRoot
 * @property {number} port        dev server port (also the APP_URL port)
 * @property {string[]} devArgs   extra args appended to `pnpm dev`
 * @property {RegExp} readyRegex  framework's "ready" stdout line
 */

/** @type {Starter[]} */
const STARTERS = [
  {
    name: 'next-app',
    dir: 'starters/next-app',
    port: 3334,
    // next-app doesn't read APP_URL for its listen port; force it here.
    devArgs: ['--port', '3334'],
    readyRegex: /Ready in|ready in|started server on/i,
  },
  {
    name: 'sveltekit-app',
    dir: 'starters/sveltekit-app',
    port: 5173,
    devArgs: [],
    readyRegex: /ready in|VITE v.* {2}ready/i,
  },
  {
    name: 'react-pwa',
    dir: 'starters/react-pwa',
    port: 5174,
    devArgs: [],
    readyRegex: /ready in|VITE v.* {2}ready/i,
  },
  {
    name: 'svelte-pwa',
    dir: 'starters/svelte-pwa',
    port: 5175,
    devArgs: [],
    readyRegex: /ready in|VITE v.* {2}ready/i,
  },
];

const selected = argv.only
  ? STARTERS.filter((s) => s.name === argv.only)
  : STARTERS;

if (argv.only && selected.length === 0) {
  console.error(
    `--only "${argv.only}" did not match any starter. Known: ${STARTERS.map((s) => s.name).join(', ')}`,
  );
  process.exit(1);
}

// ---------- Port helpers -------------------------------------------------------

/**
 * Returns the list of PIDs currently LISTENing on the given port. Tolerates
 * "nothing there" — that's the happy path.
 *
 * @param {number} port
 * @returns {Promise<number[]>}
 */
async function findPidsOnPort(port) {
  if (IS_WINDOWS) {
    // Plain `netstat -ano` — no PowerShell. Parse for "LISTENING" lines on the port.
    const { stdout } = await runCapture('netstat', ['-ano'], { shell: false });
    const pids = new Set();
    for (const line of stdout.split(/\r?\n/)) {
      // Example line: "  TCP    0.0.0.0:5174   0.0.0.0:0   LISTENING   12345"
      if (!/LISTENING/i.test(line)) continue;
      const cols = line.trim().split(/\s+/);
      // cols: [proto, local, foreign, state, pid]
      if (cols.length < 5) continue;
      const local = cols[1];
      const pid = cols[4];
      if (!local || !pid) continue;
      const m = local.match(/:(\d+)$/);
      if (!m) continue;
      if (Number(m[1]) === port) pids.add(Number(pid));
    }
    return [...pids];
  }
  // macOS + Linux: lsof -nP -iTCP:<port> -sTCP:LISTEN -t
  const { stdout, exitCode } = await runCapture(
    'lsof',
    ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
    { shell: false, ignoreExit: true },
  );
  if (exitCode !== 0) return []; // lsof exits non-zero with no output when nothing matches.
  return stdout
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Best-effort kill. SIGTERM, then SIGKILL after 1s. Tolerates "no such pid".
 * @param {number} pid
 */
async function killPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return; // already dead
  }
  await sleep(1000);
  try {
    process.kill(pid, 0); // still alive?
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  } catch {
    /* gone — good */
  }
}

/**
 * @param {number} port
 * @param {(line: string) => void} log
 */
async function freePort(port, log) {
  const pids = await findPidsOnPort(port);
  if (pids.length === 0) return;
  log(`port ${port} held by pid(s) ${pids.join(', ')} — killing`);
  await Promise.all(pids.map(killPid));
}

// ---------- spawn helpers ------------------------------------------------------

/**
 * Capture stdout/stderr from a command. Used for netstat/lsof — small output.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ shell?: boolean, ignoreExit?: boolean }} opts
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: opts.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0 && !opts.ignoreExit) {
        return reject(
          new Error(
            `${cmd} ${args.join(' ')} exited ${exitCode}\nstderr: ${stderr.trim()}`,
          ),
        );
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- per-starter run ----------------------------------------------------

/**
 * @typedef {Object} StarterResult
 * @property {string} name
 * @property {number} port
 * @property {'pass'|'fail'|'error'} status
 * @property {string|null} testCount   parsed "N passed" string, or null
 * @property {number} durationMs
 * @property {string|null} note        error reason, if any
 */

/**
 * Run e2e for a single starter. Always tears the dev server down before
 * returning, even on error.
 * @param {Starter} starter
 * @returns {Promise<StarterResult>}
 */
async function runStarter(starter) {
  const start = Date.now();
  const cwd = path.join(repoRoot, starter.dir);
  const prefix = `[${starter.name}]`;
  /** @param {string} msg */
  const log = (msg) => {
    for (const line of String(msg).split(/\r?\n/)) {
      if (line.length) process.stdout.write(`${prefix} ${line}\n`);
    }
  };

  log(`=== starting (port ${starter.port}, cwd ${starter.dir}) ===`);

  if (!existsSync(cwd)) {
    return {
      name: starter.name,
      port: starter.port,
      status: 'error',
      testCount: null,
      durationMs: Date.now() - start,
      note: `directory missing: ${cwd}`,
    };
  }

  // 1. Free the port.
  try {
    await freePort(starter.port, log);
  } catch (err) {
    log(`warn: freePort failed: ${err.message}`);
  }

  // 2. Boot dev.
  const devEnv = {
    ...process.env,
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    // Make sure children inherit the same CIVITAI_BASE_URL we resolved.
    CIVITAI_BASE_URL: civitaiBaseUrl,
  };

  const devChild = spawn('pnpm', ['dev', ...starter.devArgs], {
    cwd,
    env: devEnv,
    // shell:true is required on Windows so `pnpm` resolves to pnpm.CMD; harmless elsewhere.
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let devBuffer = '';
  const onDevData = (chunk) => {
    const text = chunk.toString();
    devBuffer += text;
    for (const line of text.split(/\r?\n/)) {
      if (line.length) process.stdout.write(`${prefix} ${line}\n`);
    }
  };
  devChild.stdout.on('data', onDevData);
  devChild.stderr.on('data', onDevData);

  let devExited = false;
  let devExitCode = null;
  devChild.on('exit', (code) => {
    devExited = true;
    devExitCode = code;
  });

  // 3. Wait for ready.
  const readyDeadline = Date.now() + 90_000;
  let ready = false;
  let readyError = null;
  while (Date.now() < readyDeadline) {
    if (/EADDRINUSE/.test(devBuffer)) {
      readyError = 'dev server reported EADDRINUSE';
      break;
    }
    if (devExited) {
      readyError = `dev server exited before ready (code ${devExitCode})`;
      break;
    }
    if (starter.readyRegex.test(devBuffer)) {
      ready = true;
      break;
    }
    await sleep(250);
  }
  if (!ready) {
    readyError ??= `dev server did not become ready within 90s (no match for ${starter.readyRegex})`;
    log(`error: ${readyError}`);
    await stopDev(devChild, starter, log);
    return {
      name: starter.name,
      port: starter.port,
      status: 'error',
      testCount: null,
      durationMs: Date.now() - start,
      note: readyError,
    };
  }
  log(`dev server ready`);

  // 4. Pre-warm so first Playwright nav doesn't time out on cold compile.
  const appUrl = `http://localhost:${starter.port}`;
  try {
    log(`pre-warming ${appUrl}/`);
    const res = await fetch(`${appUrl}/`);
    // Drain the body so the connection releases.
    await res.arrayBuffer().catch(() => {});
    log(`pre-warm got ${res.status}`);
  } catch (err) {
    log(`pre-warm fetch failed (continuing anyway): ${err.message}`);
  }

  // 5. Run e2e.
  const testEnv = {
    ...process.env,
    APP_URL: appUrl,
    CIVITAI_BASE_URL: civitaiBaseUrl,
    TEST_USER_ID: testUserId,
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
  };
  const testResult = await runChildStreaming(
    'pnpm',
    ['test:e2e'],
    { cwd, env: testEnv, shell: true },
    prefix,
  );

  // 6. Parse "N passed (Xs)" out of the captured stream.
  const passedMatch = testResult.combined.match(/(\d+)\s+passed\s*\([^)]+\)/i);
  const testCount = passedMatch ? `${passedMatch[1]} passed` : null;
  const status = testResult.exitCode === 0 ? 'pass' : 'fail';
  log(`e2e exited ${testResult.exitCode} (${testCount ?? 'no count parsed'})`);

  // 7. Tear down.
  await stopDev(devChild, starter, log);

  return {
    name: starter.name,
    port: starter.port,
    status,
    testCount,
    durationMs: Date.now() - start,
    note: null,
  };
}

/**
 * Stream a child's stdout/stderr to the parent (line-prefixed) while also
 * accumulating it for post-hoc parsing. Resolves when the child exits.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} opts spawn options
 * @param {string} prefix log prefix
 * @returns {Promise<{ exitCode: number, combined: string }>}
 */
function runChildStreaming(cmd, args, opts, prefix) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let combined = '';
    const onData = (chunk) => {
      const text = chunk.toString();
      combined += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.length) process.stdout.write(`${prefix} ${line}\n`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      combined += `\n[spawn error] ${err.message}\n`;
      resolve({ exitCode: 1, combined });
    });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, combined }));
  });
}

/**
 * Stop the dev server: SIGTERM → SIGKILL after 5s, then re-kill anything still
 * bound to the port (Vite/Next-Hono sometimes leave a zombie child).
 * @param {import('node:child_process').ChildProcess} devChild
 * @param {Starter} starter
 * @param {(msg: string) => void} log
 */
async function stopDev(devChild, starter, log) {
  if (!devChild.killed && devChild.exitCode === null) {
    log('stopping dev server (SIGTERM)');
    try {
      devChild.kill('SIGTERM');
    } catch (err) {
      log(`warn: SIGTERM failed: ${err.message}`);
    }
    const killDeadline = Date.now() + 5_000;
    while (Date.now() < killDeadline && devChild.exitCode === null) {
      await sleep(200);
    }
    if (devChild.exitCode === null) {
      log('SIGTERM ignored; sending SIGKILL');
      try {
        devChild.kill('SIGKILL');
      } catch (err) {
        log(`warn: SIGKILL failed: ${err.message}`);
      }
    }
  }
  // Re-kill any straggler on the port.
  try {
    await freePort(starter.port, log);
  } catch (err) {
    log(`warn: post-stop freePort failed: ${err.message}`);
  }
}

// ---------- main ---------------------------------------------------------------

/** @type {StarterResult[]} */
const results = [];
for (const starter of selected) {
  try {
    results.push(await runStarter(starter));
  } catch (err) {
    results.push({
      name: starter.name,
      port: starter.port,
      status: 'error',
      testCount: null,
      durationMs: 0,
      note: err?.stack ?? String(err),
    });
  }
}

// ---------- summary ------------------------------------------------------------

const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const header = ['Starter', 'Port', 'Status', 'Tests', 'Duration'];
const rows = results.map((r) => [
  r.name,
  String(r.port),
  r.status.toUpperCase(),
  r.testCount ?? '—',
  fmtMs(r.durationMs),
]);
const widths = header.map((h, i) =>
  Math.max(h.length, ...rows.map((row) => row[i].length)),
);
const pad = (cells) =>
  cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();

console.log('');
console.log('====== e2e summary ======');
console.log(pad(header));
console.log(pad(widths.map((w) => '-'.repeat(w))));
for (const row of rows) console.log(pad(row));
for (const r of results) {
  if (r.note) console.log(`  ! ${r.name}: ${r.note.split('\n')[0]}`);
}

const anyFailed = results.some((r) => r.status !== 'pass');
process.exit(anyFailed ? 1 : 0);
