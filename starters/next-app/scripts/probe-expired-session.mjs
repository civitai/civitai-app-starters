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
 * MEASURED at `origin/main` @ 5e071c4 with this probe copied into a clean
 * worktree of that ref: ALL THREE arms fail, 6 checks in total. `buzz requests`
 * is 0 in every one (the app never called the endpoint at all), C misses the
 * value, and D and E both still render the row — as a literal em dash, which is
 * the bug. At HEAD: C 1 request + the value present, D 1 request + no row + no
 * dash + no banner, E 0 requests + no row.
 *
 * AND THE REFRESH-FAILURE SCENARIOS (#855, #804). Only a DEFINITE rejection of
 * the credential may sign the browser out; everything else must leave the
 * cookie where it is so the next request can try again:
 *
 *   A2. refresh rejected with 401 -> cleared, like A's 400. An INVARIANT GUARD
 *       (base already clears on every failure); it pins the predicate's second
 *       status so a narrowing to 400-only goes red.
 *   F.  refresh fails TRANSIENTLY (503, 429, a reset connection) -> NO clearing
 *       Set-Cookie, and the next request with the SAME cookie refreshes and
 *       renders signed-in. The probe carries the cookie forward only if the
 *       first response did not clear it, i.e. it behaves like a browser.
 *   G.  N concurrent requests with the same expired cookie against a hub that
 *       ROTATES refresh tokens and rejects a spent one -> exactly ONE refresh
 *       call, zero clears, every response carries the rotated session; then a
 *       straggler with the OLD cookie inside the grace window reuses the rotated
 *       tokens without a second call.
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
/**
 * `refreshMode`:
 *   'accept'    -> 200 + NEW_ACCESS_TOKEN
 *   'reject'    -> 400 invalid_grant (a definite rejection)
 *   'reject401' -> 401 invalid_client (also definite)
 *   'status503' / 'status429' -> a transient server answer
 *   'reset'     -> the connection is destroyed: a network error, no status
 *   'rotate'    -> real rotation: a refresh token in `rotatingValid` is
 *                  accepted ONCE (and removed at ARRIVAL, before the delay, so
 *                  concurrent replays of it are rejected); anything else is a
 *                  400 invalid_grant. Both answers wait ROTATE_DELAY_MS so
 *                  concurrent requests are all in flight together.
 */
let refreshMode = 'reject';
let refreshAttempts = 0;
const rotatingValid = new Set();
const ROTATE_DELAY_MS = 1500;
const ROTATED_ACCESS_TOKEN = 'rotated-access-token-5821';
/** `'grant'` -> 200 + a balance; `'deny'` -> 403, i.e. `BuzzRead` not granted. */
let buzzMode = 'grant';
let buzzAttempts = 0;

const authHub = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/api/auth/oauth/token')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const presented = new URLSearchParams(raw).get('refresh_token');
    refreshAttempts += 1;
    if (refreshMode === 'rotate') {
      const fresh = rotatingValid.delete(presented);
      await sleep(ROTATE_DELAY_MS);
      if (!fresh) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: ROTATED_ACCESS_TOKEN,
          refresh_token: `${presented}-rotated`,
          expires_in: 3600,
          scope: 65537,
          token_type: 'Bearer',
        }),
      );
      return;
    }
    if (refreshMode === 'reset') {
      req.socket.destroy();
      return;
    }
    if (refreshMode === 'status503' || refreshMode === 'status429') {
      const status = refreshMode === 'status503' ? 503 : 429;
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(status === 503 ? 'Service Unavailable' : 'Too Many Requests');
      return;
    }
    if (refreshMode === 'reject401') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_client' }));
      return;
    }
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

/**
 * An access token that expired an hour ago, plus a refresh token.
 *
 * 🔴 EVERY SCENARIO PASSES ITS OWN `refreshToken`. The proxy keeps a successful
 * refresh for a short grace window, keyed by the refresh token, so a scenario
 * reusing another's token would be answered from that cache and never reach
 * the hub — its counters would then describe the cache, not its own path.
 */
