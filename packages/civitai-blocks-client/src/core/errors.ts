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
  /** The message type that failed, e.g. `GET_BUZZ_BALANCE`. */
  readonly operation: string;

  constructor(code: BridgeErrorCode, operation: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BridgeError';
    this.code = code;
    this.operation = operation;
  }
}

