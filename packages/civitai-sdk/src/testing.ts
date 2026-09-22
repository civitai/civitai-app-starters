import { EMPTY_SNAPSHOT, type BlockSnapshot, type BlockTransport } from './core/transport.js';
import { BridgeError, type BridgeFailureCode } from './core/errors.js';

export { __resetTransport } from './core/get-transport.js';

export interface FakeTransport extends BlockTransport {
  /** Every request sent, in order. */
  readonly sent: { type: string; payload: unknown }[];
  /**
   * Answer every request of this type from its params. Throw from the handler
   * to fail the call. A queued `reply`/`fail` is used first, so one call can
   * depart from the standing answer.
   */
  handle(type: string, handler: (params: unknown) => unknown): void;
  /** Answer the next request of this type with the value it resolves to. */
  reply(type: string, result: unknown): void;
  /** Answer the next request of this type with a failure the host classified. */
  fail(type: string, error: { code: BridgeFailureCode; message: string }): void;
  /** Never answer requests of this type; for deadline and abort tests. */
  stall(type: string): void;
  /** Deliver an unsolicited host push to `on` subscribers. */
  push(type: string, payload: unknown): void;
  /** Subscribers to a push, so a test can assert one stopped listening. */
  listenerCount(type: string): number;
  setSnapshot(next: Partial<BlockSnapshot>): void;
}

/**
 * An in-memory `BlockTransport` for testing a service against a scripted host.
 * Replaces driving a full mock host through `postMessage` when the thing under
 * test is one operation.
 */
export function createFakeTransport(snapshot: Partial<BlockSnapshot> = {}): FakeTransport {
  let current: BlockSnapshot = {
    ...EMPTY_SNAPSHOT,
    ready: true,
    hostOrigin: 'https://civitai.com',
    ...snapshot,
  };
  const listeners = new Set<() => void>();
  const sent: { type: string; payload: unknown }[] = [];
  const queued = new Map<string, unknown[]>();
  const stalled = new Set<string>();
  const pending = new Map<string, ((payload: unknown) => void)[]>();
  const handlers = new Map<string, (params: unknown) => unknown>();
  const pushListeners = new Map<string, Set<(payload: unknown) => void>>();

  const emit = () => {
    for (const l of [...listeners]) l();
  };

  /** A queued answer is either the value or the failure the host reported. */
  const settle = (answer: unknown): Promise<never> =>
    answer instanceof BridgeError ? Promise.reject(answer) : (Promise.resolve(answer) as Promise<never>);

  const answer = (type: string, outcome: unknown) => {
    const waiting = pending.get(type);
    if (waiting?.length) {
      waiting.shift()!(outcome);
      return;
    }
    queued.set(type, [...(queued.get(type) ?? []), outcome]);
  };

  return {
    sent,
    snapshot: {
      get: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notify(message) {
      sent.push({ type: message.type, payload: (message as { payload?: unknown }).payload });
    },
    request(type: string, params: unknown, opts: { signal?: AbortSignal } = {}): Promise<never> {
      sent.push({ type, payload: params });
      const responseType = type;
      const { signal } = opts;
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (stalled.has(responseType)) {
        return new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      const ready = queued.get(responseType);
      if (ready?.length) return settle(ready.shift());
      const standing = handlers.get(responseType);
      if (standing) return (async () => standing(params))() as Promise<never>;
      return new Promise<never>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        const waiting = pending.get(responseType) ?? [];
        waiting.push((outcome) => {
          if (outcome instanceof BridgeError) reject(outcome);
          else resolve(outcome as never);
        });
        pending.set(responseType, waiting);
      });
    },
    on(type, handler) {
      const set = pushListeners.get(type) ?? new Set();
      set.add(handler);
      pushListeners.set(type, set);
      return () => set.delete(handler);
    },
    push(type, payload) {
      for (const handler of [...(pushListeners.get(type) ?? [])]) handler(payload);
    },
    listenerCount(type) {
      return pushListeners.get(type)?.size ?? 0;
    },
    handle(type, handler) {
      handlers.set(type, handler);
    },
    reply(type, result) {
      answer(type, result);
    },
    fail(type, error) {
      answer(type, new BridgeError(error.code, type, error.message));
    },
    stall(type) {
      stalled.add(type);
    },
    setSnapshot(next) {
      current = { ...current, ...next };
      emit();
    },
  };
}
