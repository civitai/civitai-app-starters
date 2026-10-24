import type { WorkflowTemplate } from '@civitai/sdk';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { JobManager } from '../orchestration/jobs.js';
import { ThreadStore } from '../store/thread-store.js';
import { workflow } from '../test-support/fakes.js';
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
