import type { WorkflowTemplate } from '@civitai/sdk';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { MAX_STEPS } from '../config.js';
import { JobManager } from '../orchestration/jobs.js';
import { ThreadStore } from '../store/thread-store.js';
import { workflow } from '../test-support/fakes.js';
import { ASK_CHOICE } from '../tools/build.js';
import { Agent } from './agent.js';
import type { TurnPart } from './parts.js';

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

function setup(
  responses: (StreamPart[] | ((signal?: AbortSignal) => ReadableStream<StreamPart>) | Error)[],
  customInstructions?: string,
  host: { instructions?: () => string; tools?: string[] } = {},
) {
  const prompts: unknown[] = [];
  const toolChoices: unknown[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt);
      toolChoices.push(options.toolChoice);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return { stream: next(options.abortSignal) as never };
      return { stream: convertArrayToReadableStream(next ?? text('…')) as never };
    },
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Bike chat' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
  const store = new ThreadStore({
    orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
    api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
    hideMatureContent: () => true,
  });
  const generate = vi.fn(async () => ({ job: 'gen1-1', status: 'running', note: 'Started.' }));
  const tools: ToolSet = {
    generate_image: tool({ inputSchema: jsonSchema<{ prompt: string }>({ type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] }), execute: generate }),
    [ASK_CHOICE]: tool({ inputSchema: jsonSchema({ type: 'object', properties: { question: { type: 'string' } } }), execute: async () => ({ shown: true }) }),
  };
  const agent = new Agent({
    model: () => model,
    store,
    jobs: new JobManager({} as never),
    toolSet: async () => tools,
    attachments: () => [],
    customInstructions: () => customInstructions,
    hostInstructions: host.instructions,
    isHostTool: (name) => host.tools?.includes(name) ?? false,
    now: () => new Date('2026-09-23T00:00:00Z'),
  });
  const seen: TurnPart[][] = [];
  agent.addEventListener('change', () => {
    if (agent.live) seen.push(structuredClone(agent.live.parts));
  });
  return { agent, store, prompts, toolChoices, generate, seen };
}

