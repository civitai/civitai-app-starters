/**
 * Unit tests for the session-refresh single-flight (civitai/civitai-app-starters
 * #804, #855): the 60 s reuse window, the 5 s backoff, the 1000-entry cap,
 * which failures count as a dead credential, and that signing out forgets
 * the session's remembered refreshes.
 *
 * Runs the SHIPPED module under `node --test` (Node 22.18+ / 24 strip the
 * TypeScript types natively). The token endpoint is a fake `fetch` and the
 * clock is `node:test`'s mocked `Date`, so nothing here waits for real time or
 * touches the network. The module keeps ONE map per process, so every test
 * uses its own refresh tokens and counts its own calls.
 *
 * Every number below is a literal, not the module's exported constant:
 * importing `REFRESH_GRACE_MS` would let the window and its test move together.
 */
import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { OAuthError } from '@civitai/app-sdk';

// The one line that differs between the starters' copies of this file.
const MODULE = '../src/lib/refresh-tokens.ts';
const { forgetRefreshesFor, isDefiniteRejection, refreshTokensOnce } = await import(MODULE);

const T0 = 1_800_000_000_000;
const realFetch = globalThis.fetch;

/**
 * A fake token endpoint. `answer(refreshToken)` returns the response for one
 * call; `calls` lists the refresh token each call presented.
 */
function fakeHub(answer) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const presented = new URLSearchParams(init.body).get('refresh_token');
    calls.push(presented);
    return answer(presented);
  };
  return calls;
}

