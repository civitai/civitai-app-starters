#!/usr/bin/env node
/**
 * Probe: what does the BUILT server do when the session refresh fails, when
 * several requests refresh one session at once, when the user signs out, and
 * when an estimate comes back without a cost?
 *
 * 🔴 THE SAME FILE IN react-pwa, svelte-pwa AND sveltekit-app (the repo guard
 * `tests/guards/starter-shared-modules-parity.test.mjs` keeps the copies
 * identical). It finds out which one it is in from the directory: a Hono BFF
 * (`server/app.ts`, built by `tsc` to `dist-server/app.js`) or a SvelteKit app
 * (`vite build` to `.svelte-kit/output/server/`). Either way it loads the
 * build IN THIS PROCESS and calls its request handler directly, so nothing
 * listens on a port and there is no child to orphan. `next-app` has its own
 * probe, which drives `next start`.
 *
 * Every arm talks to a stand-in Civitai (auth hub, `/api/v1/me`, Buzz, the
 * orchestrator) on 127.0.0.1, and every arm asserts the stand-in's call count,
 * so a zero cannot pass: an arm whose request never reached the refresh path
 * would otherwise look exactly like one that handled it.
 *
 *   A.  refresh answered `invalid_grant` -> the session cookie is CLEARED and
 *       the request is signed out. The one definite rejection.
 *   B.  refresh accepted -> the response re-seals the session with the new
 *       access token, and the request is signed in.
 *   F.  refresh fails WITHOUT rejecting the refresh token (503, 429, a reset
 *       connection, `invalid_client` as a 400 and as a 401) -> NO clearing
 *       Set-Cookie; an immediate second request does not call the token
 *       endpoint again (5 s backoff); after the backoff the SAME cookie
 *       refreshes and is signed in. The probe re-sends the cookie only if the
 *       first response did not clear it, as a browser would. (#855)
 *   G.  6 concurrent requests with one expired cookie against a hub that
 *       ROTATES refresh tokens and rejects a spent one -> ONE refresh call,
 *       no clears, every response carries the rotated session; then a
 *       straggler with the OLD cookie reuses the rotation. (#804)
 *   H.  the token call HANGS -> the request still answers well inside 20 s
 *       with the cookie kept, and recovers once the call is released.
 *   L.  sign out (and R: revoke) right after a rotation, then a request with
 *       the PRE-rotation cookie inside the 60 s reuse window -> NOT signed in:
 *       the old refresh token goes back to the hub (which refuses it) instead
 *       of being answered with the signed-out session's tokens.
 *   E.  estimate whose snapshot has NO cost -> `cost: null`, never 0; an
 *       explicit 0 stays 0, and 17 stays 17. (#854)
 *
 *   node scripts/probe-expired-session.mjs
 *   PROBE_SKIP_BUILD=1 node scripts/probe-expired-session.mjs   # reuse the build
 *
 * Exits 0 on pass, 1 on failure, printing the measured values either way.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const { sealCookie, unsealCookie } = await import('@civitai/app-sdk/cookies');

const PKG_DIR = new URL('..', import.meta.url).pathname;
const KIND = existsSync(join(PKG_DIR, 'server', 'app.ts')) ? 'hono' : 'sveltekit';
const HUB_PORT = Number(process.env.PROBE_AUTH_PORT ?? 3962);
const HUB = `http://127.0.0.1:${HUB_PORT}`;
const ORIGIN = 'http://127.0.0.1:5199';
const SESSION_SECRET = randomBytes(32).toString('hex');

const SIGNED_IN_MARKER = 'probe-user';
const NEW_ACCESS_TOKEN = 'refreshed-access-token-1234';
const ROTATED_ACCESS_TOKEN = 'rotated-access-token-5821';
const ROTATE_DELAY_MS = 1500;
/** Past the 5 s backoff. A literal: importing the module's constant would let the two move together. */
const RETRY_WAIT_MS = 5_500;

// ---------------------------------------------------------------------------
// The stand-in Civitai.
// ---------------------------------------------------------------------------

/**
 * `refreshMode`:
 *   'accept'    -> 200 + NEW_ACCESS_TOKEN
 *   'reject'    -> 400 invalid_grant (the one definite rejection)
 *   'client400' / 'client401' -> invalid_client: the APP was refused
 *   'status503' / 'status429' -> a transient answer
 *   'reset'     -> the connection is destroyed: no status at all
 *   'hang'      -> accepted and never answered, until the probe releases it
 *   'rotate'    -> a refresh token in `rotatingValid` is accepted ONCE (and
 *                  removed on arrival, so a concurrent replay is refused);
 *                  anything else is 400 invalid_grant. Both wait
 *                  ROTATE_DELAY_MS so concurrent requests overlap.
 */
