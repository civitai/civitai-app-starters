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

export class BridgeError extends CivitaiError {
  readonly code: BridgeErrorCode;
  /** The message type that failed, e.g. `SAVE_IMAGE`. */
  readonly operation: string;

  constructor(code: BridgeErrorCode, operation: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BridgeError';
    this.code = code;
    this.operation = operation;
  }
}

/**
 * The messages this bridge already had report failure as the server's own
 * sentence — the host holds the tRPC code and drops it. Unmatched text is
 * `unavailable`; `message` still carries what the host said.
 */
const HOST_FAILURES: ReadonlyArray<readonly [RegExp, BridgeFailureCode]> = [
  [/authenticated viewer|no block token/i, 'unauthenticated'],
  [
    /(requires|lacks) .+ scope|not approved|revoked|invalid block token|not enabled|review preview|^banned$/i,
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
