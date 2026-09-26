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
 * THREE MORE SCENARIOS, all about the BUZZ BALANCE, all needing the same real
 * render (the balance is read server-side — `/api/trpc/[trpc].ts` sets no CORS
 * headers, so it cannot be read from the browser):
 *
 *   C. `BuzzRead` granted -> the REAL NUMBER is in the HTML. Not the label: the
 *      value. The four Playwright specs assert `getByText(/buzz balance/i)` and
 *      were green for the entire period every user saw `Buzz balance: —`.
 *   D. `BuzzRead` denied (403) -> the row DISAPPEARS. Not a dash, not an error
 *      banner, not a broken render. 403 is an ordinary outcome for a
 *      third-party client, so this is the load-bearing arm.
 *   E. `BuzzRead` absent from the token scope -> the request is not made at all.
 *
 * Measured on `main` @ b25658e, before the fix: C fails on both the row and the
 * value with ZERO buzz requests (the app never called the endpoint), and D/E
 * pass vacuously for the same reason.
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
/**
 * The Buzz balance the stand-in buzz endpoint reports.
 *
 * 🔴 DELIBERATELY NOT 1234, AND NOT A ROUND NUMBER. The old `/api/v1/me` stub
 * invented `balance: 1234`; reusing that value would let a regression that went
 * back to reading `/api/v1/me` pass by coincidence. It also must not collide
 * with any other digit string the page renders (the scope bitmask, the port),
 * or "the number is on the page" stops being evidence about the balance.
 */
const BUZZ_BALANCE = 40317;
/**
 * The signed-in row's label, WITH the colon. The logged-out copy also contains
 * the words "Buzz balance" ("…check your Buzz balance and generate one image"),
 * so the bare phrase would match a page that has no balance row at all.
 */
const BALANCE_ROW = 'Buzz balance:';

const children = [];
/**
 * 🔴 KILL THE PROCESS GROUP, NOT THE CHILD — and SIGKILL, not SIGTERM.
 *
 * `next start` is a WRAPPER: it spawns a separate `next-server` process. Killing
 * the child we spawned leaves that GRANDCHILD alive, still bound to the port.
 * Measured the hard way: an orphan from an earlier run kept answering on 3941
 * and served a build from before the change under test, so three consecutive
 * "measurements" were made against code that was not on disk — including a
 * negative control that exited 1 for entirely the wrong reason. The giveaway
 * was an EMPTY server log next to a 200 response: nothing we started was
 * serving those requests.
 *
 * `detached: true` at spawn puts each child in its own process group, so a
 * negative PID reaches the wrapper and everything it started.
 */
