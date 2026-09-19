#!/usr/bin/env node
/**
 * Probe: what does the app do when a viewer arrives with an EXPIRED session
 * cookie?
 *
 * A unit test cannot reach this. The behaviour under test is Next.js's own rule
 * that a Server Component may not write cookies, which only exists inside a
 * real render — so this drives a real `next build` + `next start` over HTTP.
 *
 * TWO scenarios, because `getSession()` used to write a cookie on BOTH arms and
 * fixing one would leave the other throwing:
 *
 *   A. refresh REJECTED  -> logged-out page + a `Set-Cookie` that CLEARS
 *      `civ_session`. Without the clear, the dead cookie is re-sent on every
 *      later request and the doomed refresh is paid again each time.
 *   B. refresh ACCEPTED  -> the signed-in page + a `Set-Cookie` carrying the
 *      NEW sealed session — proved by unsealing it and reading the new access
 *      token back out, not by eyeballing that a header exists.
 *
 * Measured on `main` @ 0b6055b, scenario A: HTTP 200 with a permanently stuck
 * loading skeleton, `renders logged-out: false`, ZERO `Set-Cookie` headers, and
 * `Error: Cookies can only be modified in a Server Action or Route Handler` in
 * the server log.
 *
 *   node scripts/probe-expired-session.mjs
 *   PROBE_SKIP_BUILD=1 node scripts/probe-expired-session.mjs   # reuse .next
 *
 * Exits 0 on pass, 1 on failure, printing the measured values either way.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

// ESM-only package (no `require` condition in its exports map).
const { sealCookie, unsealCookie } = await import('@civitai/app-sdk/cookies');

const SESSION_SECRET = randomBytes(32).toString('hex');
const APP_PORT = Number(process.env.PROBE_APP_PORT ?? 3941);
const AUTH_PORT = Number(process.env.PROBE_AUTH_PORT ?? 3942);

const LOGGED_OUT_MARKER = 'Sign in with your Civitai account';
// A POSITIVE marker for the signed-in page. `!loggedOut` alone is not enough:
// the base-ref failure mode ALSO lacked the logged-out marker, because the
// render threw and the response was a stuck loading skeleton. Asserting the
// absence of one string cannot tell those two apart.
const SIGNED_IN_MARKER = 'probe-user';
const NEW_ACCESS_TOKEN = 'refreshed-access-token-1234';

const children = [];
function cleanup() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

/**
 * Stand-in auth hub. `refreshMode` decides whether the token endpoint accepts
 * or rejects, and the hit counter is the probe's POSITIVE CONTROL: a scenario
 * reporting zero attempts never exercised the refresh path at all, and its
 * result would say nothing.
 */
let refreshMode = 'reject';
let refreshAttempts = 0;

const authHub = createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/api/auth/oauth/token')) {
    refreshAttempts += 1;
    if (refreshMode === 'accept') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: NEW_ACCESS_TOKEN,
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
          scope: 65537,
          token_type: 'Bearer',
        }),
      );
      return;
    }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_grant' }));
    return;
  }
  // /api/v1/me — the signed-in page calls it. Answer so the render reaches its
  // signed-in branch rather than its error branch.
  if (req.url?.startsWith('/api/v1/me')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 1, username: 'probe-user', balance: 1234 }));
    return;
  }
  res.writeHead(404).end();
});

function run(cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status > 0) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** An access token that expired an hour ago, plus a refresh token. */
function expiredSessionCookie() {
  return sealCookie(
    JSON.stringify({
      tokens: {
        access_token: 'stale-access-token',
        refresh_token: 'some-refresh-token',
        expires_at: Date.now() - 3_600_000,
        scope: 65537,
      },
    }),
    SESSION_SECRET,
  );
}

function sessionSetCookie(headers) {
  const all = headers.getSetCookie?.() ?? [];
  return { all, session: all.find((c) => c.startsWith('civ_session=')) };
}

const failures = [];
function check(scenario, ok, detail) {
  if (!ok) failures.push(`[${scenario}] ${detail}`);
}

