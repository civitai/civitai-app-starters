import { getTransport } from './get-transport.js';
import type { BlockTransport, ReplyFraming } from './transport.js';

export interface CallOptions {
  transport?: BlockTransport;
  /**
   * Cancels the call. Request timeouts belong to the host, which owes a reply
   * to every request; this is the caller's own deadline, not a bound we impose.
   */
  signal?: AbortSignal;
}

/**
 * A domain's requests: name → what it takes and what it answers with. The same
 * shape the DOM uses for `WindowEventMap`, so a generic function can be typed
 * by the name it is given.
 */
export type RequestMap = Record<string, { params: unknown; result: unknown }>;

/** A domain's unsolicited messages: name → payload. */
export type PushMap = Record<string, unknown>;

export interface DomainOptions<R extends RequestMap> {
  /**
   * The messages the host still answers in its pre-protocol framing. Naming them
   * is the migration ledger: a name leaves this list the day the host modernises
   * that reply, and nothing else in the domain changes.
   */
  legacyReplies?: ReadonlyArray<keyof R & string>;
}

/**
 * The typed entry points for one domain. A domain declares its own maps and
 * calls these; nothing in `core` needs to know the domains exist.
 */
export function createCaller<R extends RequestMap>(domain: DomainOptions<R> = {}) {
  const legacy = new Set<string>(domain.legacyReplies ?? []);
  return async function call<K extends keyof R & string>(
    type: K,
    params: R[K]['params'],
    opts: CallOptions = {},
  ): Promise<R[K]['result']> {
    const transport = opts.transport ?? getTransport();
    const replies: ReplyFraming = legacy.has(type) ? 'legacy' : 'envelope';
    return (await transport.request(type, params, {
      signal: opts.signal,
      replies,
    })) as R[K]['result'];
  };
}

export function createListener<P extends PushMap>() {
  return function on<K extends keyof P & string>(
    transport: BlockTransport,
    type: K,
    handler: (payload: P[K]) => void,
  ): () => void {
    return transport.on(type, (payload) => handler(payload as P[K]));
  };
}
