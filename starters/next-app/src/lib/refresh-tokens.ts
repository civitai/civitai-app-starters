/**
 * Session refresh: which failures end a session, how concurrent refreshes of
 * one refresh token share a single call, and how signing out forgets them.
 *
 * 🔴 THE SAME FILE IN EVERY STANDALONE STARTER. next-app, sveltekit-app,
 * react-pwa and svelte-pwa each carry a byte-identical copy (a starter is
 * copied out on its own by `npx tiged`, so it cannot import a sibling), and
 * the repo guard `tests/guards/starter-shared-modules-parity.test.mjs` fails
 * when one copy changes alone. Its only imports are `node:crypto` and
 * `@civitai/app-sdk`: no framework, no `server-only`, no env, so it runs in a
 * Next.js proxy, a SvelteKit hook, a Hono route and under plain `node --test`.
 * Each starter's `AGENTS.md` names the file that calls it.
 */
import { createHash } from 'node:crypto';
import {
  OAuthError,
  refreshToken as oauthRefresh,
  revokeToken,
  type OAuthTokens,
} from '@civitai/app-sdk';

/**
 * 🔴 THE ONE PREDICATE FOR "THIS CREDENTIAL IS DEAD". Only this clears the
 * session cookie.
 *
 * `refreshToken()` throws an `OAuthError` carrying the HTTP status and the
 * parsed body on any non-2xx answer, and something else (a `TypeError` from
 * `fetch`) when there was no answer at all. Exactly ONE answer is a verdict on
 * the user's refresh token: an RFC 6749 §5.2 error body whose `error` is
 * `invalid_grant` — Civitai's documented answer for a refresh token that is
 * unknown, expired, revoked or already spent.
 *
 * Everything else leaves the cookie alone and the next request tries again:
 *
 * - a 5xx, a 429, a timeout, a reset connection — the auth service could not
 *   answer RIGHT NOW. Clearing on those turned a blip into a forced sign-in
 *   (#855);
 * - `invalid_client` (400 or 401) — the APP's client id or secret was refused.
 *   That is a deploy fault, not the user's, and it fails for every user at
 *   once; clearing would throw away every still-valid refresh token for good,
 *   even after the secret is fixed;
 * - any other error body — `invalid_request` and the like are bugs in the
 *   request, which no amount of signing the user out fixes.
 *
 * The cost of being wrong in this direction is a dead cookie that is retried
 * on each request until the user signs in again (the session reader already
 * treats that request as signed out), never a lost session.

 */
export function isDefiniteRejection(err: unknown): boolean {
  if (!(err instanceof OAuthError)) return false;
  const body = err.body;
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: unknown }).error === 'invalid_grant'
  );
}

/**
 * How long a SUCCESSFUL refresh is kept, so a request that arrives with the
 * OLD cookie just after the rotation (a second tab, a request the browser sent
 * before the new `Set-Cookie` landed) gets the rotated tokens instead of
 * replaying a refresh token the server has already spent.
 */
export const REFRESH_GRACE_MS = 60_000;

/**
 * How long a failure that KEEPS the cookie is remembered for that refresh
 * token. Requests inside the window get the same failure without calling the
 * token endpoint. Civitai rate-limits that endpoint per client, so retrying on
 * every request while it is failing would keep it failing. This bounds each
 * session to one attempt per window; it does not bound the app's total.
 */
export const REFRESH_RETRY_BACKOFF_MS = 5_000;

/**
 * The longest one request waits for a refresh. The SDK call has no timeout of
 * its own, so a token endpoint that accepts the connection and never answers
 * would otherwise hold the request for as long as `fetch` itself waits
 * (minutes). Past this, the request carries on as a failure that keeps the
 * cookie.
 */
export const REFRESH_WAIT_MS = 10_000;

/** Bound on remembered refreshes, so the map cannot grow without limit. */
export const REFRESH_CACHE_MAX = 1_000;

interface Flight {
  promise: Promise<OAuthTokens>;
  /** Set once the call succeeds. */
  doneAt?: number;
  /** Set once the call succeeds: the key of the refresh token it returned. */
  resultKey?: string;
  /** Set once the call fails with an error that keeps the cookie. */
  failedAt?: number;
  /**
   * Set when the session was REVOKED while this was remembered
   * (forgetRefreshesFor with `revokeOrphans`): if the call then succeeds, the
   * refresh token it returns is revoked upstream.
   */
  revokeIfSucceeds?: boolean;
  /**
   * Rejects with a {@link SessionEndedError} the moment the session signs out
   * (`end`), and never settles otherwise. Every caller races it against
   * `promise`, so a sign-out releases its waiters at once, not when the call
   * settles: a hung call would otherwise hold them for {@link REFRESH_WAIT_MS}
   * and then report a timeout.
   */
  endedSignal: Promise<never>;
  end: () => void;
}

