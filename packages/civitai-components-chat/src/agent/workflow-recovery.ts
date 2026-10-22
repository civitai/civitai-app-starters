/**
 * Each chat completion orchestration runs is a workflow, billed once it starts. A step whose stream
 * the browser's network cut is asked for again (`network-retry.ts`), and asking again with a new
 * `POST /v1/chat/completions` starts, and bills, a second workflow for the same step. This keeps the
 * first one: orchestration names it in the `X-Civitai-Workflow-Id` header of the POST's answer, and
 * when the same request is sent again after its stream was cut, the workflow is read back
 * (`GET /v2/consumer/workflows/{id}`) instead:
 * - it succeeded: its answer is rebuilt as the stream the POST would have sent, and nothing is POSTed;
 * - it is still running: it is waited for, at most {@link RECOVERY_WAIT_MS}, free or paid alike (sent
 *   again, a free request would only go free again and queue at the back);
 * - it failed, its answer cannot be rebuilt, or it outlived the wait: it is canceled when still
 *   running (`PUT /v2/consumer/workflows/{id}` with `{"status":"canceled"}`), and the request goes out
 *   as it would have.
 * An answer with no workflow id (an orchestration from before the header) is passed through as it is.
 *
 * A request given up on while its answer was still coming (the viewer's Stop) cancels its workflow
 * too, so the model stops working on an answer no one reads;
 * so does a stop that comes after a cut, before the step was asked for again (while waiting to retry).
 * A cut step that is never asked for again (the reply gave up: a tool had been called, or the retries
 * ran out) leaves its workflow to finish, as before.
 *
 * Orchestration's shapes (civitai-orchestration e13847bad1e1): the header is set once the workflow is
 * initialized, before the stream starts (ChatCompletionsController.cs:219); the workflow's `status` is
 * one of `WorkflowStatus` (camelCase on v2); the step is `$type: "chatCompletion"`, and its `output` is
 * the OpenAI chat completion (`choices[].message` with `content`, `reasoning_content` and `tool_calls`,
 * `choices[].finishReason`, `usage.promptTokens`), rebuilt from the stream once it completed
 * (ChatCompletionHandler.cs:676-740, 786-900). A rebuilt answer's closing usage carries the
 * workflow's `cost.total` as `usage.cost`, where the live stream carries what the call was charged
 * (`charge.ts` reads it), so a kept step's Buzz is still counted on the reply.
 */

/** The response header orchestration names a chat completion's workflow in. */
export const WORKFLOW_ID_HEADER = 'X-Civitai-Workflow-Id';

/**
 * The longest a cut step waits for its workflow to finish before canceling it and asking again: 10
 * minutes, the longest orchestration's own stream waits for a first chunk (`StreamFirstChunkTimeout`,
 * ChatCompletionsController.cs:51). A GET shows only the workflow's status, not whether tokens are still
 * coming, so a long answer still being written cannot be told from a stuck one before then; asking
 * again would start that answer over, and cost it again, rather than finish sooner.
 */
export const RECOVERY_WAIT_MS = 600_000;

/** How long one read of the workflow asks orchestration to hold it for a final status (its `wait`), in ms. */
export const RECOVERY_POLL_MS = 20_000;

/** How long a cut request's workflow is kept for a request sent again, and how many are kept at most. */
const KEEP_MS = 10 * 60_000;
const KEEP_MAX = 8;

const LIVE = new Set(['unassigned', 'preparing', 'scheduled', 'processing']);

export interface WorkflowRecoveryOptions {
  /** Orchestration's base URL (no trailing `/v1`). */
  baseUrl: string;
  /** Sends the workflow reads and cancels: signed as the chat requests are, with no free-tier or other wrapping. */
  control: typeof fetch;
  /** {@link RECOVERY_WAIT_MS} unless set. */
  waitMs?: number;
  /** {@link RECOVERY_POLL_MS} unless set. */
  pollMs?: number;
}