async function main() {
  await new Promise((r) => authHub.listen(AUTH_PORT, r));

  const appEnv = {
    SESSION_SECRET,
    CIVITAI_CLIENT_ID: 'probe-client',
    CIVITAI_CLIENT_SECRET: 'probe-secret',
    CIVITAI_AUTH_URL: `http://127.0.0.1:${AUTH_PORT}`,
    CIVITAI_BASE_URL: `http://127.0.0.1:${AUTH_PORT}`,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${APP_PORT}`,
    PORT: String(APP_PORT),
  };

  if (!process.env.PROBE_SKIP_BUILD) {
    console.log('[probe] building…');
    const build = run('npx', ['next', 'build'], appEnv);
    let buildLog = '';
    build.stdout.on('data', (d) => (buildLog += d));
    build.stderr.on('data', (d) => (buildLog += d));
    const code = await new Promise((r) => build.on('exit', r));
    if (code !== 0) {
      console.error(buildLog);
      throw new Error(`next build exited ${code}`);
    }
  }

  console.log('[probe] starting…');
  const server = run('npx', ['next', 'start', '-p', String(APP_PORT)], appEnv);
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  await waitForHttp(`http://127.0.0.1:${APP_PORT}/api/health`, 60_000);

  // ---- Scenario A: refresh rejected --------------------------------------
  refreshMode = 'reject';
  refreshAttempts = 0;
  let res = await fetch(`http://127.0.0.1:${APP_PORT}/`, {
    headers: { cookie: `civ_session=${expiredSessionCookie()}` },
    redirect: 'manual',
  });
  let body = await res.text();
  let cookies = sessionSetCookie(res.headers);
  const clears = Boolean(cookies.session && /civ_session=;/.test(cookies.session));
  const loggedOut = body.includes(LOGGED_OUT_MARKER);

  console.log('\n--- A: refresh REJECTED ---');
  console.log('status            :', res.status);
  console.log('refresh attempts  :', refreshAttempts);
  console.log('renders logged-out:', loggedOut, '(want true)');
  console.log('Set-Cookie        :', JSON.stringify(cookies.all));
  console.log('clears civ_session:', clears, '(want true)');

  check('A', res.status === 200, `expected 200, got ${res.status}`);
  check('A', refreshAttempts === 1, `expected 1 refresh attempt, got ${refreshAttempts}`);
  check('A', loggedOut, 'response does not render the logged-out page');
  check('A', clears, 'response does not Set-Cookie clearing civ_session');

  // ---- Scenario B: refresh accepted --------------------------------------
  refreshMode = 'accept';
  refreshAttempts = 0;
  res = await fetch(`http://127.0.0.1:${APP_PORT}/`, {
    headers: { cookie: `civ_session=${expiredSessionCookie()}` },
    redirect: 'manual',
  });
  body = await res.text();
  cookies = sessionSetCookie(res.headers);

  let carriedToken = null;
  if (cookies.session) {
    // Next percent-encodes cookie values on write and decodes them on read.
    const value = decodeURIComponent(
      cookies.session.slice('civ_session='.length).split(';')[0],
    );
    const raw = unsealCookie(value, SESSION_SECRET);
    if (raw) {
      try {
        carriedToken = JSON.parse(raw)?.tokens?.access_token ?? null;
      } catch {
        /* leave null */
      }
    }
  }
  const stillLoggedOut = body.includes(LOGGED_OUT_MARKER);
  const signedIn = body.includes(SIGNED_IN_MARKER);

  console.log('\n--- B: refresh ACCEPTED ---');
  console.log('status            :', res.status);
  console.log('refresh attempts  :', refreshAttempts);
  console.log('renders logged-out:', stillLoggedOut, '(want false)');
  console.log('renders signed-in :', signedIn, '(want true)');
  console.log('Set-Cookie        :', JSON.stringify(cookies.all));
  console.log('cookie carries    :', carriedToken, `(want ${NEW_ACCESS_TOKEN})`);

  check('B', res.status === 200, `expected 200, got ${res.status}`);
  check('B', refreshAttempts === 1, `expected 1 refresh attempt, got ${refreshAttempts}`);
  check('B', !stillLoggedOut, 'a successfully refreshed session still renders logged out');
  check(
    'B',
    signedIn,
    'the signed-in page never rendered (a stuck skeleton also lacks the logged-out marker)',
  );
  check(
    'B',
    carriedToken === NEW_ACCESS_TOKEN,
    `Set-Cookie does not carry the refreshed access token (got ${carriedToken})`,
  );

  if (failures.length || process.env.PROBE_DUMP_BODY) {
    console.log('\n--- server log tail ---');
    console.log(serverLog.split('\n').slice(-40).join('\n'));
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
  .finally(() => {
    authHub.close();
    cleanup();
  });