/**
 * What a caller sees when its session signed out ({@link forgetRefreshesFor})
 * while it was waiting on the refresh, whatever the refresh itself returned.
 *
 * Deliberately NOT a {@link isDefiniteRejection}: the caller treats it like a
 * transient failure, so that request is signed out and its response leaves
 * the browser's cookie alone. The sign-out response already cleared it, and a
 * clearing `Set-Cookie` from this request, which can land after the sign-out's
 * own response, would wipe a session the user had signed in to again in the
 * meantime. The caller should not log it as a failed refresh either: nothing
 * is retried, the session is simply over.
 */
export class SessionEndedError extends Error {
  override readonly name = 'SessionEndedError';
  constructor() {
    super('the session signed out while this request was waiting on its refresh');
  }
}

/** What a caller sees when the refresh outlives {@link REFRESH_WAIT_MS}. */
export class RefreshWaitTimeoutError extends Error {
  override readonly name = 'RefreshWaitTimeoutError';
  constructor(ms: number) {
    super(`session refresh did not answer within ${ms} ms`);
  }
}

/**
 * Keyed by a SHA-256 of the refresh token, never the token itself, so the
 * map's keys are not credentials. Its VALUES are: a successful entry holds
 * the rotated tokens in memory for the grace window, which is the point of it.
 * Only a request carrying the old sealed cookie can reach them — but that is a
 * real trade: for {@link REFRESH_GRACE_MS} after a rotation, a COPY of the old
 * cookie still yields a working session, where strict rotation would have
 * refused it. That is the same trade a server-side replay grace period makes,
 * kept short for that reason, and signing out ends it at once
 * ({@link forgetRefreshesFor}).
 *
 * On `globalThis` so a module that is evaluated more than once in one process
 * (dev-mode recompiles) still shares one map.
 */
const flights: Map<string, Flight> = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('civitai-app-starters.refresh-flights')
] ??= new Map<string, Flight>()) as Map<string, Flight>;