interface Cut {
  id: string;
  at: number;
}

/** The parts of a v2 workflow this reads (`GET /v2/consumer/workflows/{id}`). */
interface WorkflowRead {
  status?: string;
  steps?: { $type?: string; output?: ChatOutput | null }[];
  /** What the workflow cost, in Buzz. */
  cost?: { total?: number } | null;
}

interface ChatOutput {
  id?: string;
  created?: number;
  model?: string;
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[] | null;
    } | null;
    finishReason?: string | null;
  }[];
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; completionTokensDetails?: { reasoningTokens?: number | null } | null } | null;
}

/**
 * Wraps the fetch chat completions go out through (see the module's notes). Only a `POST` to
 * `…/chat/completions` with a string body is looked at; everything else passes through.
 */
export function workflowRecoveryFetch(inner: typeof fetch, options: WorkflowRecoveryOptions): typeof fetch {
  const base = withoutTrailingSlashes(options.baseUrl);
  const waitMs = options.waitMs ?? RECOVERY_WAIT_MS;
  const pollMs = options.pollMs ?? RECOVERY_POLL_MS;
  // Requests whose answer was cut, by what was sent: the same request sent again is the cut step asked for again.
  const cut = new Map<string, Cut>();

  const workflowUrl = (id: string) => `${base}/v2/consumer/workflows/${encodeURIComponent(id)}`;

  // Never fails: a cancel that did not get through leaves the workflow to finish, as before.
  const cancel = (id: string): Promise<unknown> =>
    options
      .control(workflowUrl(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'canceled' }) })
      .catch(() => undefined);

  const remember = (key: string, id: string) => {
    const now = Date.now();
    for (const [k, c] of cut) if (now - c.at > KEEP_MS) cut.delete(k);
    cut.delete(key);
    cut.set(key, { id, at: now });
    while (cut.size > KEEP_MAX) cut.delete(cut.keys().next().value!);
  };

  /** What the cut request's workflow gave: an answer to send instead, or `undefined` to ask again. Throws when the read could not be made (the network is still down) or `signal` aborted. */
  async function recover(id: string, signal: AbortSignal | undefined): Promise<Response | undefined> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const left = deadline - Date.now();
      const wait = Math.max(0, Math.min(Math.ceil(pollMs / 1000), Math.floor(left / 1000)));
      let response: Response;
      try {
        response = await options.control(`${workflowUrl(id)}${wait > 0 ? `?wait=${wait}` : ''}`, { method: 'GET', ...(signal ? { signal } : {}) });
      } catch (error) {
        if (signal?.aborted) void cancel(id);
        throw error;
      }
      // Not found, not ours, or orchestration failing: nothing known to rebuild or cancel.
      if (!response.ok) return undefined;
      const workflow = (await response.json().catch(() => null)) as WorkflowRead | null;
      const status = workflow?.status;
      if (status === 'succeeded') return replay(id, workflow!);
      // Failed, expired or canceled: over, and nothing to rebuild.
      if (!status || !LIVE.has(status)) return undefined;
      if (Date.now() >= deadline) {
        // Canceled before the step is asked for again, so the two never run at once.
        await cancel(id);
        return undefined;
      }
      // A short gap between reads, so an orchestration that answers at once (no `wait`) is not read in a tight loop.
      await pause(Math.min(1_000, deadline - Date.now()), signal);
      if (signal?.aborted) {
        void cancel(id);
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
    }
  }

  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST' || !/\/chat\/completions$/.test(url) || typeof body !== 'string') return inner(input, init);
    const key = `${url}\n${body}`;
    const signal = init?.signal ?? undefined;

    const earlier = cut.get(key);
    if (earlier && Date.now() - earlier.at <= KEEP_MS) {
      cut.delete(key);
      let recovered: Response | undefined;
      try {
        recovered = await recover(earlier.id, signal);
      } catch (error) {
        // The read did not get through: kept for the next time this step is asked for.
        if (!signal?.aborted) remember(key, earlier.id);
        throw error;
      }
      if (recovered) return recovered;
    }

    const response = await inner(input, init);
    const id = response.headers.get(WORKFLOW_ID_HEADER);
    if (!id || !response.body) return response;
    return track(response, id, signal, {
      dropped: () => {
        remember(key, id);
        // Stopped before the step was asked for again (while waiting to retry): nothing will read it.
        signal?.addEventListener(
          'abort',
          () => {
            if (cut.get(key)?.id !== id) return;
            cut.delete(key);
            void cancel(id);
          },
          { once: true },
        );
      },
      abandoned: () => void cancel(id),
    });
  };
}

