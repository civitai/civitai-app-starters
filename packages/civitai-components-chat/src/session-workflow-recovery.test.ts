import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSession } from './session.js';

/**
 * A reply step whose stream the network cut is asked for again (`network-retry.ts`). Asked for with a
 * new `POST /v1/chat/completions`, that starts and bills a second orchestration workflow for the same
 * step. Orchestration names each one in the `X-Civitai-Workflow-Id` header, so the page reads the
 * first one back (`GET /v2/consumer/workflows/{id}`) before asking again, and cancels one no one will
 * read (`PUT` with `{"status":"canceled"}`).
 *
 * Driven through the page's own path: `ChatSession` builds the model as `<civitai-chat>` does, and
 * every request goes out through the global fetch, faked here as orchestration.
 */

const ORCH = 'https://orchestration.civitai.com';
const CANCELED = JSON.stringify({ status: 'canceled' });

interface Script {
  /** Each reply POST in turn: its workflow id (none: an orchestration from before the header), and how its stream goes. */
  posts: { workflowId?: string; stream: 'cut' | 'hang' | { answer: string } }[];
  /** What each read of a workflow returns, in turn; the last one repeats. */
  reads?: Record<string, Record<string, unknown>[]>;
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-live', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;

const encoder = new TextEncoder();

/** A workflow as `GET /v2/consumer/workflows/{id}` returns it (v2 is camelCase; the message keeps OpenAI's names). */
const succeeded = (content: string) => ({
  status: 'succeeded',
  steps: [
    {
      $type: 'chatCompletion',
      name: '$0',
      status: 'succeeded',
      output: {
        id: 'chatcmpl-kept',
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content }, finishReason: 'stop' }],
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      },
    },
  ],
});
const withStatus = (status: string) => ({ status, steps: [{ $type: 'chatCompletion', name: '$0', status }] });

function fakeOrchestration(script: Script) {
  const posts = [...script.posts];
  const log: { method: string; url: string; body?: string }[] = [];
  const reads = new Map(Object.entries(script.reads ?? {}).map(([id, list]) => [id, [...list]]));
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    log.push({ method, url, ...(body !== undefined ? { body } : {}) });

    if (url.endsWith('/chat/completions')) {
      // The chat's title: asked for once, not streamed.
      if (!JSON.parse(body ?? '{}').stream) {
        return Response.json({ id: 'chatcmpl-title', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'Tides' }, finish_reason: 'stop' }] });
      }
      const next = posts.shift() ?? { stream: { answer: 'unscripted' } };
      const headers = new Headers({ 'Content-Type': 'text/event-stream' });
      if (next.workflowId) headers.set('X-Civitai-Workflow-Id', next.workflowId);
      const signal = init?.signal;
      const queue = [chunk({ role: 'assistant', content: 'High tide is at seve' })];
      if (typeof next.stream === 'object') queue.splice(0, 1, chunk({ role: 'assistant', content: next.stream.answer }), chunk({}, 'stop', { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), 'data: [DONE]\n\n');
      const mode = next.stream;
      const stream = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
          },
          pull(controller) {
            const part = queue.shift();
            if (part !== undefined) return controller.enqueue(encoder.encode(part));
            if (mode === 'cut') return controller.error(new TypeError('network error'));
            if (mode === 'hang') return new Promise<void>(() => undefined);
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(stream, { status: 200, headers });
    }

    const workflow = /\/v2\/consumer\/workflows\/([^/?]+)/.exec(url)?.[1];
    if (workflow && reads.has(workflow) && method === 'GET') {
      const list = reads.get(workflow)!;
      const read = list.length > 1 ? list.shift()! : list[0]!;
      return Response.json({ id: workflow, ...read });
    }
    // The chat's own saves (thread heads), the free-tier read: nothing to see here.
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });

  const replyPosts = () => log.filter((r) => r.method === 'POST' && r.url.endsWith('/chat/completions') && JSON.parse(r.body ?? '{}').stream);
  const reads_ = (id: string) => log.filter((r) => r.method === 'GET' && r.url.startsWith(`${ORCH}/v2/consumer/workflows/${id}`));
  const cancels = (id: string) => log.filter((r) => r.method === 'PUT' && r.url === `${ORCH}/v2/consumer/workflows/${id}` && r.body === CANCELED);
  const allCancels = () => log.filter((r) => r.method === 'PUT' && r.body === CANCELED);
  // Every chat workflow id here starts `wf-`; the chat's own saved heads do not.
  const allWorkflowReads = () => log.filter((r) => r.method === 'GET' && r.url.startsWith(`${ORCH}/v2/consumer/workflows/wf-`));
  return { fetch, log, replyPosts, reads: reads_, cancels, allCancels, allWorkflowReads };
}