function killAll() {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGKILL');
    } catch {
      try {
        c.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}
process.on('exit', killAll);
process.on('SIGINT', () => {
  killAll();
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
/** `'grant'` -> 200 + a balance; `'deny'` -> 403, i.e. `BuzzRead` not granted. */
let buzzMode = 'grant';
let buzzAttempts = 0;

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
  //
  // 🔴 THIS PAYLOAD IS THE REAL ONE, FIELD FOR FIELD. It used to carry
  // `balance: 1234`, a key `/api/v1/me` has NEVER returned
  // (civitai/civitai `src/pages/api/v1/me.ts` sends id, username, tier, status,
  // isMember, subscriptions, and conditionally isModerator / email /
  // tokenScope+buzzLimit+subject). A stub that invents a field teaches the
  // wrong contract to everyone who reads it, and it is the reason the starters
  // read `balance` off this endpoint and rendered `Buzz balance: —` for every
  // real user while this probe was green. If you widen the stub, copy the real
  // handler, do not guess.
  if (req.url?.startsWith('/api/v1/me')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 1,
        username: 'probe-user',
        tier: 'free',
        status: 'active',
        isMember: false,
        subscriptions: [],
        tokenScope: 65537,
        buzzLimit: null,
        subject: { type: 'client', id: 'probe-client' },
      }),
    );
    return;
  }
  // buzz.getUserAccount — where the balance ACTUALLY lives. Requires the
  // `BuzzRead` scope, so 403 is an ordinary outcome for a third-party client,
  // not an error: `buzzMode = 'deny'` is the arm that proves the page degrades
  // to NO balance row instead of a dash, an error banner or a failed render.
  if (req.url?.startsWith('/api/trpc/buzz.getUserAccount')) {
    buzzAttempts += 1;
    if (buzzMode === 'deny') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { json: { message: 'FORBIDDEN', code: -32003 } } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    // superjson envelope, exactly as civitai's tRPC emits it. One entry — the
    // default account, labelled `yellow` — which is what the handler returns
    // when no `accountTypes` input is supplied.
    res.end(
      JSON.stringify({
        result: {
          data: {
            json: [
              { id: 1, balance: BUZZ_BALANCE, lifetimeBalance: 99999, accountType: 'yellow' },
            ],
          },
        },
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

function run(cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so `killAll` can take the wrapper AND its server.
    detached: true,
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

/**
 * A LIVE session — no refresh involved, so the buzz scenarios below measure the
 * balance path and nothing else.
 *
 * `scope` is a TokenScope bitmask: `UserRead` is 1<<0 and `BuzzRead` is 1<<16
 * (65536), so 65537 is "both" and 1 is "profile only, balance denied at
 * consent". Written as literals on purpose — importing the SDK's TokenScope
 * here would let a renumbering move the probe and the app together and keep
 * this green.
 */
function liveSessionCookie(scope = 65537) {
  return sealCookie(
    JSON.stringify({
      tokens: {
        access_token: 'live-access-token',
        refresh_token: 'some-refresh-token',
        expires_at: Date.now() + 3_600_000,
        scope,
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

  // 🔴 REFUSE TO MEASURE A SERVER WE DID NOT START. If something already
  // answers on this port, every assertion below would describe THAT process's
  // build, not the working tree — and it would look like a perfectly ordinary
  // pass or fail. This exact thing happened: an orphaned `next-server` from an
  // earlier run served three consecutive "measurements" of code that was not on
  // disk.
  let portBusy = false;
  try {
    await fetch(`http://127.0.0.1:${APP_PORT}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    portBusy = true;
  } catch {
    /* free, as it should be */
  }
  if (portBusy) {
    throw new Error(
      `port ${APP_PORT} already has something listening. A stale server would be ` +
        `measured instead of this build. Find it with \`ss -lptn 'sport = :${APP_PORT}'\` ` +
        `and kill it by the PID that reports, or set PROBE_APP_PORT to a free port.`,
    );
  }

  console.log('[probe] starting…');
  const server = run('npx', ['next', 'start', '-p', String(APP_PORT)], appEnv);
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  await waitForHttp(`http://127.0.0.1:${APP_PORT}/api/health`, 60_000);

  // Second half of the same guard: the server that answered must be the one we
  // started. An empty log beside a 200 response is the tell.
  if (!/Ready in|Local:/.test(serverLog)) {
    throw new Error(
      `something is answering on ${APP_PORT} but the server we started printed nothing ` +
        `(log: ${JSON.stringify(serverLog.slice(0, 200))}). Refusing to report a ` +
        `measurement of a process we do not own.`,
    );
  }

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

  // ---- Buzz balance: C (granted), D (403), E (scope absent) ---------------
  //
  // 🔴 WHY THESE EXIST. Every starter rendered `Buzz balance: —` because it
  // read `balance` off `/api/v1/me`, which has never returned one. The four
  // Playwright specs "shows balance" asserted only that the LABEL was visible —
  // true with the value missing — and they do not run in CI at all. These three
  // arms are the first check anywhere that reads the VALUE, and the first that
  // exercises the 403 a client without `BuzzRead` actually gets.
  async function loadSignedIn(cookie) {
    const r = await fetch(`http://127.0.0.1:${APP_PORT}/`, {
      headers: { cookie: `civ_session=${cookie}` },
      redirect: 'manual',
    });
    return { status: r.status, body: await r.text() };
  }

  refreshMode = 'accept';
  refreshAttempts = 0;

  // C — BuzzRead granted: the real number must be on the page.
  buzzMode = 'grant';
  buzzAttempts = 0;
  let out = await loadSignedIn(liveSessionCookie(65537));
  const cSignedIn = out.body.includes(SIGNED_IN_MARKER);
  const cHasRow = out.body.includes(BALANCE_ROW);
  const cHasValue = out.body.includes(String(BUZZ_BALANCE));
  const cAttempts = buzzAttempts;

  console.log('\n--- C: BuzzRead GRANTED ---');
  console.log('status            :', out.status);
  console.log('buzz requests     :', cAttempts, '(want 1)');
  console.log('renders signed-in :', cSignedIn, '(want true)');
  console.log('renders the row   :', cHasRow, '(want true)');
  console.log(`renders ${BUZZ_BALANCE}     :`, cHasValue, '(want true)');

  check('C', out.status === 200, `expected 200, got ${out.status}`);
  check('C', cSignedIn, 'the signed-in page never rendered');
  check(
    'C',
    cAttempts === 1,
    `expected exactly 1 buzz.getUserAccount request, got ${cAttempts}. Zero means the ` +
      `balance is not being fetched at all — which is the original bug, and a page that ` +
      `simply omits the row would otherwise look like a pass on the D arm.`,
  );
  check('C', cHasRow, 'the Buzz balance row is missing even though BuzzRead was granted');
  check(
    'C',
    cHasValue,
    `the page does not contain ${BUZZ_BALANCE}. A visible "Buzz balance" LABEL is not ` +
      `evidence of a balance — that is exactly what the e2e specs asserted while every ` +
      `user saw an em dash.`,
  );

  // D — the load-bearing arm: 403 must degrade to NO ROW, not to a dash, an
  // error banner, or a failed render.
  buzzMode = 'deny';
  buzzAttempts = 0;
  out = await loadSignedIn(liveSessionCookie(65537));
  const dSignedIn = out.body.includes(SIGNED_IN_MARKER);
  const dHasRow = out.body.includes(BALANCE_ROW);
  const dHasDash = /Buzz balance[^<]*<strong>\s*(—|-|null|undefined|NaN)/.test(out.body);
  const dHasBanner = out.body.includes('load profile');
  const dAttempts = buzzAttempts;

  console.log('\n--- D: BuzzRead DENIED (403) ---');
  console.log('status            :', out.status);
  console.log('buzz requests     :', dAttempts, '(want 1)');
  console.log('renders signed-in :', dSignedIn, '(want true)');
  console.log('renders the row   :', dHasRow, '(want false)');
  console.log('renders a dash    :', dHasDash, '(want false)');
  console.log('renders an error  :', dHasBanner, '(want false)');

  check('D', out.status === 200, `a 403 from the buzz endpoint broke the page (${out.status})`);
  check(
    'D',
    dAttempts === 1,
    `expected exactly 1 buzz.getUserAccount request, got ${dAttempts} — with 0 this arm ` +
      `passes without ever exercising the 403`,
  );
  check('D', dSignedIn, 'a 403 on the balance took the whole signed-in page down');
  check('D', !dHasRow, 'the balance row is still rendered without BuzzRead');
  check('D', !dHasDash, 'the balance row degraded to a placeholder instead of disappearing');
  check('D', !dHasBanner, 'a missing balance surfaced as a profile error banner');

  // E — the scope is absent from the token: skip the request entirely. Pins the
  // pre-check, which the D arm cannot see (D still has the scope).
  buzzMode = 'grant';
  buzzAttempts = 0;
  out = await loadSignedIn(liveSessionCookie(1));
  const eSignedIn = out.body.includes(SIGNED_IN_MARKER);
  const eHasRow = out.body.includes(BALANCE_ROW);
  const eAttempts = buzzAttempts;

  console.log('\n--- E: BuzzRead NOT IN THE TOKEN SCOPE ---');
  console.log('buzz requests     :', eAttempts, '(want 0 — pre-checked, not attempted)');
  console.log('renders signed-in :', eSignedIn, '(want true)');
  console.log('renders the row   :', eHasRow, '(want false)');

  check('E', eSignedIn, 'a token without BuzzRead cannot render the signed-in page');
  check(
    'E',
    eAttempts === 0,
    `the app asked buzz.getUserAccount ${eAttempts} time(s) with no BuzzRead in the ` +
      `token — that request can only 403`,
  );
  check('E', !eHasRow, 'the balance row is rendered for a token that cannot read a balance');

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
    // 🔴 TEARDOWN HAS TO BE FORCEFUL, AND I LEARNED THAT FROM CI RATHER THAN
    // LOCALLY. The first version called `authHub.close()` + SIGTERM and then
    // let the event loop drain. It printed PASS and HUNG: `close()` stops the
    // listener but WAITS for live connections, and the Next server holds
    // keep-alive sockets to the hub from its refresh and /api/v1/me calls. The
    // GitHub step timed out at 5 minutes on a run whose every assertion had
    // already passed — a green result reported as a red job, which is the worst
    // of both.
    authHub.closeAllConnections?.();
    authHub.close();
    killAll();
    // Nothing is outstanding at this point; exit rather than wait on a handle
    // some child still owns. `process.exitCode` is already set by the checks.
    process.exit(process.exitCode ?? 0);
  });
