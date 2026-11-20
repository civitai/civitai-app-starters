import type { WorkflowTemplate } from '@civitai/sdk';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { JobManager } from '../orchestration/jobs.js';
import { ThreadStore } from '../store/thread-store.js';
import { workflow } from '../test-support/fakes.js';
import { gateToolSet, type ChatToolGate } from '../tools/gate.js';
import { Agent } from './agent.js';

/**
 * Agent over AgentCore: how a reply ended reaches the turn as it was when it ended. The cut step's
 * words are kept for the viewer, but the resume point holds only the finished steps, so Retry never
 * sends those words to the model as a step that finished.
 */

type StreamPart = Record<string, unknown>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const toolCall: StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: 'call_tide', toolName: 'tide', input: '{}' },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];
const text = (words: string): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: words },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
/** A step that streams some words, then dies with an error that is not a dropped connection. */
const cutMidWords = () => {
  const queue: StreamPart[] = [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'High tide is at seve' }];
  return new ReadableStream<StreamPart>({ pull: (c) => (queue.length ? c.enqueue(queue.shift()!) : c.error(new Error('upstream broke'))) }, { highWaterMark: 0 });
};

describe('Agent over AgentCore', () => {
  it("keeps the cut step's words on the turn but out of its resume point, so Retry does not send them as a finished step", async () => {
    const answers: (StreamPart[] | (() => ReadableStream<StreamPart>))[] = [toolCall, cutMidWords, text('High tide is at 7:40.')];
    const prompts: string[] = [];
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        const next = answers.shift()!;
        return { stream: (typeof next === 'function' ? next() : convertArrayToReadableStream(next)) as never };
      },
    });
    const tide = vi.fn(async () => ({ high: '07:40' }));
    const tools: ToolSet = { tide: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: tide }) };
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '9-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const agent = new Agent({ model: () => model, store, jobs: new JobManager({} as never), toolSet: async () => tools, attachments: () => [] });
    agent.addEventListener('error', () => undefined);

    await agent.send('when is high tide?');
    const turn = store.current!.turns[0]!;
    expect(turn.assistant.status).toBe('error');
    expect(turn.assistant.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(turn.assistant.messages.at(-1)).toEqual({ role: 'assistant', content: 'High tide is at seve' });
    expect(turn.assistant.resume?.steps).toBe(1);
    expect(turn.assistant.resume?.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);

    await agent.retry();
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).not.toContain('High tide is at seve');
    expect(tide).toHaveBeenCalledTimes(1);
    expect(store.current!.turns[0]!.assistant.status).toBe('done');
  });
});

describe('one reply number across a rebuild of its tools (reopenTools)', () => {
  // The seam: Agent numbers the reply and hands it to each build of its tools (`toolSet`), which the
  // page's gate counts by, as ChatSession builds it (`gateToolSet` with `turn.reply`). A rebuild is
  // the same reply, so a per-reply budget counts across it.
  it('a reply that reopens keeps one reply number, so a per-reply budget counts across the rebuild', async () => {
    const call = (id: string, name: string): StreamPart[] => [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: id, toolName: name, input: '{}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
    ];
    const answers = [call('c1', 'make_app'), call('c2', 'build'), call('c3', 'build'), text('Done.')];
    const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream(answers.shift() ?? text('…')) as never }) });
    const raw: ToolSet = {
      make_app: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ app: 'tip-calc', reopenTools: true }) }),
      build: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ built: true }) }),
    };
    // The page's gate: a budget of two calls per reply, counted by the reply number it is handed.
    const seen: number[] = [];
    const counts = new Map<number, number>();
    const gate: ChatToolGate = (_name, _input, { reply }) => {
      seen.push(reply);
      const count = (counts.get(reply) ?? 0) + 1;
      counts.set(reply, count);
      return count > 2 ? { refuse: 'The reply used its two calls.' } : { allow: true };
    };
    const built: number[] = [];
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '9-2' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const agent = new Agent({
      model: () => model,
      store,
      jobs: new JobManager({} as never),
      toolSet: async (turn) => {
        built.push(turn.reply);
        return gateToolSet(raw, { conversationId: turn.conversationId, gate, onResult: () => undefined, reply: turn.reply });
      },
      attachments: () => [],
    });
    agent.addEventListener('error', () => undefined);

    await agent.send('make me a tip calculator');
    // Built twice (the start, then the rebuild), for one reply.
    expect(built).toHaveLength(2);
    expect(new Set(built).size).toBe(1);
    expect(new Set(seen).size).toBe(1);
    // The budget counted across the rebuild: the third call of the reply was refused.
    expect(seen).toHaveLength(3);
    expect(counts.get(seen[0]!)).toBe(3);
    expect(JSON.stringify(store.current!.turns[0]!.assistant.messages)).toContain('The reply used its two calls.');
  });
});
