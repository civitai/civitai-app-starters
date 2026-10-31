import { APICallError, RetryError } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saved } from '../store/thread-store.js';
import type { Turn } from '../types.js';
import { isNetworkDrop, ONLINE_WAIT_MS, pauseBeforeRetry } from './network-retry.js';

const apiError = (fields: Partial<ConstructorParameters<typeof APICallError>[0]>) =>
  new APICallError({ message: 'Failed to process successful response', url: 'https://x.example', requestBodyValues: {}, statusCode: 200, isRetryable: false, ...fields });

describe('isNetworkDrop', () => {
  it("is true for the browser's dropped connection: a fetch that failed, or a 200 body it cut", () => {
    for (const error of [
      new TypeError('Failed to fetch'),
      new TypeError('network error'),
      new TypeError('NetworkError when attempting to fetch resource.'),
      new TypeError('Load failed'),
      apiError({ cause: new TypeError('network error') }),
      apiError({ cause: new TypeError('Failed to fetch') }),
      apiError({ cause: 'network error' }),
      new RetryError({ message: 'gave up', reason: 'maxRetriesExceeded', errors: [new TypeError('Failed to fetch')] }),
    ]) {
      expect(isNetworkDrop(error), String(error)).toBe(true);
    }
  });

  it('is false for everything else', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    for (const error of [
      abort,
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      new TypeError('Failed to fetch dynamically imported module'),
      new Error('Failed to fetch'),
      Object.assign(new Error('Insufficient buzz'), { statusCode: 402 }),
      Object.assign(new Error('Free allowance used up until 2026-10-07T14:55:36Z'), { statusCode: 400 }),
      apiError({ message: 'Unauthorized', statusCode: 401 }),
      apiError({ message: 'Bad gateway', statusCode: 502 }),
      // A 200 body that could be read but was not what was expected.
      apiError({ cause: new SyntaxError('Unexpected token < in JSON at position 0') }),
      apiError({ cause: undefined }),
      // A status that is not a success cannot be a cut 200 body.
      apiError({ statusCode: 500, cause: new TypeError('network error') }),
      apiError({ message: 'Failed to process error response', statusCode: 503, cause: new TypeError('network error') }),
      { message: 'Chat completion failed', type: 'server_error' },
      'network error',
      undefined,
      null,
    ]) {
      expect(isNetworkDrop(error), String(error)).toBe(false);
    }
  });
});

describe('pauseBeforeRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits the delay, and returns at once when the reply is stopped', async () => {
    vi.useFakeTimers();
    let done = false;
    const controller = new AbortController();
    void pauseBeforeRetry(1_000, controller.signal).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    done = false;
    void pauseBeforeRetry(1_000, controller.signal).then(() => (done = true));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('then waits for an offline browser to come back online, for at most ONLINE_WAIT_MS', async () => {
    vi.useFakeTimers();
    const window = new EventTarget();
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('addEventListener', window.addEventListener.bind(window));
    vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window));

    let done = false;
    void pauseBeforeRetry(100, new AbortController().signal).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(done).toBe(false);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);

    done = false;
    void pauseBeforeRetry(100, new AbortController().signal).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100 + ONLINE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

describe("a reply's retries on record", () => {
  it('are kept for this session only, never saved with the chat', () => {
    const trace = { stage: 'request' as const, step: 2, msIntoStep: 5, name: 'TypeError', message: 'Failed to fetch' };
    const turn: Turn = {
      seq: 1,
      createdAt: '2026-10-16T00:00:00Z',
      user: { content: 'hi', attachments: [] },
      assistant: { messages: [], status: 'done', networkRetries: [trace] },
    };
    expect(saved(turn).assistant).toEqual({ messages: [], status: 'done' });
  });
});