/** A successful rotation: `<presented>` -> access `<presented>-access`, refresh `next(presented)`. */
function rotateTo(next) {
  return (presented) =>
    new Response(
      JSON.stringify({
        access_token: `${presented}-access`,
        refresh_token: next(presented),
        expires_in: 3600,
        scope: 65537,
        token_type: 'Bearer',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refresh = (refreshToken) =>
  refreshTokensOnce({
    baseUrl: 'http://hub.invalid',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    refreshToken,
    fallbackScope: 65537,
  });

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
});

afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

// --- which failures are a verdict on the refresh token ---------------------

test('only an invalid_grant OAuthError is a definite rejection', () => {
  assert.equal(isDefiniteRejection(new OAuthError('x', 400, { error: 'invalid_grant' })), true);
  assert.equal(isDefiniteRejection(new OAuthError('x', 400, { error: 'invalid_client' })), false);
  assert.equal(isDefiniteRejection(new OAuthError('x', 401, { error: 'invalid_client' })), false);
  assert.equal(isDefiniteRejection(new OAuthError('x', 503, 'Service Unavailable')), false);
  assert.equal(isDefiniteRejection(new OAuthError('x', 429, null)), false);
  assert.equal(isDefiniteRejection(new TypeError('fetch failed')), false);
  // The body, not the class name: a plain Error shaped like one is not it.
  assert.equal(isDefiniteRejection(Object.assign(new Error('x'), { body: { error: 'invalid_grant' } })), false);
});

// --- single flight ----------------------------------------------------------

test('concurrent refreshes of one refresh token make one call', async () => {
  const calls = fakeHub(rotateTo((p) => `${p}-next`));
  const out = await Promise.all([refresh('sf-1'), refresh('sf-1'), refresh('sf-1')]);
  assert.deepEqual(calls, ['sf-1']);
  assert.deepEqual(
    out.map((t) => t.access_token),
    ['sf-1-access', 'sf-1-access', 'sf-1-access'],
  );
});

// --- the 60 s reuse window --------------------------------------------------

test('a successful rotation is reused inside 60 s and not after', async () => {
  const calls = fakeHub(rotateTo((p) => `${p}-next`));
  assert.equal((await refresh('win-1')).refresh_token, 'win-1-next');

  mock.timers.setTime(T0 + 59_000);
  assert.equal((await refresh('win-1')).refresh_token, 'win-1-next');
  assert.equal(calls.length, 1, 'a straggler 59 s later must reuse the rotation');

  mock.timers.setTime(T0 + 61_000);
  await refresh('win-1');
  assert.equal(calls.length, 2, 'past 60 s the refresh token must be presented again');
});

// --- the 5 s backoff after a failure that keeps the cookie ------------------

test('a 503 is remembered for 5 s, then retried', async () => {
  const calls = fakeHub(() => new Response('Service Unavailable', { status: 503 }));
  await assert.rejects(refresh('bo-1'), (err) => err instanceof OAuthError && err.status === 503);

  mock.timers.setTime(T0 + 4_000);
  await assert.rejects(refresh('bo-1'), (err) => err instanceof OAuthError && err.status === 503);
  assert.equal(calls.length, 1, 'a request 4 s later must not call the failing endpoint again');

  mock.timers.setTime(T0 + 6_000);
  await assert.rejects(refresh('bo-1'));
  assert.equal(calls.length, 2, 'past 5 s the next request retries');
});

test('an invalid_grant is forgotten at once', async () => {
  const calls = fakeHub(() => json(400, { error: 'invalid_grant' }));
  await assert.rejects(refresh('ig-1'), (err) => isDefiniteRejection(err));
  await assert.rejects(refresh('ig-1'), (err) => isDefiniteRejection(err));
  assert.equal(calls.length, 2);
});

// --- signing out forgets the session's refreshes ----------------------------

test('forgetRefreshesFor ends the reuse window of the session it is given', async () => {
  const calls = fakeHub(rotateTo((p) => `${p}-next`));
  await refresh('out-1');
  await refresh('out-1');
  assert.equal(calls.length, 1, 'positive control: the rotation is being reused');

  // The cookie being cleared holds the ROTATED refresh token.
  forgetRefreshesFor({ refresh_token: 'out-1-next' });
  await refresh('out-1');
  assert.equal(calls.length, 2, 'after sign-out the old cookie must not get the rotation back');
});

test('forgetRefreshesFor follows several rotations and leaves other sessions alone', async () => {
  const calls = fakeHub(rotateTo((p) => `${p}+`));
  await refresh('ch-a'); // ch-a  -> ch-a+
  await refresh('ch-a+'); // ch-a+ -> ch-a++
  await refresh('other'); // other -> other+
  assert.deepEqual(calls, ['ch-a', 'ch-a+', 'other']);

  forgetRefreshesFor({ refresh_token: 'ch-a++' });

  await refresh('other');
  assert.equal(calls.length, 3, 'an unrelated session must keep its reuse window');
  await refresh('ch-a');
  await refresh('ch-a+');
  assert.deepEqual(calls.slice(3), ['ch-a', 'ch-a+'], 'every link of the chain must be forgotten');
});

test('forgetRefreshesFor with a pre-rotation cookie forgets that rotation too', async () => {
  const calls = fakeHub(rotateTo((p) => `${p}-next`));
  await refresh('pre-1');
  forgetRefreshesFor({ refresh_token: 'pre-1' });
  await refresh('pre-1');
  assert.equal(calls.length, 2);
});

test('a refresh in flight at sign-out cannot be joined afterwards', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const calls = fakeHub(async (p) => {
    await gate;
    return rotateTo((x) => `${x}-next`)(p);
  });
  const first = refresh('fl-1');
  forgetRefreshesFor({ refresh_token: 'fl-1' });
  const second = refresh('fl-1');
  release();
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
});

test('forgetRefreshesFor ignores a session without a refresh token', () => {
  forgetRefreshesFor(null);
  forgetRefreshesFor(undefined);
  forgetRefreshesFor({});
  forgetRefreshesFor({ refresh_token: '' });
});

// --- the 1000-entry cap -----------------------------------------------------
// Last on purpose: it fills the process-wide map.

test('at most 1000 refresh tokens are remembered; the oldest goes first', async () => {
  // Far past every earlier test's window, so their entries are dead and swept.
  const T = T0 + 3_600_000;
  mock.timers.setTime(T);
  const calls = fakeHub(rotateTo((p) => `${p}-next`));
  for (let i = 0; i < 1000; i += 1) await refresh(`cap-${i}`);
  assert.equal(calls.length, 1000);

  // Positive control: all 1000 are still remembered.
  await refresh('cap-0');
  await refresh('cap-999');
  assert.equal(calls.length, 1000, 'the cap must hold 1000 entries, not fewer');

  // The 1001st pushes out the oldest.
  await refresh('cap-1000');
  assert.equal(calls.length, 1001);
  await refresh('cap-999');
  assert.equal(calls.length, 1001, 'a recent entry must survive');
  await refresh('cap-0');
  assert.equal(calls.length, 1002, 'the oldest entry must have been dropped');
});