describe('Agent', () => {
  it('streams a plain reply and records it on the turn', async () => {
    const { agent, store, seen } = setup([text('Hi ', 'there!')]);
    await agent.send('hello');
    const turn = store.current!.turns[0]!;
    expect(turn.assistant.status).toBe('done');
    expect(turn.assistant.messages).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] }]);
    expect(seen.map((parts) => (parts[0]?.kind === 'text' ? parts[0].text : ''))).toContain('Hi ');
    expect(agent.running).toBe(false);
  });

  it("sends the user's custom instructions with every request", async () => {
    const { agent, prompts } = setup([text('Ahoy!'), text('Aye.')], '  Talk like a pirate.  ');
    await agent.send('hello');
    await agent.send('again');
    const systems = prompts.map((prompt) => (prompt as { role: string; content: string }[]).find((m) => m.role === 'system')?.content ?? '');
    expect(systems).toHaveLength(2);
    for (const system of systems) expect(system).toContain('<user_instructions>\nTalk like a pirate.\n</user_instructions>');
  });

  it('tells the assistant what the embedding app says as of each reply, and which tools are its own', async () => {
    let pins = 0;
    const { agent, prompts } = setup([text('Sure.'), text('Sure.')], undefined, { instructions: () => `The board has ${pins} pins.`, tools: ['generate_image'] });
    await agent.send('hello');
    pins = 3;
    await agent.send('again');
    const systems = prompts.map((prompt) => (prompt as { role: string; content: string }[]).find((m) => m.role === 'system')?.content ?? '');
    expect(systems[0]).toContain('Its tools (generate_image) act on that app');
    expect(systems[0]).toContain('<app_instructions>\nThe board has 0 pins.\n</app_instructions>');
    expect(systems[1]).toContain('The board has 3 pins.');
  });

  it('calls a tool, feeds the result back, and lets the model answer', async () => {
    const { agent, store, prompts, generate } = setup([toolCall('generate_image', { prompt: 'a red bike' }), text('On its way!')]);
    await agent.send('make a red bike');
    expect(generate).toHaveBeenCalledWith({ prompt: 'a red bike' }, expect.objectContaining({ toolCallId: 'call_1' }));
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1])).toContain('gen1-1');
    const roles = store.current!.turns[0]!.assistant.messages.map((m) => m.role);
    expect(roles).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('ends the reply once a tool hands the next move to the user', async () => {
    const { agent, prompts, generate } = setup([toolCall('generate_image', { prompt: 'a form' }), text('should not run')]);
    generate.mockResolvedValueOnce({ panel: 'p1', awaitsUser: true, note: 'Wait.' } as never);
    await agent.send('let me post it with my own title');
    expect(prompts).toHaveLength(1);
  });

  it('asks the model chosen at the time of each reply', async () => {
    const replied: string[] = [];
    const model = (name: string) =>
      new MockLanguageModelV3({
        doStream: async () => {
          replied.push(name);
          return { stream: convertArrayToReadableStream(text(`from ${name}`)) as never };
        },
        doGenerate: async () => ({ content: [{ type: 'text', text: 'Title' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
      });
    const models = { fast: model('fast'), smart: model('smart') };
    let chosen: keyof typeof models = 'fast';
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const agent = new Agent({ model: () => models[chosen], store, jobs: new JobManager({} as never), toolSet: async () => ({}), attachments: () => [] });

    await agent.send('hi');
    chosen = 'smart';
    await agent.send('again');
    expect(replied).toEqual(['fast', 'smart']);
  });

  it('stops after showing choices, so the user answers next', async () => {
    const { agent, prompts } = setup([toolCall(ASK_CHOICE, { question: 'Which style?' }), text('should not run')]);
    await agent.send('make something');
    expect(prompts).toHaveLength(1);
  });

  it('makes the last allowed step answer in words instead of calling yet another tool', async () => {
    const calls = Array.from({ length: MAX_STEPS - 1 }, (_, i) => toolCall('generate_image', { prompt: `try ${i}` }, `call_${i}`));
    const { agent, store, toolChoices, prompts } = setup([...calls, text('Sorry, that did not work.')]);
    await agent.send('make a bike');
    expect(toolChoices).toHaveLength(MAX_STEPS);
    expect(toolChoices.at(-1)).toEqual({ type: 'none' });
    expect(toolChoices.slice(0, -1).every((choice) => (choice as { type: string }).type === 'auto')).toBe(true);
    expect(JSON.stringify((prompts.at(-1) as unknown[])[0])).toContain('you cannot call tools now');
    expect(JSON.stringify((prompts[0] as unknown[])[0])).not.toContain('you cannot call tools now');
    expect(store.current!.turns[0]!.assistant.messages.at(-1)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Sorry, that did not work.' }] });
  });

  it('keeps the words the user already read when they stop a reply', async () => {
    const { agent, store } = setup([
      (signal) =>
        new ReadableStream<StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'Once upon' });
            signal?.addEventListener('abort', () => controller.error(signal.reason));
          },
        }),
    ]);
    const done = agent.send('tell me a story');
    await vi.waitFor(() => expect(agent.live?.parts[0]).toMatchObject({ text: 'Once upon' }));
    agent.abort();
    await done;
    const turn = store.current!.turns[0]!;
    expect(turn.assistant.status).toBe('aborted');
    expect(turn.assistant.messages).toEqual([{ role: 'assistant', content: 'Once upon' }]);
  });

  it('records a failure in plain words and still saves the turn', async () => {
    const failure = Object.assign(new Error('Insufficient buzz'), { statusCode: 402 });
    const { agent, store } = setup([failure]);
    const errors: unknown[] = [];
    agent.addEventListener('error', (event) => errors.push((event as CustomEvent).detail));
    await agent.send('hello');
    const turn = store.current!.turns[0]!;
    expect(turn.assistant.status).toBe('error');
    expect(turn.assistant.error).toBe("You don't have enough Buzz for this.");
    expect(errors).toHaveLength(1);
  });

  it('says the assistant is unavailable when the model cannot run, and keeps what the service said for Details', async () => {
    const { agent, store } = setup([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'error', error: { message: 'Chat completion failed', type: 'server_error', workflow_id: '6-20260929164414954-lk9b' } },
      ],
    ]);
    await agent.send('hello');
    const { assistant } = store.current!.turns[0]!;
    expect(assistant.error).toBe("The assistant isn't available right now. Try again in a minute.");
    expect(assistant.errorDetail).toBe('Chat completion failed (workflow 6-20260929164414954-lk9b)');
  });
});