let refreshMode = 'reject';
let refreshAttempts = 0;
const rotatingValid = new Set();
const hung = [];
/** `'absent'` -> no `cost`; `'zero'` -> `cost.total: 0`; `'seventeen'` -> 17. */
let estimateMode = 'absent';
let estimateCalls = 0;

const hub = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if (req.method === 'POST' && req.url?.startsWith('/api/auth/oauth/token')) {
    const presented = new URLSearchParams(raw).get('refresh_token');
    refreshAttempts += 1;
    switch (refreshMode) {
      case 'rotate': {
        const fresh = rotatingValid.delete(presented);
        await sleep(ROTATE_DELAY_MS);
        if (!fresh) return send(400, { error: 'invalid_grant' });
        return send(200, {
          access_token: ROTATED_ACCESS_TOKEN,
          refresh_token: `${presented}-rotated`,
          expires_in: 3600,
          scope: 65537,
          token_type: 'Bearer',
        });
      }
      case 'reset':
        req.socket.destroy();
        return;
      case 'hang':
        hung.push(res);
        return;
      case 'status503':
        return send(503, 'Service Unavailable');
      case 'status429':
        return send(429, 'Too Many Requests');
      case 'client400':
        return send(400, { error: 'invalid_client' });
      case 'client401':
        return send(401, { error: 'invalid_client' });
      case 'accept':
        return send(200, {
          access_token: NEW_ACCESS_TOKEN,
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
          scope: 65537,
          token_type: 'Bearer',
        });
      default:
        return send(400, { error: 'invalid_grant' });
    }
  }
  // Revocation: refuse it, which the starters treat as best-effort anyway.
  if (req.url?.startsWith('/api/auth/oauth/revoke')) return send(404, {});
  // The real `/api/v1/me` fields; never a `balance` (it has none).
  if (req.url?.startsWith('/api/v1/me')) {
    return send(200, {
      id: 1,
      username: SIGNED_IN_MARKER,
      tier: 'free',
      status: 'active',
      isMember: false,
      subscriptions: [],
      tokenScope: 65537,
      buzzLimit: null,
      subject: { type: 'client', id: 'probe-client' },
    });
  }
  if (req.url?.startsWith('/api/trpc/buzz.getUserAccount')) {
    return send(200, {
      result: { data: { json: [{ id: 1, balance: 40317, lifetimeBalance: 99999, accountType: 'yellow' }] } },
    });
  }
  if (req.url?.startsWith('/v2/consumer/workflows')) {
    estimateCalls += 1;
    const snapshot = { id: 'wf-probe', status: 'unassigned', steps: [] };
    if (estimateMode === 'zero') snapshot.cost = { total: 0 };
    if (estimateMode === 'seventeen') snapshot.cost = { total: 17 };
    return send(200, snapshot);
  }
  res.writeHead(404).end();
});

