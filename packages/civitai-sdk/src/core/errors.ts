/** Every failure the host classifies, so a caller branches on a code not a string. */
export type BridgeFailureCode =
  | 'forbidden'
  /** The host gave up waiting on something it called. */
  | 'timeout'
  | 'unauthenticated'
  | 'insufficient'
  | 'rate-limited'
  | 'unavailable'
  | 'invalid';

/** Every failure a service can surface, so a caller can branch without string matching. */
export type BridgeErrorCode =
  | BridgeFailureCode
  /** The transport got an answer it could not read as a result. */
  | 'malformed';

/** Anything this package throws on purpose, so one `catch` can tell it from a bug. */
export class CivitaiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CivitaiError';
  }
}

/**
 * Retry metadata the host attaches to a rate-limit refusal (Civitai's standard `rateLimit`), so a
 * caller renders the wait instead of parsing it out of the message.
 */
export interface RateLimitMeta {
  /** Whole seconds until the call may be tried again; at least 1. */
  retryAfterSeconds: number;
  /** ISO-8601 instant at which the call may be tried again. */
  retryAt: string;
  /** Stable id of the refusing limit, e.g. `apps.publish`. */
  id?: string;
  /**
   * `product`: an allowance the viewer may see and buy more of. `abuse`: an anti-flood or
   * money/safety bound. Informational: an abuse limit can carry counts too.
   */
  kind?: 'product' | 'abuse';
  /** The counts below are sent only for a limit that publishes them. */
  limit?: number;
  /** Attempts in the window; can exceed `limit`. */
  used?: number;
  remaining?: number;
  windowSeconds?: number;
  /** ISO-8601 instant at which the whole window is clear. */
  resetAt?: string;
}

const COUNT_FIELDS = ['limit', 'used', 'remaining', 'windowSeconds'] as const;

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * Reads a `rateLimit` the host sent: a copy holding only the known fields, or `undefined` when
 * `retryAfterSeconds` or `retryAt` is malformed. A malformed optional field is dropped on its own.
 */
export function parseRateLimitMeta(value: unknown): RateLimitMeta | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const { retryAfterSeconds, retryAt } = raw;
  if (typeof retryAfterSeconds !== 'number' || !Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1) {
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

export interface BridgeErrorOptions extends ErrorOptions {
  rateLimit?: RateLimitMeta;
}

export class BridgeError extends CivitaiError {
  readonly code: BridgeErrorCode;
  /** The message type that failed, e.g. `SAVE_IMAGE`. */
  readonly operation: string;
  /**
   * Set when the host refused the call under a rate limit and sent its retry metadata: which
   * limit, when to retry (`retryAfterSeconds`, `retryAt`) and, where the limit publishes them,
   * its counts. `code` is then `rate-limited`. Absent on an older host that does not send it.
   */
  // `declare`: no own property at all unless the host sent the meta.
  declare readonly rateLimit?: RateLimitMeta;

  constructor(code: BridgeErrorCode, operation: string, message: string, options?: BridgeErrorOptions) {
    const { rateLimit, ...errorOptions } = options ?? {};
    super(message, errorOptions);
    this.name = 'BridgeError';
    this.code = code;
    this.operation = operation;
    if (rateLimit) this.rateLimit = rateLimit;
  }
}

/**
 * The messages this bridge already had report failure as the server's own
 * sentence — the host holds the tRPC code and drops it. Unmatched text is
 * `unavailable`; `message` still carries what the host said.
 *
 * Procedures that need the viewer's signed-in session can refuse with a bare
 * `UNAUTHORIZED` (the session ended, e.g. signed out in another tab), which is
 * `unauthenticated`, or with "…belongs to a different account; reload the page
 * to continue" (the page's session changed account), which is `forbidden`:
 * signing in again does not help, reloading the page does.
 */
const HOST_FAILURES: ReadonlyArray<readonly [RegExp, BridgeFailureCode]> = [
  [/authenticated viewer|no block token/i, 'unauthenticated'],
  [/^UNAUTHORIZED$/, 'unauthenticated'],
  [
    /(requires|lacks) .+ scope|not approved|revoked|invalid block token|not enabled|review preview|belongs to a different account|^banned$/i,
    'forbidden',
  ],
  [/rate limit|^busy$/i, 'rate-limited'],
  // A few of the host's older replies carry a code of their own in `error`.
  [/^(forbidden|review-mode|declined)$/i, 'forbidden'],
  [/^sign-in-required$/i, 'unauthenticated'],
  [/^too-large$/i, 'insufficient'],
  [/^(not-found|parse-failed|invalid-request|collection-unavailable)$/i, 'invalid'],
];

export function classifyHostError(message: string): BridgeFailureCode {
  for (const [pattern, code] of HOST_FAILURES) if (pattern.test(message)) return code;
  return 'unavailable';
}