function setup(script: Script) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const orchestration = fakeOrchestration(script);
  vi.stubGlobal('fetch', orchestration.fetch);
  const app = {
    getToken: async () => 'token',
    site: {},
    orchestration: {
      submitWorkflow: vi.fn(async () => ({ id: `7-${Math.random()}`, cost: { total: 0 } })),
      queryWorkflows: vi.fn(async () => ({ items: [], next: '' })),
    },
  } as never;
  const session = new ChatSession(app, { mcp: () => ({ orchestration: false, site: false }) });
  session.newConversation();

  /** Sends one message and runs the clock until the reply ends (at most `limitMs` of it). */
  async function send(text: string, limitMs = 400_000): Promise<void> {
    let settled = false;
    const done = session.send(text).finally(() => (settled = true));
    for (let ms = 0; !settled && ms < limitMs; ms += 250) await vi.advanceTimersByTimeAsync(250);
    await done;
  }
  const reply = () => session.store.current!.turns.at(-1)!.assistant;
  return { session, orchestration, send, reply };
}

describe("a reply step cut by the network keeps the step's orchestration workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads back the workflow the cut answer's X-Civitai-Workflow-Id header named", async () => {
    const { orchestration, send } = setup({
      posts: [{ workflowId: 'wf-cut-7c1e', stream: 'cut' }],
      reads: { 'wf-cut-7c1e': [succeeded('High tide is at 7:40, low at 13:55.')] },
    });
    await send('when is high tide?');
    expect(orchestration.reads('wf-cut-7c1e').length).toBeGreaterThan(0);
    // Only the named workflow: no other id was read.
    expect(orchestration.allWorkflowReads().every((read) => read.url.includes('/wf-cut-7c1e'))).toBe(true);
  });

  it('rebuilds the answer from a workflow that succeeded, with no second POST', async () => {
    const { orchestration, send, reply } = setup({
      posts: [{ workflowId: 'wf-done-3a91', stream: 'cut' }, { workflowId: 'wf-paid-again-6d04', stream: { answer: 'A second, paid answer.' } }],
      reads: { 'wf-done-3a91': [succeeded('High tide is at 7:40, low at 13:55.')] },
    });
    await send('when is high tide?');
    expect(orchestration.replyPosts()).toHaveLength(1);
    expect(reply().status).toBe('done');
    const kept = JSON.stringify(reply().messages);
    expect(kept).toContain('High tide is at 7:40, low at 13:55.');
    expect(kept).not.toContain('A second, paid answer.');
    expect(orchestration.allCancels()).toEqual([]);
  });

  it('waits for a workflow still running, then uses its answer, with no second POST', async () => {
    const { orchestration, send, reply } = setup({
      posts: [{ workflowId: 'wf-slow-4b8d', stream: 'cut' }, { workflowId: 'wf-paid-again-1e77', stream: { answer: 'A second, paid answer.' } }],
      reads: { 'wf-slow-4b8d': [withStatus('processing'), withStatus('processing'), succeeded('Low tide is at 13:55.')] },
    });
    await send('when is low tide?');
    expect(orchestration.reads('wf-slow-4b8d')).toHaveLength(3);
    expect(orchestration.replyPosts()).toHaveLength(1);
    expect(JSON.stringify(reply().messages)).toContain('Low tide is at 13:55.');
    expect(orchestration.allCancels()).toEqual([]);
  });

  it('asks again once the workflow failed, without canceling a workflow that is over', async () => {
    const { orchestration, send, reply } = setup({
      posts: [{ workflowId: 'wf-gone-2f6a', stream: 'cut' }, { workflowId: 'wf-fresh-8c35', stream: { answer: 'Asked again: 7:40.' } }],
      reads: { 'wf-gone-2f6a': [withStatus('failed')] },
    });
    await send('when is high tide?');
    const posts = orchestration.replyPosts();
    expect(posts).toHaveLength(2);
    // Read before the step was asked for again.
    const order = orchestration.log.indexOf(orchestration.reads('wf-gone-2f6a')[0]!);
    expect(order).toBeGreaterThan(-1);
    expect(order).toBeLessThan(orchestration.log.indexOf(posts[1]!));
    expect(orchestration.allCancels()).toEqual([]);
    expect(reply().status).toBe('done');
    expect(JSON.stringify(reply().messages)).toContain('Asked again: 7:40.');
  });

  it('cancels a workflow still running past the wait, then asks again', async () => {
    const { orchestration, send, reply } = setup({
      posts: [{ workflowId: 'wf-stuck-9d3b', stream: 'cut' }, { workflowId: 'wf-fresh-0a52', stream: { answer: 'Asked again: 7:40.' } }],
      reads: { 'wf-stuck-9d3b': [withStatus('processing')] },
    });
    await send('when is high tide?');
    const posts = orchestration.replyPosts();
    expect(posts).toHaveLength(2);
    const [cancel] = orchestration.cancels('wf-stuck-9d3b');
    expect(cancel).toBeDefined();
    // Canceled before the step was asked for again, so the two never run at once.
    expect(orchestration.log.indexOf(cancel!)).toBeLessThan(orchestration.log.indexOf(posts[1]!));
    expect(orchestration.allCancels()).toHaveLength(1);
    expect(reply().status).toBe('done');
  });

  it("cancels the step's workflow when the viewer stops the reply", async () => {
    const { session, orchestration } = setup({ posts: [{ workflowId: 'wf-stop-5e2c', stream: 'hang' }] });
    let settled = false;
    const done = session.send('when is high tide?').finally(() => (settled = true));
    for (let ms = 0; orchestration.replyPosts().length === 0 && ms < 10_000; ms += 50) await vi.advanceTimersByTimeAsync(50);
    // The answer has started: its first words are on screen.
    for (let ms = 0; !JSON.stringify(session.agent.live?.parts ?? []).includes('seve') && ms < 10_000; ms += 50) await vi.advanceTimersByTimeAsync(50);
    expect(JSON.stringify(session.agent.live?.parts)).toContain('High tide is at seve');
    session.agent.abort();
    for (let ms = 0; !settled && ms < 10_000; ms += 50) await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(orchestration.cancels('wf-stop-5e2c')).toHaveLength(1);
    expect(orchestration.allCancels()).toHaveLength(1);
  });

  it('asks again as before when the answer names no workflow (an orchestration without the header)', async () => {
    const { orchestration, send, reply } = setup({
      posts: [{ stream: 'cut' }, { stream: { answer: 'Asked again: 7:40.' } }],
    });
    await send('when is high tide?');
    expect(orchestration.replyPosts()).toHaveLength(2);
    expect(orchestration.allWorkflowReads()).toEqual([]);
    expect(orchestration.allCancels()).toEqual([]);
    expect(reply().status).toBe('done');
  });

  it('neither reads nor cancels the workflow of a step that finished', async () => {
    const { orchestration, send, reply } = setup({ posts: [{ workflowId: 'wf-whole-6f19', stream: { answer: 'High tide is at 7:40.' } }] });
    await send('when is high tide?');
    expect(reply().status).toBe('done');
    expect(orchestration.replyPosts()).toHaveLength(1);
    expect(orchestration.allWorkflowReads()).toEqual([]);
    expect(orchestration.allCancels()).toEqual([]);
  });
});
