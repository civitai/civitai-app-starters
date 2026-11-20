/**
 * Session refresh: which failures end a session, and how concurrent refreshes
 * of one refresh token share a single call. Used only by `src/proxy.ts`.
 *
 * No `next/headers` and no `server-only` here, for the same reason as
 * `session-cookie.ts`: this is imported from the proxy.
 */
import { createHash } from 'node:crypto';
import { OAuthError, refreshToken as oauthRefresh, type OAuthTokens } from '@civitai/app-sdk';

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
 * on each request until the user signs in again (`getSession()` already treats
 * the render as signed out), never a lost session.
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

/** Bound on remembered refreshes, so the map cannot grow without limit. */
export const REFRESH_CACHE_MAX = 1_000;

interface Flight {
  promise: Promise<OAuthTokens>;
  /** `undefined` while the call is in flight; set once it succeeds. */
  doneAt?: number;
}

/**
 * Keyed by a SHA-256 of the refresh token, never the token itself, so the
 * map's keys are not credentials. Its VALUES are: a successful entry holds
 * the rotated tokens in memory for the grace window, which is the point of it.
 * Only a request carrying the old sealed cookie can reach them — but that is a
 * real trade: for {@link REFRESH_GRACE_MS} after a rotation, a COPY of the old
 * cookie still yields a working session, where strict rotation would have
 * refused it. That is the same trade a server-side replay grace period makes,
 * kept short for that reason.
 *
 * On `globalThis` so a module that is evaluated more than once in one process
 * (dev-mode recompiles) still shares one map.
 */
const flights: Map<string, Flight> = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('civitai-next-app.refresh-flights')
] ??= new Map<string, Flight>()) as Map<string, Flight>;

function keyFor(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

function isLive(flight: Flight, now: number): boolean {
  return flight.doneAt === undefined || now - flight.doneAt < REFRESH_GRACE_MS;
}

function makeRoom(now: number): void {
  for (const [key, flight] of flights) {
    if (!isLive(flight, now)) flights.delete(key);
  }
  // Still full: drop the oldest. Losing an entry costs only the dedupe for
  // that token, never correctness of the refresh itself.
  while (flights.size >= REFRESH_CACHE_MAX) {
    const oldest = flights.keys().next().value;
    if (oldest === undefined) break;
    flights.delete(oldest);
  }
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
 * the same refresh token shares ONE call to the token endpoint, and a success
 * is reused for {@link REFRESH_GRACE_MS}. A failure is forgotten at once, so
 * the next request makes a fresh attempt.
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
  if (existing && isLive(existing, now)) return existing.promise;
  if (existing) flights.delete(key);

  makeRoom(now);
  const flight: Flight = {
    promise: oauthRefresh(opts).then(
      (tokens) => {
        flight.doneAt = Date.now();
        return tokens;
      },
      (err: unknown) => {
        // Only remove OUR entry: a later caller may already have replaced it.
        if (flights.get(key) === flight) flights.delete(key);
        throw err;
      },
    ),
  };
  flights.set(key, flight);
  return flight.promise;
}