function expiredSessionCookie(refreshToken) {
  if (!refreshToken) throw new Error('expiredSessionCookie needs a per-scenario refresh token');
  return sealCookie(
    JSON.stringify({
      tokens: {
        access_token: 'stale-access-token',
        refresh_token: refreshToken,
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

/** `true` when a `civ_session` Set-Cookie line empties the cookie. */
function isClearing(sessionLine) {
  return Boolean(sessionLine && /^civ_session=;/.test(sessionLine));
}

/** Unseal a `civ_session` Set-Cookie line and read its access token, or null. */
function carriedAccessToken(sessionLine) {
  if (!sessionLine || isClearing(sessionLine)) return null;
  // Next percent-encodes cookie values on write and decodes them on read.
  const value = decodeURIComponent(sessionLine.slice('civ_session='.length).split(';')[0]);
  const raw = unsealCookie(value, SESSION_SECRET);
  if (!raw) return null;
  try {
    return JSON.parse(raw)?.tokens?.access_token ?? null;
  } catch {
    return null;
  }
}

/** One page load, optionally carrying a `civ_session` cookie. */
async function loadPage(cookie) {
  const r = await fetch(`http://127.0.0.1:${APP_PORT}/`, {
    headers: cookie ? { cookie: `civ_session=${cookie}` } : {},
    redirect: 'manual',
  });
  const body = await r.text();
  return { status: r.status, body, cookies: sessionSetCookie(r.headers) };
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
    headers: { cookie: `civ_session=${expiredSessionCookie('refresh-A')}` },
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

  // ---- Scenario A2: refresh rejected with 401 ----------------------------
  // Invariant guard (see the header): the second status of the definite-
  // rejection predicate. A 401 from the token endpoint means the client
  // credentials were refused, which no retry of this cookie can fix.
  refreshMode = 'reject401';
  refreshAttempts = 0;
  {
    const out = await loadPage(expiredSessionCookie('refresh-A2'));
    const a2Clears = isClearing(out.cookies.session);
    console.log('\n--- A2: refresh REJECTED (401) ---');
    console.log('status            :', out.status);
    console.log('refresh attempts  :', refreshAttempts, '(want 1)');
    console.log('renders logged-out:', out.body.includes(LOGGED_OUT_MARKER), '(want true)');
    console.log('clears civ_session:', a2Clears, '(want true)');
    check('A2', out.status === 200, `expected 200, got ${out.status}`);
    check('A2', refreshAttempts === 1, `expected 1 refresh attempt, got ${refreshAttempts}`);
    check('A2', out.body.includes(LOGGED_OUT_MARKER), 'a 401 did not render logged out');
    check('A2', a2Clears, 'a definite 401 rejection did not clear civ_session');
  }

  // ---- Scenario B: refresh accepted --------------------------------------
  refreshMode = 'accept';
  refreshAttempts = 0;
  res = await fetch(`http://127.0.0.1:${APP_PORT}/`, {
    headers: { cookie: `civ_session=${expiredSessionCookie('refresh-B')}` },
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

  // ---- F: a TRANSIENT refresh failure keeps the browser's cookie (#855) ---
  //
  // Three shapes of "the auth hub could not answer right now": a 503, a 429
  // (a 4xx that is NOT a credential verdict — it catches a predicate widened
  // to "any 4xx"), and a reset connection (no HTTP status at all, so the SDK
  // throws a TypeError rather than an OAuthError).
  //
  // Step 2 behaves like a browser: it sends the cookie again ONLY if step 1
  // did not clear it. So a clearing step 1 fails BOTH steps — the clear
  // itself, and the recovery that the clear made impossible.
  for (const [label, mode] of [
    ['F503', 'status503'],
    ['F429', 'status429'],
    ['Fnet', 'reset'],
  ]) {
    const cookie = expiredSessionCookie(`refresh-${label}`);

    refreshMode = mode;
    refreshAttempts = 0;
    const first = await loadPage(cookie);
    const firstAttempts = refreshAttempts;
    const firstClears = isClearing(first.cookies.session);

    const jar = firstClears ? null : cookie;
    refreshMode = 'accept';
    refreshAttempts = 0;
    const second = await loadPage(jar);
    const secondAttempts = refreshAttempts;
    const secondToken = carriedAccessToken(second.cookies.session);
    const secondSignedIn = second.body.includes(SIGNED_IN_MARKER);

    console.log(`\n--- ${label}: refresh fails TRANSIENTLY (${mode}), then recovers ---`);
    console.log('1 status          :', first.status);
    console.log('1 refresh attempts:', firstAttempts, '(want 1)');
    console.log('1 Set-Cookie      :', JSON.stringify(first.cookies.all), '(want no civ_session)');
    console.log('1 clears          :', firstClears, '(want false)');
    console.log('2 sent cookie     :', jar !== null, '(want true)');
    console.log('2 refresh attempts:', secondAttempts, '(want 1)');
    console.log('2 cookie carries  :', secondToken, `(want ${NEW_ACCESS_TOKEN})`);
    console.log('2 renders signedin:', secondSignedIn, '(want true)');

    check(label, first.status === 200, `a transient refresh failure broke the page (${first.status})`);
    check(
      label,
      firstAttempts === 1,
      `expected 1 refresh attempt on the failing load, got ${firstAttempts} — with 0 the ` +
        `transient path was never exercised`,
    );
    check(
      label,
      first.cookies.session === undefined,
      `a transient refresh failure (${mode}) wrote civ_session: ${first.cookies.session}`,
    );
    check(label, !firstClears, `a transient refresh failure (${mode}) cleared civ_session`);
    check(
      label,
      secondAttempts === 1,
      `expected the next load to retry the refresh once, got ${secondAttempts}`,
    );
    check(
      label,
      secondToken === NEW_ACCESS_TOKEN,
      `the next load did not recover the session (cookie carries ${secondToken})`,
    );
    check(label, secondSignedIn, 'the next load did not render signed-in');
  }

  // ---- G: concurrent refreshes of ONE rotating refresh token (#804) -------
  //
  // The hub accepts `refresh-G` exactly once and 400s every replay. Without
  // single-flight, each of the N concurrent requests presents `refresh-G`,
  // one wins and N-1 get invalid_grant and CLEAR the cookie — and whichever
  // Set-Cookie the browser applies last decides whether the user stays
  // signed in. ROTATE_DELAY_MS keeps all N in flight at once.
  {
    const N = 6;
    rotatingValid.clear();
    rotatingValid.add('refresh-G');
    refreshMode = 'rotate';
    refreshAttempts = 0;
    const cookie = expiredSessionCookie('refresh-G');
    const outs = await Promise.all(Array.from({ length: N }, () => loadPage(cookie)));
    const concurrentAttempts = refreshAttempts;
    const tokens = outs.map((o) => carriedAccessToken(o.cookies.session));
    const cleared = outs.filter((o) => isClearing(o.cookies.session)).length;
    const rotated = tokens.filter((t) => t === ROTATED_ACCESS_TOKEN).length;
    const signedIn = outs.filter((o) => o.body.includes(SIGNED_IN_MARKER)).length;

    // A straggler: the OLD cookie again, after the rotation finished, as a tab
    // that had not yet received the new Set-Cookie would send it.
    const late = await loadPage(cookie);
    const lateAttempts = refreshAttempts - concurrentAttempts;
    const lateToken = carriedAccessToken(late.cookies.session);

    console.log(`\n--- G: ${N} CONCURRENT refreshes of one rotating refresh token ---`);
    console.log('statuses          :', JSON.stringify(outs.map((o) => o.status)));
    console.log('refresh calls     :', concurrentAttempts, '(want 1)');
    console.log('cleared responses :', cleared, '(want 0)');
    console.log('rotated responses :', rotated, `(want ${N})`);
    console.log('signed-in renders :', signedIn, `(want ${N})`);
    console.log('late extra calls  :', lateAttempts, '(want 0 — grace window)');
    console.log('late carries      :', lateToken, `(want ${ROTATED_ACCESS_TOKEN})`);

    check('G', outs.every((o) => o.status === 200), 'a concurrent load did not return 200');
    check(
      'G',
      concurrentAttempts === 1,
      `expected exactly 1 refresh call for ${N} concurrent loads, got ${concurrentAttempts}. ` +
        `0 means the refresh path never ran; more than 1 means the spent refresh token ` +
        `was replayed`,
    );
    check('G', cleared === 0, `${cleared} of ${N} concurrent responses cleared civ_session`);
    check('G', rotated === N, `only ${rotated} of ${N} responses carry the rotated session`);
    check('G', signedIn === N, `only ${signedIn} of ${N} concurrent loads rendered signed-in`);
    check(
      'G',
      lateAttempts === 0,
      `a straggler with the old cookie made ${lateAttempts} more refresh call(s) — the ` +
        `spent refresh token was replayed instead of reusing the rotation`,
    );
    check(
      'G',
      lateToken === ROTATED_ACCESS_TOKEN,
      `the straggler did not get the rotated session (cookie carries ${lateToken})`,
    );
  }

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
