#!/usr/bin/env node
/**
 * Probe: does the production server serve the SPA correctly when started from a
 * DIFFERENT working directory, and without fetching itself?
 *
 * Three claims, each of which was false on `main` @ 0b6055b:
 *
 *   1. `GET /` returns 200 with the SPA shell, with `cwd` anywhere.
 *      `serveStatic({ root: './dist' })` resolved against the PROCESS CWD, so
 *      any launcher that did not happen to `cd` into the package directory
 *      (systemd `WorkingDirectory`, a container `WORKDIR`, `pm2`, a monorepo
 *      task runner) served nothing.
 *   2. Serving `/` opens no unbounded number of sockets. The SPA fallback was
 *      `fetch('http://localhost:PORT/index.html')` — the server calling ITSELF
 *      over TCP. When the static middleware misses, `/index.html` falls into
 *      the same catch-all, which fetches itself again: unbounded recursion,
 *      one socket per level. This probe counts the process's open file
 *      descriptors around a burst of requests.
 *   3. A missing `dist/index.html` fails LOUDLY at boot, with a non-zero exit,
 *      instead of starting a server that answers every route with an error.
 *
 * Linux-only for the FD check (`/proc/<pid>/fd`); it is skipped elsewhere and
 * says so rather than silently passing.
 *
 *   node scripts/probe-static-serving.mjs
 *   PROBE_SKIP_BUILD=1 node scripts/probe-static-serving.mjs   # reuse dist/
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rename, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const PKG_DIR = new URL('..', import.meta.url).pathname;
const DIST_DIR = join(PKG_DIR, 'dist');
const PORT = Number(process.env.PROBE_PORT ?? 5391);
const SPA_MARKER = process.env.PROBE_SPA_MARKER ?? 'id="root"';

// 🔴 SCENARIO 3 GETS ITS OWN PORT. The self-fetch failure leaves tens of
// thousands of sockets behind, and a SIGKILLed process does not release its
// listener instantly — so reusing one port makes the boot-guard scenario exit
// non-zero on EADDRINUSE, i.e. GREEN FOR THE WRONG REASON, with or without the
// guard it claims to test. Measured: it reported exit 1 at the base ref, where
// no boot guard exists at all.
const BOOT_GUARD_PORT = PORT + 1;

function serverEnv(port) {
  return {
    CIVITAI_CLIENT_ID: 'probe-client',
    CIVITAI_CLIENT_SECRET: 'probe-secret',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    APP_URL: `http://127.0.0.1:${port}`,
    PORT: String(port),
  };
}

const children = [];
function killAll() {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', killAll);

const failures = [];
function check(ok, detail) {
  if (!ok) failures.push(detail);
}

function startServer(cwd, port = PORT) {
  const child = spawn(process.execPath, [join(PKG_DIR, 'dist-server/index.js')], {
    cwd,
    env: { ...process.env, ...serverEnv(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return { child, log: () => log };
}

async function waitForListening(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return false;
}

async function fdCount(pid) {
  try {
    return (await readdir(`/proc/${pid}/fd`)).length;
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.PROBE_SKIP_BUILD) {
    console.log('[probe] building…');
    const build = spawn('npx', ['vite', 'build'], {
      cwd: PKG_DIR,
      env: { ...process.env, SKIP_ENV_VALIDATION: '1' },
      stdio: 'inherit',
    });
    children.push(build);
    if ((await new Promise((r) => build.on('exit', r))) !== 0)
      throw new Error('vite build failed');

    const tsc = spawn('npx', ['tsc', '-p', 'tsconfig.server.json'], {
      cwd: PKG_DIR,
      stdio: 'inherit',
    });
    children.push(tsc);
    if ((await new Promise((r) => tsc.on('exit', r))) !== 0) throw new Error('tsc failed');
  }

  // A directory that is emphatically NOT the package root. If the server
  // resolves `dist/` against the CWD, there is nothing here to find.
  const elsewhere = await mkdtemp(join(tmpdir(), 'pwa-probe-'));

  // ---- 1 + 2: serve the SPA from a foreign CWD, without self-fetching ----
  console.log(`[probe] starting from cwd=${elsewhere}`);
  const { child, log } = startServer(elsewhere);
  const up = await waitForListening(20_000);
  check(up, 'server never started listening');

  if (up) {
    const fdBefore = await fdCount(child.pid);

    let res;
    let body = '';
    try {
      res = await fetch(`http://127.0.0.1:${PORT}/`, {
        signal: AbortSignal.timeout(10_000),
      });
      body = await res.text();
    } catch (err) {
      check(false, `GET / failed or hung: ${err?.name ?? err}`);
    }

    const status = res?.status ?? 0;
    const hasShell = body.includes(SPA_MARKER);
    console.log('\n--- GET / from a foreign cwd ---');
    console.log('status        :', status, '(want 200)');
    console.log('has SPA shell :', hasShell, `(want true — looking for ${SPA_MARKER})`);
    check(status === 200, `GET / returned ${status}, want 200`);
    check(hasShell, `GET / body does not contain the SPA shell marker ${SPA_MARKER}`);

    // Deep link — the SPA-fallback path specifically.
    let deepStatus = 0;
    let deepShell = false;
    try {
      const deep = await fetch(`http://127.0.0.1:${PORT}/some/client/route`, {
        signal: AbortSignal.timeout(10_000),
      });
      deepStatus = deep.status;
      deepShell = (await deep.text()).includes(SPA_MARKER);
    } catch (err) {
      check(false, `GET /some/client/route failed or hung: ${err?.name ?? err}`);
    }
    console.log('deep link     :', deepStatus, 'shell:', deepShell);
    check(deepStatus === 200, `deep link returned ${deepStatus}, want 200`);
    check(deepShell, 'deep link body does not contain the SPA shell');

    // 🔴 A REAL STATIC ASSET, NOT JUST THE HTML FALLBACK. Measured: with only
    // the two checks above, a mutant that put the static root back to a
    // CWD-relative './dist' SURVIVED — the in-memory fallback answers `/` and
    // every deep link with 200 no matter where `dist/` is, so the assertions
    // could not see that every script and stylesheet was 404ing. This is the
    // only check that actually exercises `serveStatic`'s root resolution.
    const assetHref = body.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
    check(
      Boolean(assetHref),
      'could not find an /assets/ reference in index.html — the asset check would be vacuous',
    );
    //
    // 🔴 AND THE ASSERTION IS BYTE-IDENTITY WITH THE FILE ON DISK, not `200`.
    // Measured again: with a status-and-length check the same mutant STILL
    // survived, because the SPA catch-all happily answers `/assets/index-*.js`
    // with index.html — 200, non-empty, and completely wrong. Comparing bytes
    // is the only assertion that can tell "served the asset" from "served the
    // fallback".
    let assetStatus = 0;
    let assetMatches = false;
    let assetDetail = '';
    if (assetHref) {
      try {
        const asset = await fetch(`http://127.0.0.1:${PORT}${assetHref}`, {
          signal: AbortSignal.timeout(10_000),
        });
        assetStatus = asset.status;
        const served = Buffer.from(await asset.arrayBuffer());
        const onDisk = await readFile(join(DIST_DIR, assetHref));
        assetMatches = served.equals(onDisk);
        assetDetail = `served ${served.length}B, on disk ${onDisk.length}B`;
      } catch (err) {
        check(false, `GET ${assetHref} failed or hung: ${err?.name ?? err}`);
      }
    }
    console.log('static asset  :', assetHref, '->', assetStatus, assetDetail);
    check(assetStatus === 200, `static asset ${assetHref} returned ${assetStatus}, want 200`);
    check(
      assetMatches,
      `static asset ${assetHref} does not match the file on disk (${assetDetail}) — the SPA fallback is answering asset requests`,
    );

    // ---- (a) sequential burst: catches the RUNAWAY self-fetch ------------
    // When the static middleware cannot find `dist/`, `/index.html` falls into
    // the same catch-all that fetched it, which fetches itself again. Measured
    // on the pre-fix code from a foreign cwd: 20 -> 92,124 descriptors.
    for (let i = 0; i < 25; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/deep/${i}`, {
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        /* counted by the assertions above */
      }
    }
    await sleep(500);
    const fdAfter = await fdCount(child.pid);

    console.log('\n--- file descriptors, 25 sequential ---');
    if (fdBefore === null || fdAfter === null) {
      console.log('SKIPPED — /proc is unavailable on this platform, FD growth NOT measured');
    } else {
      const growth = fdAfter - fdBefore;
      console.log(`before: ${fdBefore}  after: ${fdAfter}  growth: ${growth} (want < 25)`);
      check(
        growth < 25,
        `open descriptors grew by ${growth} across 25 requests — the server is holding a connection per request`,
      );
    }

    // ---- (b) concurrent burst: catches a self-fetch that still WORKS ------
    // 🔴 THE SEQUENTIAL CHECK IS NOT ENOUGH, and I measured that rather than
    // assuming it. A mutant that restores the self-fetch while KEEPING the
    // absolute static root resolves `/index.html` successfully, so it opens
    // one pooled outbound socket and the sequential growth is 3 — comfortably
    // under any threshold. Under concurrency the doubling becomes visible,
    // because every in-flight request holds an inbound socket AND an outbound
    // one.
    //
    // Measured at concurrency 150, idle 19 descriptors:
    //     served from memory : peak 150 and 169 over two runs
    //     self-fetch         : peak 472
    // The threshold below sits at 1.5x the concurrency — ~50% above the worst
    // healthy observation and less than half the unhealthy one.
    const CONCURRENCY = 150;
    let peakFd = 0;
    const sampler = setInterval(async () => {
      const n = await fdCount(child.pid);
      if (n !== null && n > peakFd) peakFd = n;
    }, 5);
    const idleFd = (await fdCount(child.pid)) ?? 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        fetch(`http://127.0.0.1:${PORT}/burst/${i}`, { signal: AbortSignal.timeout(20_000) })
          .then((r) => r.text())
          .catch(() => ''),
      ),
    );
    clearInterval(sampler);

    console.log(`\n--- file descriptors, ${CONCURRENCY} concurrent ---`);
    if (peakFd === 0) {
      console.log('SKIPPED — /proc is unavailable on this platform, peak NOT measured');
    } else {
      const overIdle = peakFd - idleFd;
      const limit = Math.floor(CONCURRENCY * 1.5);
      console.log(`idle: ${idleFd}  peak: ${peakFd}  over idle: ${overIdle} (want < ${limit})`);
      check(
        overIdle < limit,
        `peak descriptors rose ${overIdle} above idle at concurrency ${CONCURRENCY} (limit ${limit}) — the server is opening an outbound connection per inbound request, i.e. fetching itself`,
      );
    }
  }

  if (failures.length) {
    console.log('\n--- server log ---');
    console.log(log().split('\n').slice(-30).join('\n'));
  }
  child.kill('SIGKILL');
  await sleep(300);

  // ---- 3: a missing dist/index.html must fail loudly at boot -------------
  const indexPath = join(PKG_DIR, 'dist/index.html');
  const stashed = join(PKG_DIR, 'dist/index.html.probe-bak');
  let moved = false;
  try {
    await access(indexPath);
    await rename(indexPath, stashed);
    moved = true;
  } catch {
    check(false, 'dist/index.html is missing before the probe even starts — build first');
  }

  if (moved) {
    const { child: broken, log: brokenLog } = startServer(elsewhere, BOOT_GUARD_PORT);
    const exitCode = await Promise.race([
      new Promise((r) => broken.on('exit', (c) => r(c))),
      sleep(10_000).then(() => 'still-running'),
    ]);
    console.log('\n--- boot with dist/index.html absent ---');
    console.log(`port: ${BOOT_GUARD_PORT} (its own, so EADDRINUSE cannot fake this)`);
    console.log('exit:', exitCode, '(want a non-zero number)');
    console.log('log :', brokenLog().trim().split('\n').slice(-3).join(' | '));
    check(
      typeof exitCode === 'number' && exitCode !== 0,
      `expected a non-zero exit when dist/index.html is absent, got ${exitCode}`,
    );
    if (typeof exitCode !== 'number' || exitCode === 0) {
      console.log(brokenLog().split('\n').slice(-20).join('\n'));
    }
    broken.kill('SIGKILL');
    await rename(stashed, indexPath);
  }

  if (failures.length) {
    console.error('\nFAIL:\n  - ' + failures.join('\n  - '));
    process.exitCode = 1;
  } else {
    console.log('\nPASS');
  }
}

main()
  .catch((err) => {
    console.error('probe error:', err);
    process.exitCode = 1;
  })
  .finally(killAll);
