/**
 * The host's rate-limit retry metadata (`rateLimit`), read off a bridge reply and carried on the
 * error a hook throws — so an app can show when to retry instead of parsing a message.
 *
 * The host sends it on a refused call's error reply (`{ requestId, error, rateLimit }`), and on a
 * workflow snapshot (`snapshot.rateLimit`) for estimate / submit / poll / cancel, which report a
 * refusal inside the snapshot. A host that predates it sends neither, and every error here is then
 * exactly what it was before: same class, same `message`, no `rateLimit` property at all.
 *
 * The TYPE is app-sdk's (`import type`, erased at runtime), so it never raises the peer floor's
 * value-symbol count; the parser is restated here because a value import would.
 */

import type { RateLimitMeta } from '@civitai/app-sdk/blocks';

export type { RateLimitMeta };

const COUNT_FIELDS = ['limit', 'used', 'remaining', 'windowSeconds'] as const;

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * A copy of `value` holding only the known fields, or `undefined` when it is not an object or its
 * `retryAfterSeconds` (a whole number, at least 1) or `retryAt` (an ISO instant) is malformed. A
 * malformed optional field is dropped on its own. The host's own parser, restated.
 */
export function parseRateLimitMeta(value: unknown): RateLimitMeta | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const { retryAfterSeconds, retryAt } = raw;
  if (
    typeof retryAfterSeconds !== 'number' ||
    !Number.isInteger(retryAfterSeconds) ||
    retryAfterSeconds < 1
  ) {
    return undefined;
  }
  if (!isInstant(retryAt)) return undefined;
  const meta: RateLimitMeta = { retryAfterSeconds, retryAt };
  if (typeof raw.id === 'string' && raw.id) meta.id = raw.id;
  if (raw.kind === 'product' || raw.kind === 'abuse') meta.kind = raw.kind;
  for (const field of COUNT_FIELDS) {
    const count = raw[field];
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) meta[field] = count;
  }
  if (isInstant(raw.resetAt)) meta.resetAt = raw.resetAt;
  return meta;
}

/**
 * `error`, with the `rateLimit` that `source` (a reply payload or a snapshot) carries set on it as
 * an own property. Returns the SAME error, so `instanceof`, `name` and `message` are untouched;
 * when `source` carries no valid meta nothing is added.
 *
 * The one place a hook turns a refused reply into a throw keeps the meta — call it at every such
 * site rather than open-coding the read.
 */
export function withRateLimit<E extends Error>(error: E, source: unknown): E {
  const rateLimit =
    source && typeof source === 'object'
      ? parseRateLimitMeta((source as { rateLimit?: unknown }).rateLimit)
      : undefined;
  if (rateLimit) (error as E & { rateLimit?: RateLimitMeta }).rateLimit = rateLimit;
  return error;
}

/**
 * The rate-limit retry metadata on an error a hook threw (or set as its `error`), or `undefined`
 * when the refusal was not a rate limit — or the host predates the field.
 *
 * Reads `err.rateLimit`, so it also answers for `@civitai/sdk`'s `BridgeError`. Prefer it to
 * reading the property directly: the error classes of most hooks do not declare the field.
 *
 * ```ts
 * try { await submit(body); } catch (err) {
 *   const limit = rateLimitOf(err);
 *   if (limit) showRetryAt(limit.retryAt);
 * }
 * ```
 */
export function rateLimitOf(err: unknown): RateLimitMeta | undefined {
  if (!err || typeof err !== 'object') return undefined;
  return parseRateLimitMeta((err as { rateLimit?: unknown }).rateLimit);
}
