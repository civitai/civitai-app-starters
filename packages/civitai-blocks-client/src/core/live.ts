import { getTransport } from './get-transport.js';
import type { CallOptions } from './messaging.js';
import type { BlockTransport } from './transport.js';

/**
 * A value many consumers read at once, shaped like the platform's own changing
 * values (`MediaQueryList`, `AbortSignal`): read the property, listen for
 * `change`, drop the listener with `AbortSignal` or `removeEventListener`.
 */
export interface Live<T> extends EventTarget, AsyncIterable<T> {
  /** `undefined` until the first load lands. Identity is stable between changes. */
  readonly value: T | undefined;
  /** The last load's failure. A `value` alongside it is the previous, stale one. */
  readonly error: unknown;
  readonly loading: boolean;
  /**
   * Reload, joining a load already in flight so N callers cost one round-trip.
   * Takes no signal: the load is shared, so one consumer's cancellation would
   * abandon every other.
   */
  refresh(): Promise<T>;
}

class LiveValue<T> extends EventTarget implements Live<T> {
  #load: (opts: CallOptions) => Promise<T>;
  #transport: BlockTransport;
  #value: T | undefined;
  #error: unknown;
  #loading = false;
  #inflight: Promise<T> | null = null;

  constructor(transport: BlockTransport, load: (opts: CallOptions) => Promise<T>) {
    super();
    this.#transport = transport;
    this.#load = load;
  }

  get value(): T | undefined {
    return this.#value;
  }

  get error(): unknown {
    return this.#error;
  }

  get loading(): boolean {
    return this.#loading;
  }

  refresh(): Promise<T> {
    if (this.#inflight) return this.#inflight;
    this.#loading = true;
    this.#announce();

    const load = this.#load({ transport: this.#transport });
    this.#inflight = load;
    load.then(
      (value) => this.#settle(value, undefined),
      (error) => this.#settle(this.#value, error),
    );
    return load;
  }

  /**
   * A host push carries the whole value, so it replaces the cache outright and
   * cancels nothing — an in-flight load that lands later is simply staler.
   */
  accept(value: T): void {
    this.#settle(value, undefined);
  }

  #settle(value: T | undefined, error: unknown): void {
    this.#inflight = null;
    this.#loading = false;
    this.#value = value;
    this.#error = error;
    this.#announce();
  }

  #announce(): void {
    this.dispatchEvent(new Event('change'));
  }

  /**
   * Each `for await` gets its own iteration from the current value. A busy
   * consumer resumes at the latest, and a failed load is read on `error`
   * rather than ending the loop.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    const done = new AbortController();
    let last: T | undefined;
    try {
      while (true) {
        const current = this.#value;
        // Re-read before waiting, or a change landing while the consumer was
        // busy would leave it blocked on the change after it.
        if (current !== undefined && current !== last) {
          last = current;
          yield current;
          continue;
        }
        await new Promise<void>((resolve) => {
          this.addEventListener('change', () => resolve(), { once: true, signal: done.signal });
        });
      }
    } finally {
      done.abort();
    }
  }
}

/** Feeds host pushes into the value; returns a disposer the cache never calls. */
export type LiveSource<T> = (transport: BlockTransport, accept: (value: T) => void) => () => void;

/**
 * One `Live` per transport, loaded on creation, so every consumer in a block
 * shares a value while a test's fake transport gets its own and needs no reset.
 */
export function sharedLive<T>(
  cache: WeakMap<BlockTransport, Live<T>>,
  opts: CallOptions,
  load: (opts: CallOptions) => Promise<T>,
  source?: LiveSource<T>,
): Live<T> {
  const transport = opts.transport ?? getTransport();
  const cached = cache.get(transport);
  if (cached) return cached;

  const live = new LiveValue(transport, load);
  cache.set(transport, live);
  source?.(transport, (value) => live.accept(value));
  live.refresh().catch(() => {});
  return live;
}