/** The answer passed on as it comes, telling a cut (the network) from a stop (an abort, or the reader let go) before it completed. */
function track(response: Response, id: string, signal: AbortSignal | undefined, on: { dropped(): void; abandoned(): void }): Response {
  const reader = response.body!.getReader();
  let open = true;
  const stop = () => {
    if (!open) return;
    open = false;
    on.abandoned();
  };
  const end = () => {
    open = false;
    signal?.removeEventListener('abort', stop);
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch (error) {
        if (signal?.aborted) stop();
        else if (open) {
          end();
          on.dropped();
        }
        throw error;
      }
      if (next.done) {
        end();
        controller.close();
      } else controller.enqueue(next.value);
    },
    cancel(reason) {
      stop();
      signal?.removeEventListener('abort', stop);
      return reader.cancel(reason);
    },
  });
  const headers = new Headers(response.headers);
  headers.set(WORKFLOW_ID_HEADER, id);
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}

/** The succeeded workflow's answer as the stream `POST /v1/chat/completions` sends; `undefined` when it cannot be rebuilt. */
function replay(id: string, workflow: WorkflowRead): Response | undefined {
  const output = (workflow.steps ?? []).find((step) => step.$type === 'chatCompletion')?.output;
  const choice = output?.choices?.[0];
  const message = choice?.message;
  if (!output || !choice || !message) return undefined;
  const calls = message.tool_calls ?? [];
  // A call with no id or name cannot be run, nor answered; a call orchestration could not piece together reads that way.
  if (calls.some((call) => !call.id || !call.function?.name || typeof call.function.arguments !== 'string')) return undefined;

  const head = { id: output.id ?? id, object: 'chat.completion.chunk', created: output.created ?? Math.floor(Date.now() / 1000), model: output.model ?? '' };
  const delta: Record<string, unknown> = { role: 'assistant' };
  if (message.reasoning_content) delta.reasoning_content = message.reasoning_content;
  if (message.content) delta.content = message.content;
  if (calls.length) {
    delta.tool_calls = calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.function!.name, arguments: call.function!.arguments } }));
  }
  const cost = workflow.cost?.total;
  const charged = typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {};
  const usage =
    output.usage || 'cost' in charged
      ? {
          prompt_tokens: output.usage?.promptTokens ?? 0,
          completion_tokens: output.usage?.completionTokens ?? 0,
          total_tokens: output.usage?.totalTokens ?? 0,
          ...(output.usage?.completionTokensDetails?.reasoningTokens != null ? { completion_tokens_details: { reasoning_tokens: output.usage.completionTokensDetails.reasoningTokens } } : {}),
          ...charged,
        }
      : undefined;
  const finish = choice.finishReason ?? (calls.length ? 'tool_calls' : 'stop');
  const events = [
    { ...head, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...head, choices: [{ index: 0, delta: {}, finish_reason: finish }], ...(usage ? { usage } : {}) },
  ];
  const sse = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream', [WORKFLOW_ID_HEADER]: id } });
}

/** `url` with any trailing `/` taken off; a loop, not `/\/+$/`, which backtracks on a long run of slashes. */
export function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
