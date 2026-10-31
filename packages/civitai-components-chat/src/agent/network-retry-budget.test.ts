import type { WorkflowTemplate } from '@civitai/sdk';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatConfig, configureChat } from '../config.js';
import { JobManager } from '../orchestration/jobs.js';
import { ThreadStore } from '../store/thread-store.js';
import { workflow } from '../test-support/fakes.js';
import { Agent } from './agent.js';

type StreamPart = Record<string, unknown>;

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** How long the model takes to answer one step; tools answer at once, so a reply is never off the wire for long. */
const STEP_MS = 10_000;
/**
 * One network change, as measured: the browser drops every connection, and again about 1 s later.
 * A connection open at the change is cut; a request sent before the second drop is over fails at once.
 */
const SETTLE_MS = 1_010;

/**
 * A long agentic reply (`toolSteps` tool steps, then a closing answer) over a network that changes at
 * each of `changes` (ms from the start), or is down for good from `downFrom`.
 */
function longReply({ toolSteps, changes = [], downFrom }: { toolSteps: number; changes?: number[]; downFrom?: number }) {
  const start = Date.now();
  const at = () => Date.now() - start;
  const unusable = () => (downFrom !== undefined && at() >= downFrom) || changes.some((change) => at() >= change && at() < change + SETTLE_MS);
  // Answers on the wire, each with the timer that would finish it.
  const open = new Map<ReadableStreamDefaultController<StreamPart>, ReturnType<typeof setTimeout>>();
  const cutAll = () => {
    for (const [stream, timer] of open) {
      clearTimeout(timer);
      stream.error(new TypeError('network error'));
    }
    open.clear();
  };
  for (const change of changes) setTimeout(cutAll, change);
  if (downFrom !== undefined) setTimeout(cutAll, downFrom);

  let answered = 0;
  const requests: number[] = [];
  const model = new MockLanguageModelV3({
    doStream: async () => {
      requests.push(at());
      if (unusable()) throw new TypeError('Failed to fetch');
      const index = answered;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stream = new ReadableStream<StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          timer = setTimeout(() => {
            open.delete(controller);
            answered = index + 1;
            if (index < toolSteps) {
              controller.enqueue({ type: 'tool-call', toolCallId: `call_${index}`, toolName: 'generate_image', input: JSON.stringify({ prompt: `step ${index}` }) });
              controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage });
            } else {
              controller.enqueue({ type: 'text-start', id: 't' });
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'All done.' });
              controller.enqueue({ type: 'text-end', id: 't' });
              controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
            }
            controller.close();
          }, STEP_MS);
          open.set(controller, timer);
        },
        cancel() {
          clearTimeout(timer);
          for (const [stream, t] of open) if (t === timer) open.delete(stream);
        },
      });
      return { stream: stream as never };
    },
    doGenerate: async () => ({ content: [{ type: 'text', text: 'Title' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
  });
  const store = new ThreadStore({
    orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
    api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
    hideMatureContent: () => true,
  });
  const generate = vi.fn(async ({ prompt }: { prompt: string }) => ({ job: `job-${prompt}`, status: 'running', note: 'Started.' }));
  const tools: ToolSet = {
    generate_image: tool({ inputSchema: jsonSchema<{ prompt: string }>({ type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] }), execute: generate }),
  };
  // The page's real waits and cap: these tests are about them.
  const agent = new Agent({ model: () => model, store, jobs: new JobManager({} as never), toolSet: async () => tools, attachments: () => [] });

  async function send(): Promise<void> {
    let settled = false;
    const done = agent.send('build the whole app').finally(() => (settled = true));
    for (let tick = 0; !settled && tick < 100_000; tick++) await vi.advanceTimersByTimeAsync(250);
    await done;
  }
  return { agent, store, generate, requests, send, turn: () => store.current!.turns[0]!.assistant };
}

describe('a long reply across several network changes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    configureChat({ maxSteps: 200 });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete chatConfig.maxSteps;
  });

  it('recovers from each of three changes, every tool running once', async () => {
    const reply = longReply({ toolSteps: 75, changes: [125_000, 425_000, 705_000] });
    await reply.send();
    const assistant = reply.turn();
    expect(assistant.status).toBe('done');
    expect(assistant.networkRetries).toHaveLength(3);
    expect(reply.generate).toHaveBeenCalledTimes(75);
    expect(new Set(reply.generate.mock.calls.map(([input]) => input.prompt)).size).toBe(75);
    expect(JSON.stringify(assistant.messages).match(/All done\./g)).toHaveLength(1);
  });

  it('waits out both drops of one change, so the change costs one retry, not two', async () => {
    const reply = longReply({ toolSteps: 5, changes: [25_000] });
    await reply.send();
    const assistant = reply.turn();
    expect(assistant.status).toBe('done');
    expect(assistant.networkRetries).toHaveLength(1);
    // No request went out while the change was still settling.
    expect(reply.requests.filter((time) => time >= 25_000 && time < 25_000 + SETTLE_MS)).toEqual([]);
  });

  it('ends a reply whose network stays down, after one drop’s retries', async () => {
    const reply = longReply({ toolSteps: 75, downFrom: 25_000 });
    await reply.send();
    const assistant = reply.turn();
    expect(assistant).toMatchObject({ status: 'error', errorKind: 'network' });
    expect(assistant.networkRetries).toHaveLength(3);
    expect(reply.generate).toHaveBeenCalledTimes(2);
  });

  it('ends a reply whose network keeps changing, after ten retries in all', async () => {
    // A change every 12 s: each cuts the step in flight, which then finishes on its first retry.
    const changes = Array.from({ length: 40 }, (_, i) => 15_000 + i * 12_000);
    const reply = longReply({ toolSteps: 75, changes });
    await reply.send();
    const assistant = reply.turn();
    expect(assistant).toMatchObject({ status: 'error', errorKind: 'network' });
    expect(assistant.networkRetries).toHaveLength(10);
    expect(reply.generate.mock.calls.length).toBeLessThan(75);
  });
});
