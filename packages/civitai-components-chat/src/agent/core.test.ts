import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { chatConfig, configureChat } from '../config.js';
import { AgentCore, MAX_TOOL_REOPENS, withoutToolMarkup, type AgentCoreOutcome, type AgentCoreRun } from './core.js';
import type { TurnPart } from './parts.js';

/**
 * AgentCore on its own: no store, no page, no element, no DOM (this file runs in the `node` project).
 * Everything it asks with comes from `run`, and how the reply ended comes back as the outcome.
 */

type StreamPart = Record<string, unknown>;

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const text = (...deltas: string[]): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })),
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
const toolCall = (toolName: string, input: unknown, toolCallId = 'call_1'): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];
/** A 200 answer that streams `parts`, then dies with `error`. */
const cutAfter =
  (parts: StreamPart[], error: () => unknown) =>
  (): ReadableStream<StreamPart> => {
    const queue = [...parts];
    return new ReadableStream<StreamPart>(
      {
        pull(controller) {
          const next = queue.shift();
          if (next) controller.enqueue(next);
          else controller.error(error());
        },
      },
      { highWaterMark: 0 },
    );
  };

type Response = StreamPart[] | ((signal?: AbortSignal) => ReadableStream<StreamPart>) | Error;

function setup(responses: Response[]) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return { stream: next(options.abortSignal) as never };
      return { stream: convertArrayToReadableStream(next ?? text('…')) as never };
    },
  });
  const sketch = vi.fn(async ({ subject }: { subject: string }) => ({ sketched: subject }));
  const tools: ToolSet = {
    sketch: tool({ inputSchema: jsonSchema<{ subject: string }>({ type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'] }), execute: sketch }),
    ask: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ shown: true, awaitsUser: true }) }),
  };
  const changes: { running: boolean; parts: TurnPart[] | null }[] = [];
  /** `live.reconnecting` at each change, while a reply shows. */
  const down: (boolean | undefined)[] = [];
  const core: AgentCore = new AgentCore({
    describeError: (error) => ({ kind: 'unknown', message: `shown: ${(error as Error).message}` }),
    change: () => {
      changes.push({ running: core.running, parts: core.live ? structuredClone(core.live.parts) : null });
      if (core.live) down.push(core.live.reconnecting);
    },
  });
  const history: ModelMessage[] = [{ role: 'user', content: 'draw a lighthouse' }];
  const run = (extra: Partial<AgentCoreRun> = {}): Promise<AgentCoreOutcome | undefined> =>
    core.run({
      seq: 4,
      tools: async () => tools,
      request: () => ({ model, system: 'You draw.', history, maxOutputTokens: 512, networkRetryDelaysMs: [0, 0] }),
      ...extra,
    });
  return { core, run, prompts, sketch, changes, down };
}