function keyFor(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

function isLive(flight: Flight, now: number): boolean {
  if (flight.doneAt !== undefined) return now - flight.doneAt < REFRESH_GRACE_MS;
  if (flight.failedAt !== undefined) return now - flight.failedAt < REFRESH_RETRY_BACKOFF_MS;
  return true; // still in flight
}

/**
 * Drop every entry that is no longer live, then say whether there is room for
 * one more.
 *
 * 🔴 A LIVE ENTRY IS NEVER EVICTED. Dropping one is not just a lost dedupe:
 * an entry inside its grace window is what answers a straggler holding the
 * pre-rotation cookie, so evicting it sends that spent refresh token back to
 * the hub, which answers `invalid_grant`, and the starter then clears the
 * browser's cookie: the #804 sign-out, back under load. So when the map is full
 * of live entries the new refresh is simply not remembered (see
 * {@link refreshTokensOnce}).
 */
function makeRoom(now: number): boolean {
  for (const [key, flight] of flights) {
    if (!isLive(flight, now)) flights.delete(key);
  }
  return flights.size < REFRESH_CACHE_MAX;
}

/**
 * What one caller of a remembered refresh gets: its answer, or a
 * {@link SessionEndedError} as soon as the session signs out, whichever comes
 * first. A caller that joined before the sign-out is covered too, and it is not
 * kept waiting for a call that is still in flight.
 */
function answerOf(flight: Flight): Promise<OAuthTokens> {
  return Promise.race([flight.promise, flight.endedSignal]);
}

/**
 * Revoke the refresh token a call returned AFTER its session was revoked. No
 * caller was handed it (each got a {@link SessionEndedError}) and the map no
 * longer holds it, while the revoke route revoked only the refresh token the
 * cookie held, which this call had already spent. Without this the disconnect
 * would leave a live refresh token behind. Best effort: the answer is not
 * awaited and a failure is ignored.
 */
function revokeOrphan(opts: RefreshOpts, tokens: OAuthTokens): void {
  if (!tokens.refresh_token) return;
  revokeToken({
    baseUrl: opts.baseUrl,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    token: tokens.refresh_token,
  }).catch(() => {});
}

/** `promise`, or a {@link RefreshWaitTimeoutError} after `ms` — whichever is first. */
function waitAtMost<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RefreshWaitTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface RefreshOpts {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  fallbackScope?: number;
}

/**
 * `refreshToken()` with single-flight (#804): every concurrent caller holding
 * the same refresh token shares ONE call to the token endpoint.
 *
 * - A success is reused for {@link REFRESH_GRACE_MS}, until the session it
 *   produced signs out ({@link forgetRefreshesFor}).
 * - A failure that keeps the cookie (see {@link isDefiniteRejection}) is
 *   reused for {@link REFRESH_RETRY_BACKOFF_MS}, then the next request makes a
 *   fresh attempt. An `invalid_grant` is forgotten at once; the cookie is
 *   cleared anyway.
 * - Each CALLER waits at most {@link REFRESH_WAIT_MS}. The call itself is NOT
 *   abandoned and NOT retried while it is still in flight: with rotation, a
 *   second call with the same refresh token while the first may still succeed
 *   is exactly the race this exists to prevent. If the slow call succeeds, its
 *   tokens land in the grace window for the next request.
 * - At most {@link REFRESH_CACHE_MAX} refresh tokens are remembered. Expired
 *   entries make room; a live one is never evicted, so while the map is full
 *   of live entries a new refresh goes straight to the token endpoint and is
 *   not remembered (no dedupe for that token, nothing else lost). Such a
 *   refresh is also out of reach of {@link forgetRefreshesFor}: a sign-out
 *   cannot end it, and its caller gets its tokens.
 * - A caller whose session signs out while it waits gets a
 *   {@link SessionEndedError} at once, never the tokens (see
 *   {@link forgetRefreshesFor}). If the sign-out was a revoke and the call
 *   then succeeds, the refresh token it returned is revoked upstream.
 *
 * 🔴 IN-PROCESS ONLY. This dedupes requests that reach the SAME server
 * process. Two processes or instances (serverless functions, several
 * containers behind a load balancer) each keep their own map, and can still
 * race on a rotating refresh token. Closing that needs either a shared store
 * (e.g. Redis) for the in-flight refresh, or a replay grace period on the
 * authorization server. Not handled here.
 */
export function refreshTokensOnce(opts: RefreshOpts): Promise<OAuthTokens> {
  const key = keyFor(opts.refreshToken);
  const now = Date.now();
  const existing = flights.get(key);
  if (existing && isLive(existing, now)) return waitAtMost(answerOf(existing), REFRESH_WAIT_MS);
  if (existing) flights.delete(key);

  if (!makeRoom(now)) {
    const direct = oauthRefresh(opts);
    direct.catch(() => {});
    return waitAtMost(direct, REFRESH_WAIT_MS);
  }
  let end!: () => void;
  const endedSignal = new Promise<never>((_, reject) => {
    end = () => reject(new SessionEndedError());
  });
  // Rejected only once the session ends, and only callers that are still
  // waiting observe it; never report it as unhandled.
  endedSignal.catch(() => {});
  const flight: Flight = {
    endedSignal,
    end,
    promise: oauthRefresh(opts).then(
      (tokens) => {
        if (flight.revokeIfSucceeds) revokeOrphan(opts, tokens);
        flight.doneAt = Date.now();
        if (tokens.refresh_token) flight.resultKey = keyFor(tokens.refresh_token);
        return tokens;
      },
      (err: unknown) => {
        if (isDefiniteRejection(err)) {
          // Only remove OUR entry: a later caller may already have replaced it.
          if (flights.get(key) === flight) flights.delete(key);
        } else {
          flight.failedAt = Date.now();
        }
        throw err;
      },
    ),
  };
  // Every caller may have stopped waiting by the time this settles; the
  // rejection is still observed, so it is never reported as unhandled.
  flight.promise.catch(() => {});
  flights.set(key, flight);
  return waitAtMost(answerOf(flight), REFRESH_WAIT_MS);
}

/**
 * Forget every remembered refresh that belongs to this session. Call it when
 * the session ends (sign-out, revoke), BEFORE clearing the cookie.
 *
 * Without it, signing out left the grace window open: the entry keyed by the
 * PREVIOUS refresh token still held this session's tokens, so for up to
 * {@link REFRESH_GRACE_MS} a request carrying the pre-rotation cookie (another
 * tab, a copy of it) was handed a working session again after the user had
 * signed out.
 *
 * The cookie being cleared holds the NEWEST refresh token, while that entry is
 * keyed by an OLDER one, so this follows the chain: an entry goes when its own
 * key or the key of the refresh token it returned is one already forgotten,
 * repeated until nothing changes. That covers several rotations inside one
 * window, and a sign-out that arrives with a pre-rotation cookie. Unrelated
 * sessions are untouched. An in-flight refresh of this session is dropped from
 * the map, so no later request can join it, and callers already waiting on it
 * get a {@link SessionEndedError} at once instead of its answer: otherwise a
 * request another tab sent just before the sign-out would set the refreshed
 * session cookie after it, signing the browser back in. That request is signed
 * out and writes no cookie at all.
 *
 * `revokeOrphans` is for the REVOKE route only. With it, a dropped call that
 * still succeeds has the refresh token it returns revoked upstream: nothing
 * holds that token, and the revoke route's own revoke reached only the spent
 * one. A plain sign-out must not pass it. Signing out locally leaves the
 * stored refresh token live by design, and Civitai's revoke of a refresh
 * token also deletes every access token the user holds for this app, so a
 * sign-out that raced a refresh would sign the user out on every device.
 */
export function forgetRefreshesFor(
  tokens: { refresh_token?: string | null } | null | undefined,
  { revokeOrphans = false }: { revokeOrphans?: boolean } = {},
): void {
  const refreshToken = tokens?.refresh_token;
  if (!refreshToken) return;
  const gone = new Set([keyFor(refreshToken)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, flight] of flights) {
      if (gone.has(key) || (flight.resultKey !== undefined && gone.has(flight.resultKey))) {
        if (revokeOrphans) flight.revokeIfSucceeds = true;
        flight.end();
        flights.delete(key);
        gone.add(key);
        if (flight.resultKey !== undefined) gone.add(flight.resultKey);
        changed = true;
      }
    }
  }
}
