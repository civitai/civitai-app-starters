import {
  runPaths,
  RUN_PROTOCOL_VERSION,
  type ConversationPatchRequest,
  type RunErrorResponse,
  type RunLookupResponse,
  type RunPageState,
  type RunSummary,
  type StartRunRequest,
  type StopRunByKeyRequest,
  type StartRunResponse,
} from '../runner-protocol.js';

/**
 * Where a remote reply runs (`runner: 'remote'`): a server that implements the run protocol
 * (`@civitai/components-chat/runner-protocol`).
 */
export interface ChatRemoteRunner {
  /** The runner's base URL; its paths (`runs`, …) are joined onto it. */
  url: string;
  /** Headers for every request to the runner, e.g. the page's auth; asked for before each request, so a renewed token applies at once. */
  headers?(): Record<string, string> | Promise<Record<string, string>>;
  /**
   * What the runner's tools and gate need to know about the page for one reply, e.g. the app open in
   * it; read as each reply starts. The page's own tool executors and `beforeToolCall` do not run in
   * remote mode: the runner holds the tools and the gate.
   */
  pageState?(): RunPageState | undefined;
  /** The fetch to use; the page's own unless set. */
  fetch?: typeof fetch;
  /**
   * The wait before each reconnect in a row to a run's events (and each retry of a start or Stop whose
   * answer never came); the last one repeats, for as long as the run is live. A start is asked again
   * only within `START_GIVE_UP_MS` (remote-agent.ts), so a first wait that long leaves it no retry at all.
   * {@link RECONNECT_DELAYS_MS} unless set.
   */
  reconnectDelaysMs?: readonly number[];
  /**
   * The longest a call waits for the runner's answer (for the event stream, for its headers), after
   * which it fails as unanswered and is asked again like a dropped one. {@link REQUEST_TIMEOUT_MS} unless set.
   */
  timeoutMs?: number;
}

/** How long a call to the runner waits for its answer. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Waits between reconnects in a row. The run carries on on the server whatever the page's network
 * does, so the page never gives up following it: it keeps trying at the last wait. A start that never
 * became a run is the exception: it is given up after `START_GIVE_UP_MS`, with Retry.
 */
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

/** A runner's answer that was not a success: its status and, when it sent one, its error body. */
export class RunnerHttpError extends Error {
  override name = 'RunnerHttpError';
  readonly status: number;
  readonly body: RunErrorResponse | undefined;

  constructor(status: number, body: RunErrorResponse | undefined) {
    super(body?.message || `The runner answered ${status}.`);
    this.status = status;
    this.body = body;
  }
}

/** The run protocol's calls, as the page makes them. */
export class RunnerClient {
  readonly options: ChatRemoteRunner;

  constructor(options: ChatRemoteRunner) {
    this.options = options;
  }

  url(path: string): string {
    const base = this.options.url.endsWith('/') ? this.options.url : `${this.options.url}/`;
    return new URL(path, new URL(base, (globalThis as { location?: { href?: string } }).location?.href)).toString();
  }

  async start(body: StartRunRequest, signal?: AbortSignal): Promise<StartRunResponse> {
    return (await this.#call(runPaths.start(), { method: 'POST', body: JSON.stringify(body) }, signal)) as StartRunResponse;
  }

  /** The conversation's live run, `null` when none runs. */
  async lookup(conversationId: string, signal?: AbortSignal): Promise<RunSummary | null> {
    return ((await this.#call(runPaths.lookup(conversationId), { method: 'GET' }, signal)) as RunLookupResponse | undefined)?.run ?? null;
  }

  async stop(runId: string, signal?: AbortSignal): Promise<void> {
    await this.#call(runPaths.stop(runId), { method: 'POST', body: JSON.stringify({ v: RUN_PROTOCOL_VERSION }) }, signal);
  }

  /** Stops the run a start with `idempotencyKey` started, known or not (`POST /runs/stop`). */
  async stopByKey(idempotencyKey: string, conversationId: string, signal?: AbortSignal): Promise<void> {
    const body: StopRunByKeyRequest = { v: RUN_PROTOCOL_VERSION, idempotencyKey, conversationId };
    await this.#call(runPaths.stopByKey(), { method: 'POST', body: JSON.stringify(body) }, signal);
  }

  async patch(conversationId: string, patch: Omit<ConversationPatchRequest, 'v'>, signal?: AbortSignal): Promise<void> {
    await this.#call(runPaths.patch(conversationId), { method: 'POST', body: JSON.stringify({ v: RUN_PROTOCOL_VERSION, ...patch }) }, signal);
  }

  /**
   * Opens a run's event stream after `lastEventId` (from its start without one). Resolves once the
   * answer's headers came, within the timeout; the stream then lasts until `signal` aborts.
   */
  async events(runId: string, lastEventId: string | undefined, signal: AbortSignal): Promise<Response> {
    const { response, done } = await this.#open(runPaths.events(runId), { method: 'GET', headers: { accept: 'text/event-stream', ...(lastEventId !== undefined ? { 'last-event-id': lastEventId } : {}) } }, signal, true);
    done();
    return response;
  }

  /** A call whose answer is read whole, within the timeout: its JSON, or `undefined` for an empty body. */
  async #call(path: string, init: RequestInit & { headers?: Record<string, string> }, signal?: AbortSignal): Promise<unknown> {
    const { response, done } = await this.#open(path, init, signal, false);
    try {
      const text = await response.text();
      return text ? (JSON.parse(text) as unknown) : undefined;
    } finally {
      done();
    }
  }

  /**
   * Sends a request that the timeout or `signal` aborts. `done` ends the timeout; for a stream
   * (`keepSignal`) `signal` still aborts the body after it, for anything else it lets go of `signal` too.
   */
  async #open(path: string, init: RequestInit & { headers?: Record<string, string> }, signal: AbortSignal | undefined, keepSignal: boolean): Promise<{ response: Response; done: () => void }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('The runner did not answer in time.', 'TimeoutError')), this.options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => {
      clearTimeout(timer);
      if (!keepSignal) signal?.removeEventListener('abort', onAbort);
    };
    try {
      const own = (await this.options.headers?.()) ?? {};
      const doFetch = this.options.fetch ?? fetch.bind(globalThis);
      const response = await doFetch(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers, ...own },
      });
      if (!response.ok) throw new RunnerHttpError(response.status, await errorBody(response));
      return { response, done };
    } catch (error) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      throw error;
    }
  }
}

/** Whether a call failed without an answer (dropped, or not answered in time), so asking again is worth it. */
export function unanswered(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
}

async function errorBody(response: Response): Promise<RunErrorResponse | undefined> {
  try {
    const body = (await response.json()) as Partial<RunErrorResponse> | null;
    return body && typeof body.error === 'string' ? (body as RunErrorResponse) : undefined;
  } catch {
    return undefined;
  }
}