describe('AgentCore', () => {
  it('runs a reply through its tools to the end, showing it as it streams, and hands back what it kept', async () => {
    const { core, run, prompts, sketch, changes } = setup([toolCall('sketch', { subject: 'lighthouse' }), text('Here is ', 'your lighthouse.')]);
    expect(core.running).toBe(false);
    const outcome = await run();
    expect(outcome).toMatchObject({ status: 'done' });
    expect(outcome).not.toHaveProperty('ranOut');
    expect(outcome).not.toHaveProperty('stopped');
    expect(sketch).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[0])).toContain('draw a lighthouse');
    expect(JSON.stringify(prompts[0])).toContain('You draw.');
    expect(outcome!.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(outcome!.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Here is your lighthouse.' }] });
    // Shown as it went, while running; cleared, and not running, once it ended.
    expect(changes[0]).toEqual({ running: true, parts: [] });
    expect(changes.some((c) => c.parts?.some((p) => p.kind === 'tool' && p.toolName === 'sketch' && p.state === 'done'))).toBe(true);
    expect(changes.at(-2)?.parts?.at(-1)).toEqual({ kind: 'text', text: 'Here is your lighthouse.' });
    expect(changes.at(-1)).toEqual({ running: false, parts: null });
    expect(core.live).toBeNull();
  });

  it('settles while the reply still shows, then clears', async () => {
    const { core, run } = setup([text('Done.')]);
    const seen: unknown[] = [];
    await run({ settled: (outcome) => seen.push({ status: outcome.status, running: core.running, seq: core.live?.seq, parts: core.live?.parts.length }) });
    expect(seen).toEqual([{ status: 'done', running: true, seq: 4, parts: 1 }]);
    expect(core.running).toBe(false);
  });

  it('runs one reply at a time', async () => {
    const { run } = setup([text('First.'), text('Second.')]);
    const first = run();
    expect(await run()).toBeUndefined();
    expect(await first).toMatchObject({ status: 'done' });
  });

  it('ends the reply when a tool hands the next move to the viewer', async () => {
    const { run, prompts } = setup([toolCall('ask', {}), text('never asked for')]);
    const outcome = await run();
    expect(outcome).toMatchObject({ status: 'done' });
    expect(prompts).toHaveLength(1);
  });

  it('marks a reply that used every step as ranOut, and takes tool-call syntax out of its last words', async () => {
    try {
      configureChat({ maxSteps: 2 });
      const { run, prompts } = setup([toolCall('sketch', { subject: 'a' }), text('Sketched. <tool_call>{"name":"sketch"}</tool_call>')]);
      const outcome = await run();
      expect(prompts).toHaveLength(2);
      expect(outcome).toMatchObject({ status: 'done', ranOut: true });
      expect(outcome!.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Sketched.' }] });
    } finally {
      delete chatConfig.maxSteps;
    }
  });

  it('asks again for a step the network cut before it called a tool, keeping the finished step as it was', async () => {
    const retries: { attempt: number; stage: string; step: number }[] = [];
    const { run, prompts, sketch } = setup([toolCall('sketch', { subject: 'lighthouse' }), new TypeError('Failed to fetch'), text('All done.')]);
    const outcome = await run({ retrying: (attempt, trace) => retries.push({ attempt, stage: trace.stage, step: trace.step }) });
    expect(outcome).toMatchObject({ status: 'done' });
    expect(retries).toEqual([{ attempt: 1, stage: 'request', step: 2 }]);
    expect(sketch).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(3);
    expect(outcome!.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('says it is reconnecting while a step the network cut is asked for again, and not once the model answers', async () => {
    const { core, run, down } = setup([toolCall('sketch', { subject: 'lighthouse' }), new TypeError('Failed to fetch'), text('All done.')]);
    const before = Date.now();
    let startedAt: number | undefined;
    const outcome = await run({ settled: () => (startedAt = core.live?.startedAt) });
    expect(outcome).toMatchObject({ status: 'done' });
    // Up, then down for the cut step's wait, then up again for the rest of the reply.
    expect(down.filter((d, i) => d !== undefined && d !== down[i - 1])).toEqual([true, false]);
    expect(down.at(-1)).toBe(false);
    expect(startedAt).toBeGreaterThanOrEqual(before);
  });

  it('never says it is reconnecting for a reply the network did not cut', async () => {
    const { run, down } = setup([toolCall('sketch', { subject: 'lighthouse' }), text('Done.')]);
    await run();
    expect(down.length).toBeGreaterThan(2);
    expect(down.every((d) => !d)).toBe(true);
  });

  it('fails a reply on an error that is not a dropped connection, with where to carry on from', async () => {
    const { run } = setup([toolCall('sketch', { subject: 'lighthouse' }), cutAfter([{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Half a sen' }], () => new Error('boom'))]);
    const outcome = await run();
    expect(outcome).toMatchObject({ status: 'error', where: { stage: 'stream', step: 2 }, resume: { steps: 1 } });
    expect((outcome!.error as Error).message).toBe('boom');
    // Only the finished step: the cut step's words are not one, and asking again must not send them as one.
    expect(outcome!.resume!.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);
    // The words the viewer already read are kept, after the finished step.
    expect(outcome!.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(outcome!.messages.at(-1)).toEqual({ role: 'assistant', content: 'Half a sen' });
  });

  it('fails at the tools stage when they cannot be built, before asking anything', async () => {
    const { run, prompts } = setup([text('never')]);
    const outcome = await run({
      tools: async () => {
        throw new Error('no tools');
      },
    });
    expect(outcome).toMatchObject({ status: 'error', where: { stage: 'tools', step: 0 }, resume: { messages: [], steps: 0 }, messages: [] });
    expect(prompts).toHaveLength(0);
  });

  it('carries on from a resume point: its steps are sent as they are and shown at once', async () => {
    const kept: ModelMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'k1', toolName: 'sketch', input: { subject: 'gull' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'k1', toolName: 'sketch', output: { type: 'json', value: { sketched: 'gull' } } }] },
    ];
    const { run, prompts, sketch, changes } = setup([text('And the gull.')]);
    const outcome = await run({ from: { messages: kept, steps: 1, at: 0 } });
    expect(changes[0]!.parts).toMatchObject([{ kind: 'tool', toolCallId: 'k1', toolName: 'sketch' }]);
    expect(sketch).not.toHaveBeenCalled();
    expect(JSON.stringify(prompts[0])).toContain('"toolCallId":"k1"');
    expect(outcome!.messages.slice(0, 2)).toEqual(kept);
    expect(outcome!.messages).toHaveLength(3);
  });

  it('ends aborted when stopped, keeping the words already shown', async () => {
    const { core, run } = setup([
      (signal) =>
        new ReadableStream<StreamPart>({
          start(controller) {
            for (const part of [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Once upon' }]) controller.enqueue(part);
            signal?.addEventListener('abort', () => controller.error(signal.reason));
          },
        }),
    ]);
    const outcome = run();
    await vi.waitFor(() => expect(core.live?.parts[0]).toEqual({ kind: 'text', text: 'Once upon' }));
    core.abort();
    expect(await outcome).toMatchObject({ status: 'aborted', messages: [{ role: 'assistant', content: 'Once upon' }] });
    expect(core.running).toBe(false);
  });

  it('shows a tool error in the words describeError gives', async () => {
    const { run, changes } = setup([toolCall('sketch', { subject: 'x' }), text('Sorry.')]);
    const failing: ToolSet = {
      sketch: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: async (): Promise<{ sketched: string }> => {
          throw new Error('pen broke');
        },
      }),
    };
    await run({ tools: async () => failing });
    expect(changes.some((c) => c.parts?.some((p) => p.kind === 'tool' && p.state === 'error' && p.error === 'shown: pen broke'))).toBe(true);
  });
});

describe('withoutToolMarkup', () => {
  it('cleans the last assistant message, drops it when nothing is left, and leaves others alone', () => {
    const user: ModelMessage = { role: 'user', content: 'hi' };
    expect(withoutToolMarkup([user, { role: 'assistant', content: 'Ok. <tool_call>{"name":"x"}</tool_call>' }])).toEqual([user, { role: 'assistant', content: 'Ok.' }]);
    expect(withoutToolMarkup([user, { role: 'assistant', content: [{ type: 'text', text: '<tool_call>{"name":"x"}</tool_call>' }] }])).toEqual([user]);
    expect(withoutToolMarkup([user])).toEqual([user]);
  });
});

describe('a tool that reopens the reply’s tools (`reopenTools`)', () => {
  it('carries the same reply on with its tools built again, and the next step uses the new tool', async () => {
    const { core, run, prompts } = setup([toolCall('make_app', {}), toolCall('build', {}, 'call_2'), text('Built it.')]);
    const build = vi.fn(async () => ({ built: true }));
    const first: ToolSet = {
      make_app: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ app: 'tip-calc', reopenTools: true }) }),
    };
    const second: ToolSet = { ...first, build: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: build }) };
    const asked: ({ messages: ModelMessage[] } | undefined)[] = [];
    const outcome = await run({
      tools: async (progress) => {
        asked.push(progress);
        return asked.length === 1 ? first : second;
      },
    });
    expect(outcome).toMatchObject({ status: 'done' });
    expect(outcome).not.toHaveProperty('stopped');
    // Built twice: first with nothing, then with the reply's finished steps (make_app and its result).
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBeUndefined();
    expect(JSON.stringify(asked[1]!.messages)).toContain('tip-calc');
    expect(build).toHaveBeenCalledTimes(1);
    // One reply: three steps asked for, the last two carrying the first step on.
    expect(prompts).toHaveLength(3);
    expect(JSON.stringify(prompts[1])).toContain('tip-calc');
    expect(outcome!.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect(core.running).toBe(false);
  });

  it('NEGATIVE CONTROL: without reopenTools the tools are built once, and a call to a tool that is not there fails', async () => {
    const { run } = setup([toolCall('make_app', {}), toolCall('build', {}, 'call_2'), text('Could not build.')]);
    const build = vi.fn(async () => ({ built: true }));
    const first: ToolSet = {
      make_app: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ app: 'tip-calc' }) }),
    };
    const tools = vi.fn(async () => first);
    await run({ tools });
    expect(tools).toHaveBeenCalledTimes(1);
    expect(build).not.toHaveBeenCalled();
  });

  it('a result that also waits on the viewer ends the reply there, building nothing again', async () => {
    const { run, prompts } = setup([toolCall('make_app', {}), text('never asked')]);
    const tools = vi.fn(async () => ({
      make_app: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ reopenTools: true, awaitsUser: true }) }),
    }));
    const outcome = await run({ tools });
    expect(outcome).toMatchObject({ status: 'done' });
    expect(tools).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(1);
  });

  it(`builds the tools again at most ${MAX_TOOL_REOPENS} times in one reply`, async () => {
    const calls = Array.from({ length: MAX_TOOL_REOPENS + 2 }, (_, i) => toolCall('make_app', {}, `call_${i}`));
    const { run } = setup([...calls, text('Done.')]);
    const tools = vi.fn(async () => ({
      make_app: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ reopenTools: true }) }),
    }));
    const outcome = await run({ tools });
    expect(outcome).toMatchObject({ status: 'done' });
    expect(tools).toHaveBeenCalledTimes(MAX_TOOL_REOPENS + 1);
  });
});
