import { APICallError, RetryError } from 'ai';

/**
 * How long to wait before each automatic retry of one drop; its length is how many retries one drop
 * gets. The count starts again once a step finishes after a retry (the connection came back), so a
 * long reply that lives through several network changes recovers from each.
 *
 * Measured: one network change makes the browser drop connections twice, about 1 s apart, so a
 * retry within that second fails at once (a 500 ms retry failed 104 to 144 ms in). The first wait,
 * 1.5 s, is past that second drop; 4 s and 8 s cover a slower settle, 13.5 s in all.
 */
export const NETWORK_RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000, 8_000];

/**
 * The most automatic retries one reply makes in all, so a network that keeps dropping still ends the
 * reply. A long reply (75 steps over 10 to 15 minutes was measured) lives through two or three
 * network changes at one address change every five minutes, each needing one retry or, rarely, two.
 */
export const MAX_NETWORK_RETRIES_PER_REPLY = 10;

/** The longest a retry waits for a browser that reports itself offline to come back online. */
export const ONLINE_WAIT_MS = 15_000;

/**
 * What the browser's fetch says when it dropped a connection itself (the network went away or
 * changed, e.g. the client's address changed): Chromium (`Failed to fetch` for a request, `network
 * error` for a body being read), Firefox and Safari.
 */
const DROPPED = /^(failed to fetch|network error|networkerror when attempting to fetch resource\.?|load failed)$/i;

/**
 * Whether a reply failed only because the browser dropped its connection, so asking again can work.
 * Exactly two shapes count:
 * 1. a `TypeError` from fetch saying the connection was dropped (the request never got an answer, or
 *    the body being read was cut);
 * 2. the AI SDK's `Failed to process successful response` for a 2xx answer whose body could not be
 *    read *because of* such a drop (its `cause`).
 *
 * Anything else is not retried: a stop by the viewer (`AbortError`), a status the service sent (4xx,
 * auth, free replies used up, 5xx), a malformed answer, an error frame inside the stream.
 */
export function isNetworkDrop(error: unknown): boolean {
  const inner = RetryError.isInstance(error) ? error.lastError : error;
  if (droppedFetch(inner)) return true;
  if (!APICallError.isInstance(inner) || inner.message !== 'Failed to process successful response') return false;
  const status = inner.statusCode;
  if (status !== undefined && (status < 200 || status > 299)) return false;
  return droppedFetch(inner.cause) || (typeof inner.cause === 'string' && DROPPED.test(inner.cause));
}

function droppedFetch(error: unknown): boolean {
  // By name, not `instanceof`: a TypeError from another realm (an iframe's fetch) is still one.
  return error instanceof Error && error.name === 'TypeError' && DROPPED.test(error.message);
}

/**
 * Waits `ms`, then, if the browser says it is offline, until it says it is online again (at most
 * {@link ONLINE_WAIT_MS}). Resolves early, without throwing, when `signal` aborts.
 */
export async function pauseBeforeRetry(ms: number, signal: AbortSignal): Promise<void> {
  await abortable(ms, signal, () => undefined);
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  if (signal.aborted || nav?.onLine !== false || typeof globalThis.addEventListener !== 'function') return;
  await abortable(ONLINE_WAIT_MS, signal, (done) => {
    globalThis.addEventListener('online', done, { once: true });
    return () => globalThis.removeEventListener('online', done);
  });
}

/** Resolves after `ms`, on abort, or when `start`'s callback fires, whichever comes first. */
function abortable(ms: number, signal: AbortSignal, start: (done: () => void) => (() => void) | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    let stop: (() => void) | undefined;
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      stop?.();
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    stop = start(done);
  });
}