// ---------------------------------------------------------------------------
// Load the build and get a `Request -> Response` handler.
// ---------------------------------------------------------------------------

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: PKG_DIR, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${c}`))));
    child.on('error', reject);
  });
}

async function loadHandler() {
  // Set BEFORE the build is imported: both env modules read at module scope.
  delete process.env.SKIP_ENV_VALIDATION;
  Object.assign(process.env, {
    SESSION_SECRET,
    CIVITAI_CLIENT_ID: 'probe-client',
    CIVITAI_CLIENT_SECRET: 'probe-secret',
    APP_URL: ORIGIN,
    CIVITAI_AUTH_URL: HUB,
    CIVITAI_BASE_URL: HUB,
    ORCHESTRATOR_URL: HUB,
  });

  if (KIND === 'hono') {
    if (!process.env.PROBE_SKIP_BUILD) await run('npx', ['tsc', '-p', 'tsconfig.server.json']);
    const { app } = await import(pathToFileURL(join(PKG_DIR, 'dist-server', 'app.js')).href);
    return (request) => app.fetch(request);
  }

  if (!process.env.PROBE_SKIP_BUILD) await run('npx', ['vite', 'build'], { SKIP_ENV_VALIDATION: '1' });
  const out = join(PKG_DIR, '.svelte-kit', 'output', 'server');
  const { Server } = await import(pathToFileURL(join(out, 'index.js')).href);
  const { manifest } = await import(pathToFileURL(join(out, 'manifest.js')).href);
  const server = new Server(manifest);
  await server.init({ env: process.env });
  return (request) => server.respond(request, { getClientAddress: () => '127.0.0.1' });
}

// ---------------------------------------------------------------------------
// Cookies and requests.
// ---------------------------------------------------------------------------

function sealedSession(refreshToken, expiresInMs) {
  return sealCookie(
    JSON.stringify({
      tokens: {
        access_token: expiresInMs > 0 ? 'live-access-token' : 'stale-access-token',
        refresh_token: refreshToken,
        expires_at: Date.now() + expiresInMs,
        scope: 65537,
      },
    }),
    SESSION_SECRET,
  );
}

/**
 * An access token that expired an hour ago. 🔴 EVERY ARM PASSES ITS OWN
 * refresh token: the server remembers a refresh per refresh token, so a
 * shared one would be answered from that memory and never reach the hub.
 */
const expiredCookie = (refreshToken) => sealedSession(refreshToken, -3_600_000);
const liveCookie = () => sealedSession('live-refresh-token', 3_600_000);

/** The raw `civ_session` value a browser would store from a Set-Cookie line. */
function cookieValue(line) {
  return line ? line.slice('civ_session='.length).split(';')[0] : '';
}

const isClearing = (line) => Boolean(line && /^civ_session=;/.test(line));

function carriedAccessToken(line) {
  if (!line || isClearing(line)) return null;
  const raw = unsealCookie(decodeURIComponent(cookieValue(line)), SESSION_SECRET);
  if (!raw) return null;
  try {
    return JSON.parse(raw)?.tokens?.access_token ?? null;
  } catch {
    return null;
  }
}

let handle;

async function send(path, { cookie, method = 'GET', body, timeoutMs = 25_000 } = {}) {
  const headers = {};
  if (cookie) headers.cookie = `civ_session=${cookie}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const res = await Promise.race([handle(request), timeout]);
    const text = await res.text();
    const all = res.headers.getSetCookie?.() ?? [];
    return { status: res.status, body: text, session: all.find((c) => c.startsWith('civ_session=')) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One "page load": the request that shows who is signed in. The Hono BFF's
 * SPA asks `GET /api/me`; the SvelteKit app renders `/` on the server.
 */
async function load(cookie, opts = {}) {
  const out = await send(KIND === 'hono' ? '/api/me' : '/', { cookie, ...opts });
  return { ...out, signedIn: out.body.includes(SIGNED_IN_MARKER) };
}

const failures = [];
function check(arm, ok, detail) {
  if (!ok) failures.push(`[${arm}] ${detail}`);
}

// ---------------------------------------------------------------------------
// The arms.
// ---------------------------------------------------------------------------

async function main() {
  await new Promise((r) => hub.listen(HUB_PORT, '127.0.0.1', r));
  handle = await loadHandler();
  console.log(`[probe] ${KIND} build loaded in-process; stand-in Civitai on ${HUB}`);

  // ---- A: invalid_grant clears --------------------------------------------
  refreshMode = 'reject';
  refreshAttempts = 0;
  let r = await load(expiredCookie('refresh-A'));
  console.log('\n--- A: refresh answered invalid_grant ---');
  console.log('refresh attempts:', refreshAttempts, '(want 1)');
  console.log('clears          :', isClearing(r.session), '(want true)');
  console.log('signed in       :', r.signedIn, '(want false)');
  check('A', refreshAttempts === 1, `expected 1 refresh attempt, got ${refreshAttempts}`);
  check('A', isClearing(r.session), `invalid_grant did not clear civ_session (${r.session})`);
  check('A', !r.signedIn, 'a rejected refresh still rendered signed-in');

  // ---- B: accepted refresh re-seals ---------------------------------------
  refreshMode = 'accept';
  refreshAttempts = 0;
  r = await load(expiredCookie('refresh-B'));
  console.log('\n--- B: refresh accepted ---');
  console.log('refresh attempts:', refreshAttempts, '(want 1)');
  console.log('cookie carries  :', carriedAccessToken(r.session), `(want ${NEW_ACCESS_TOKEN})`);
  console.log('signed in       :', r.signedIn, '(want true)');
  check('B', refreshAttempts === 1, `expected 1 refresh attempt, got ${refreshAttempts}`);
  check('B', carriedAccessToken(r.session) === NEW_ACCESS_TOKEN, 'Set-Cookie does not carry the refreshed token');
  check('B', r.signedIn, 'a refreshed session did not render signed-in');

  // ---- F: a failure that is not invalid_grant keeps the cookie -------------
  for (const [label, mode] of [
    ['F503', 'status503'],
    ['F429', 'status429'],
    ['Fnet', 'reset'],
    ['Fclient400', 'client400'],
    ['Fclient401', 'client401'],
  ]) {
    const cookie = expiredCookie(`refresh-${label}`);
    refreshMode = mode;
    refreshAttempts = 0;
    const first = await load(cookie);
    const firstAttempts = refreshAttempts;
    const jar = isClearing(first.session) ? null : cookie;
    const burst = await load(jar);
    const burstAttempts = refreshAttempts - firstAttempts;

    await sleep(RETRY_WAIT_MS);
    refreshMode = 'accept';
    refreshAttempts = 0;
    const second = await load(jar);
    const secondAttempts = refreshAttempts;
    const secondToken = carriedAccessToken(second.session);

    console.log(`\n--- ${label}: refresh fails without invalid_grant (${mode}), then recovers ---`);
    console.log('1 refresh attempts:', firstAttempts, '(want 1)');
    console.log('1 Set-Cookie      :', JSON.stringify(first.session ?? null), '(want null)');
    console.log('1b extra attempts :', burstAttempts, '(want 0 — backing off)');
    console.log('2 sent cookie     :', jar !== null, '(want true)');
    console.log('2 refresh attempts:', secondAttempts, '(want 1)');
    console.log('2 cookie carries  :', secondToken, `(want ${NEW_ACCESS_TOKEN})`);

    check(label, firstAttempts === 1, `expected 1 refresh attempt, got ${firstAttempts} — with 0 the path never ran`);
    check(label, first.session === undefined, `a ${mode} failure wrote civ_session: ${first.session}`);
    check(label, !first.signedIn, `a ${mode} failure rendered signed-in with an expired token`);
    check(label, burstAttempts === 0, `an immediate second request called the token endpoint again (${burstAttempts})`);
    check(label, !isClearing(burst.session), 'the immediate second request cleared civ_session');
    check(label, secondAttempts === 1, `expected the next request to retry once, got ${secondAttempts}`);
    check(label, secondToken === NEW_ACCESS_TOKEN, `the next request did not recover (carries ${secondToken})`);
    check(label, second.signedIn, 'the next request did not render signed-in');
  }

  // ---- G: concurrent refreshes of one rotating refresh token ---------------
  {
    const N = 6;
    rotatingValid.clear();
    rotatingValid.add('refresh-G');
    refreshMode = 'rotate';
    refreshAttempts = 0;
    const cookie = expiredCookie('refresh-G');
    const outs = await Promise.all(Array.from({ length: N }, () => load(cookie)));
    const concurrent = refreshAttempts;
    const cleared = outs.filter((o) => isClearing(o.session)).length;
    const rotated = outs.filter((o) => carriedAccessToken(o.session) === ROTATED_ACCESS_TOKEN).length;
    const late = await load(cookie);
    const lateAttempts = refreshAttempts - concurrent;

    console.log(`\n--- G: ${N} concurrent refreshes of one rotating refresh token ---`);
    console.log('refresh calls     :', concurrent, '(want 1)');
    console.log('cleared responses :', cleared, '(want 0)');
    console.log('rotated responses :', rotated, `(want ${N})`);
    console.log('late extra calls  :', lateAttempts, '(want 0 — reuse window)');
    console.log('late carries      :', carriedAccessToken(late.session), `(want ${ROTATED_ACCESS_TOKEN})`);

    check('G', concurrent === 1, `expected 1 refresh call for ${N} concurrent requests, got ${concurrent}`);
    check('G', cleared === 0, `${cleared} of ${N} concurrent responses cleared civ_session`);
    check('G', rotated === N, `only ${rotated} of ${N} responses carry the rotated session`);
    check('G', outs.every((o) => o.signedIn), 'a concurrent request did not render signed-in');
    check('G', lateAttempts === 0, `a straggler with the old cookie replayed the spent refresh token (${lateAttempts})`);
    check('G', carriedAccessToken(late.session) === ROTATED_ACCESS_TOKEN, 'the straggler did not get the rotation');
  }

  // ---- H: a hung token call must not hang the request ----------------------
  {
    const cookie = expiredCookie('refresh-H');
    refreshMode = 'hang';
    refreshAttempts = 0;
    const t0 = Date.now();
    let first = null;
    let firstError = null;
    try {
      first = await load(cookie, { timeoutMs: 25_000 });
    } catch (err) {
      firstError = err;
    }
    const elapsed = Date.now() - t0;
    const firstAttempts = refreshAttempts;
    for (const res of hung.splice(0)) res.socket?.destroy();
    await sleep(RETRY_WAIT_MS);
    refreshMode = 'accept';
    refreshAttempts = 0;
    const second = await load(first && isClearing(first.session) ? null : cookie);

    console.log('\n--- H: the token call hangs, then is released ---');
    console.log('1 answered        :', first !== null, `(want true; ${firstError?.message ?? 'no error'})`);
    console.log('1 elapsed ms      :', elapsed, '(want < 20000)');
    console.log('1 Set-Cookie      :', JSON.stringify(first?.session ?? null), '(want null)');
    console.log('2 refresh attempts:', refreshAttempts, '(want 1)');

    check('H', first !== null, `the request did not answer while the token call hung (${firstError?.message})`);
    check('H', elapsed < 20_000, `the request took ${elapsed} ms while the token call hung`);
    check('H', firstAttempts === 1, `expected 1 refresh attempt, got ${firstAttempts}`);
    check('H', first !== null && first.session === undefined, `a hung token call wrote civ_session: ${first?.session}`);
    check('H', refreshAttempts === 1, `expected the request after release to retry once, got ${refreshAttempts}`);
    check('H', carriedAccessToken(second.session) === NEW_ACCESS_TOKEN, 'the request after release did not recover');
  }

  // ---- L / R: signing out ends the reuse window ---------------------------
  for (const [label, path] of [
    ['L', '/api/auth/logout'],
    ['R', '/api/auth/revoke'],
  ]) {
    rotatingValid.clear();
    rotatingValid.add(`refresh-${label}`);
    refreshMode = 'rotate';
    refreshAttempts = 0;
    const old = expiredCookie(`refresh-${label}`);
    const first = await load(old);
    const rotatedOk = carriedAccessToken(first.session) === ROTATED_ACCESS_TOKEN;

    // Sign out the way the browser would: with the cookie it now holds.
    const out = await send(path, { method: 'POST', cookie: cookieValue(first.session) });
    const before = refreshAttempts;
    // Another tab still holding the pre-rotation cookie, inside 60 s.
    const late = await load(old);
    const lateAttempts = refreshAttempts - before;
    const lateToken = carriedAccessToken(late.session);

    console.log(`\n--- ${label}: ${path} right after a rotation, then the old cookie ---`);
    console.log('rotated first     :', rotatedOk, '(want true)');
    console.log('sign-out status   :', out.status, '| clears:', isClearing(out.session), '(want true)');
    console.log('late refresh calls:', lateAttempts, '(want 1 — the old token goes back to the hub)');
    console.log('late carries      :', lateToken, '(want null)');
    console.log('late signed in    :', late.signedIn, '(want false)');

    check(label, rotatedOk, 'the first request did not rotate the session — the arm measured nothing');
    check(label, isClearing(out.session), `${path} did not clear civ_session (${out.session})`);
    check(
      label,
      lateAttempts === 1,
      `after ${path}, a request with the pre-rotation cookie made ${lateAttempts} refresh calls; ` +
        `0 means it was answered from the signed-out session's remembered rotation`,
    );
    check(label, lateToken === null, `after ${path}, the pre-rotation cookie was handed a session (${lateToken})`);
    check(label, !late.signedIn, `after ${path}, the pre-rotation cookie rendered signed-in`);
  }

  // ---- E: an estimate without a cost is not free ---------------------------
  for (const [label, mode, want] of [
    ['E-absent', 'absent', null],
    ['E-zero', 'zero', 0],
    ['E-17', 'seventeen', 17],
  ]) {
    estimateMode = mode;
    estimateCalls = 0;
    const res = await send('/api/generate/estimate', {
      method: 'POST',
      cookie: liveCookie(),
      body: { prompt: 'a probe prompt' },
    });
    let cost;
    try {
      cost = JSON.parse(res.body).cost;
    } catch {
      cost = `unparseable: ${res.body.slice(0, 120)}`;
    }
    console.log(`\n--- ${label}: estimate snapshot cost ${mode} ---`);
    console.log('status            :', res.status, '(want 200)');
    console.log('orchestrator calls:', estimateCalls, '(want 1)');
    console.log('cost              :', JSON.stringify(cost), `(want ${JSON.stringify(want)})`);
    check(label, res.status === 200, `estimate answered ${res.status}: ${res.body.slice(0, 200)}`);
    check(label, estimateCalls === 1, `expected 1 orchestrator call, got ${estimateCalls}`);
    check(label, cost === want, `estimate reported cost ${JSON.stringify(cost)}, want ${JSON.stringify(want)}`);
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
    // The build holds keep-alive sockets to the stand-in; `close()` alone would
    // wait on them. Nothing is outstanding by now, so exit.
    for (const res of hung.splice(0)) res.socket?.destroy();
    hub.closeAllConnections?.();
    hub.close();
    process.exit(process.exitCode ?? 0);
  });
