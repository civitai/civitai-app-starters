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

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  /** The message type that failed, e.g. `APP_STORAGE_GET`. */
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
  [/authenticated viewer/i, 'unauthenticated'],
  [/requires the .+ scope|not approved|revoked|invalid block token|not enabled|review preview/i, 'forbidden'],
  [/quota exceeded|row limit exceeded|exceeds \d+KB cap/i, 'insufficient'],
  [/rate limit/i, 'rate-limited'],
];

export function classifyHostError(message: string): BridgeFailureCode {
  for (const [pattern, code] of HOST_FAILURES) if (pattern.test(message)) return code;
  return 'unavailable';
}
