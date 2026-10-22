import { jsonSchema, tool, type ToolSet } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { AgentCore } from './core.js';
import { createAssistantModel } from './provider.js';
import { withoutTrailingSlashes, workflowRecoveryFetch, WORKFLOW_ID_HEADER } from './workflow-recovery.js';

/**
 * `workflowRecoveryFetch` on its own, and under `AgentCore` for a step whose answer was a tool call.
 * The page's path end to end (reuse, wait, cancel, Stop, no header) is `session-workflow-recovery.test.ts`.
 */

const BASE = 'https://orch.test';
const URL_ = `${BASE}/v1/chat/completions`;
const CANCELED = JSON.stringify({ status: 'canceled' });
const encoder = new TextEncoder();

/** An answer that sends its first words, then is cut by the network. */
function cutAnswer(workflowId: string): Response {
  let sent = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent) return controller.error(new TypeError('network error'));
        sent = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'c', choices: [{ index: 0, delta: { role: 'assistant', content: 'Sketching' }, finish_reason: null }] })}\n\n`));
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', [WORKFLOW_ID_HEADER]: workflowId } });
}

async function drain(response: Response): Promise<void> {
  await response.text().catch(() => undefined);
}

function harness(reads: (id: string) => Response | Promise<Response>) {
  const log: { method: string; url: string; body?: string }[] = [];
  const control = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    log.push({ method: init?.method ?? 'GET', url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (init?.method === 'PUT') return new Response('{}');
    return reads(decodeURIComponent(/workflows\/([^?]+)/.exec(url)![1]!));
  });
  const answers: Response[] = [];
  const inner = vi.fn(async () => answers.shift() ?? new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  const send = workflowRecoveryFetch(inner as typeof fetch, { baseUrl: BASE, control: control as typeof fetch, waitMs: 3_000, pollMs: 1_000 });
  return { send, inner, answers, log };
}

const post = (body: string, signal?: AbortSignal): RequestInit => ({ method: 'POST', body, ...(signal ? { signal } : {}) });

describe('workflowRecoveryFetch', () => {
  it('keeps the cut workflow when its read did not get through, and reads it again on the next try', async () => {
    let down = true;
    const { send, inner, answers, log } = harness(() => {
      if (down) throw new TypeError('Failed to fetch');
      return Response.json({ status: 'failed' });
    });
    answers.push(cutAnswer('wf-flaky-31c4'));
    await drain(await send(URL_, post('{"same":1}')));
    await expect(send(URL_, post('{"same":1}'))).rejects.toThrow('Failed to fetch');
    expect(inner).toHaveBeenCalledTimes(1);
    down = false;
    await drain(await send(URL_, post('{"same":1}')));
    expect(log.filter((r) => r.method === 'GET').map((r) => r.url.split('?')[0])).toEqual([`${BASE}/v2/consumer/workflows/wf-flaky-31c4`, `${BASE}/v2/consumer/workflows/wf-flaky-31c4`]);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('asks again, canceling nothing, when the workflow cannot be read (404) or succeeded with no answer', async () => {
    const reads: Record<string, Response> = {
      'wf-missing-58ae': new Response('', { status: 404 }),
      'wf-empty-0b7f': Response.json({ status: 'succeeded', steps: [{ $type: 'chatCompletion', status: 'succeeded' }] }),
    };
    const { send, inner, answers, log } = harness((id) => reads[id]!);
    answers.push(cutAnswer('wf-missing-58ae'));
    await drain(await send(URL_, post('{"a":1}')));
    await drain(await send(URL_, post('{"a":1}')));
    answers.push(cutAnswer('wf-empty-0b7f'));
    await drain(await send(URL_, post('{"b":2}')));
    await drain(await send(URL_, post('{"b":2}')));
    expect(inner).toHaveBeenCalledTimes(4);
    expect(log.filter((r) => r.method === 'GET')).toHaveLength(2);
    expect(log.filter((r) => r.body === CANCELED)).toEqual([]);
  });

  it('does not take a cut workflow for a different request', async () => {
    const { send, inner, answers, log } = harness(() => Response.json({ status: 'processing' }));
    answers.push(cutAnswer('wf-other-77d2'));
    await drain(await send(URL_, post('{"first":1}')));
    await drain(await send(URL_, post('{"second":2}')));
    expect(inner).toHaveBeenCalledTimes(2);
    expect(log).toEqual([]);
  });

  it('cancels a cut workflow when Stop comes before the step is asked for again', async () => {
    const stop = new AbortController();
    const { send, inner, answers, log } = harness(() => Response.json({ status: 'processing' }));
    answers.push(cutAnswer('wf-paused-1d3e'));
    await drain(await send(URL_, post('{"d":4}', stop.signal)));
    expect(log).toEqual([]);
    stop.abort();
    expect(log).toEqual([{ method: 'PUT', url: `${BASE}/v2/consumer/workflows/wf-paused-1d3e`, body: CANCELED }]);
    // Nothing left to reuse: the same request goes out as a new one.
    await drain(await send(URL_, post('{"d":4}')));
    expect(inner).toHaveBeenCalledTimes(2);
    expect(log.filter((r) => r.method === 'GET')).toEqual([]);
  });

  it('cancels the workflow when Stop comes while it is being waited for, and sends nothing', async () => {
    const stop = new AbortController();
    const { send, inner, answers, log } = harness(() => {
      queueMicrotask(() => stop.abort());
      return Response.json({ status: 'processing' });
    });
    answers.push(cutAnswer('wf-waiting-4c90'));
    await drain(await send(URL_, post('{"c":3}')));
    await expect(send(URL_, post('{"c":3}', stop.signal))).rejects.toBeDefined();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(log.filter((r) => r.method === 'PUT')).toEqual([{ method: 'PUT', url: `${BASE}/v2/consumer/workflows/wf-waiting-4c90`, body: CANCELED }]);
  });
});

describe('withoutTrailingSlashes', () => {
  it('takes off every trailing slash and nothing else', () => {
    expect(['https://o.test', 'https://o.test/', 'https://o.test/api///', '///', ''].map(withoutTrailingSlashes)).toEqual(['https://o.test', 'https://o.test', 'https://o.test/api', '', '']);
  });
});

describe('a cut step whose workflow answered with a tool call', () => {
  it('runs the call orchestration already wrote, once, with no second POST for the step', async () => {
    let posts = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) {
        posts++;
        if (posts === 1) return cutAnswer('wf-tool-6a1d');
        return new Response(
          `data: ${JSON.stringify({ id: 'c2', choices: [{ index: 0, delta: { role: 'assistant', content: 'Sketched the harbour.' }, finish_reason: null }] })}\n\n` +
            `data: ${JSON.stringify({ id: 'c2', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          { headers: { 'Content-Type': 'text/event-stream', [WORKFLOW_ID_HEADER]: 'wf-closing-2e58' } },
        );
      }
      if (url.includes('/v2/consumer/workflows/wf-tool-6a1d') && (init?.method ?? 'GET') === 'GET') {
        return Response.json({
          id: 'wf-tool-6a1d',
          status: 'succeeded',
          steps: [
            {
              $type: 'chatCompletion',
              output: {
                id: 'chatcmpl-tool',
                created: 1,
                model: 'm',
                choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_harbour_93', type: 'function', function: { name: 'sketch', arguments: '{"subject":"harbour at dusk"}' } }] }, finishReason: 'tool_calls' }],
                usage: { promptTokens: 5, completionTokens: 9, totalTokens: 14 },
              },
            },
          ],
        });
      }
      return new Response('{}');
    });
    const model = createAssistantModel({ getToken: async () => 'token' }, { baseUrl: 'https://orch.test', model: 'm', fetch: fetch as typeof globalThis.fetch, recoverWorkflows: true });
    const sketch = vi.fn(async ({ subject }: { subject: string }) => ({ sketched: subject }));
    const tools: ToolSet = { sketch: tool({ inputSchema: jsonSchema<{ subject: string }>({ type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'] }), execute: sketch }) };
    const core = new AgentCore();
    const outcome = await core.run({
      seq: 1,
      tools: async () => tools,
      request: () => ({ model, system: 's', history: [{ role: 'user', content: 'sketch the harbour' }], maxOutputTokens: 100, networkRetryDelaysMs: [0] }),
    });
    expect(outcome?.status).toBe('done');
    expect(sketch).toHaveBeenCalledTimes(1);
    expect(sketch.mock.calls[0]![0]).toEqual({ subject: 'harbour at dusk' });
    // The cut step's POST, then the next step's: never the cut step again.
    expect(posts).toBe(2);
    expect(JSON.stringify(outcome?.messages)).toContain('call_harbour_93');
    expect(JSON.stringify(outcome?.messages)).toContain('Sketched the harbour.');
  });
});
