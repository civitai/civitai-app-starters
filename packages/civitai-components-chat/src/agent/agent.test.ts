import type { WorkflowTemplate } from '@civitai/sdk';
import { APICallError, jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { chatConfig, configureChat, MAX_STEPS, stepLimit } from '../config.js';
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
    [ASK_CHOICE]: tool({ inputSchema: jsonSchema({ type: 'object', properties: { question: { type: 'string' } } }), execute: async () => ({ shown: true, awaitsUser: true }) }),
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
    expect(turn.assistant.ranOut).toBeUndefined();
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

  it('tells the assistant what the embedding app says as of each reply, without changing the system prompt', async () => {
    let pins = 0;
    const { agent, prompts } = setup([text('Sure.'), text('Sure.')], undefined, { instructions: () => `The board has ${pins} pins.`, tools: ['generate_image'] });
    await agent.send('hello');
    pins = 3;
    await agent.send('again');
    const messages = prompts as { role: string; content: unknown }[][];
    const systems = messages.map((prompt) => prompt.find((m) => m.role === 'system')?.content);
    const latest = messages.map((prompt) => JSON.stringify(prompt.filter((m) => m.role === 'user').at(-1)?.content));
    expect(systems[0]).toContain('Its tools (generate_image) act on that app');
    expect(systems[1]).toBe(systems[0]);
    expect(latest[0]).toContain('<app_instructions>\\nThe board has 0 pins.\\n</app_instructions>');
    expect(latest[1]).toContain('The board has 3 pins.');
    expect(JSON.stringify(messages[1]!.filter((m) => m.role === 'user')[0])).not.toContain('The board has');
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
    expect(store.current!.turns[0]!.assistant.ranOut).toBe(true);
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

  it('runs a failed reply again in the same turn, once the viewer agrees to pay for it', async () => {
    const usedUp = Object.assign(new Error('Free allowance used up until 2026-10-07T14:55:36Z'), { statusCode: 400 });
    const { agent, store } = setup([usedUp, text('Sure, here it is.')]);
    await agent.send('write me a haiku');
    const turn = store.current!.turns[0]!;
    expect(turn.assistant.errorKind).toBe('free_tier_exhausted');
    expect(turn.assistant.error).toMatch(/^Your free replies are used up until /);

    await agent.retry();

    expect(store.current!.turns).toHaveLength(1);
    expect(turn.assistant.status).toBe('done');
    expect(turn.assistant.messages).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Sure, here it is.' }] }]);
  });
});

describe("Agent's output-token cap", () => {
  function capped(maxOutputTokens?: () => number) {
    const caps: { reply: unknown[]; title: unknown[] } = { reply: [], title: [] };
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        caps.reply.push(options.maxOutputTokens);
        return { stream: convertArrayToReadableStream(text('Done.')) as never };
      },
      doGenerate: async (options) => {
        caps.title.push(options.maxOutputTokens);
        return { content: [{ type: 'text', text: 'A title' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
      },
    });
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const agent = new Agent({ model: () => model, store, jobs: new JobManager({} as never), toolSet: async () => ({}), attachments: () => [], ...(maxOutputTokens ? { maxOutputTokens } : {}) });
    return { agent, caps };
  }

  it("sends the viewer's cap as each reply's maxOutputTokens, read at every reply, and leaves the title's alone", async () => {
    let cap = 3_072;
    const { agent, caps } = capped(() => cap);
    await agent.send('write a big file');
    cap = 20_480;
    await agent.send('and another');
    await vi.waitFor(() => expect(caps.title).toHaveLength(1));
    expect(caps.reply).toEqual([3_072, 20_480]);
    expect(caps.title).toEqual([24]);
  });

  it('uses 16,384 when nothing sets one, and keeps an out-of-range cap within 1,024 to 32,768', async () => {
    const plain = capped();
    await plain.agent.send('hi');
    const huge = capped(() => 1_000_000);
    await huge.agent.send('hi');
    const tiny = capped(() => 12);
    await tiny.agent.send('hi');
    expect([...plain.caps.reply, ...huge.caps.reply, ...tiny.caps.reply]).toEqual([16_384, 32_768, 1_024]);
  });
});

describe('a reply refused because the model has no free replies', () => {
  const refusal = () => Object.assign(new Error('Model has no free replies'), { statusCode: 400 });

  function refusing(reply: 'refused' | 'ok') {
    const titles: unknown[] = [];
    const model = new MockLanguageModelV3({
      doStream: async () => {
        if (reply === 'refused') throw refusal();
        return { stream: convertArrayToReadableStream(text('Here.')) as never };
      },
      doGenerate: async () => {
        titles.push('asked');
        throw refusal();
      },
    });
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const agent = new Agent({ model: () => model, store, jobs: new JobManager({} as never), toolSet: async () => ({}), attachments: () => [] });
    const errors: unknown[] = [];
    agent.addEventListener('error', (e) => errors.push((e as CustomEvent).detail));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return { agent, store, titles, errors, warn };
  }

  it('says so once, on the reply, and asks for no title', async () => {
    const { agent, store, titles, errors } = refusing('refused');
    await agent.send('hello');
    // A title request would start right after the reply; give it the chance to.
    await flushAll();
    await flushAll();
    expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'error', errorKind: 'free_tier_not_free' });
    expect(errors).toHaveLength(1);
    expect(titles).toEqual([]);
    vi.restoreAllMocks();
  });

  it('keeps the first-message title without a warning when only the title model is refused', async () => {
    const { agent, store, titles, errors, warn } = refusing('ok');
    await agent.send('a lighthouse at dusk');
    await vi.waitFor(() => expect(titles).toHaveLength(1));
    await flushAll();
    expect(errors).toEqual([]);
    expect(store.current!.title).toBe('a lighthouse at dusk');
    expect(warn.mock.calls.filter(([message]) => String(message).includes('could not name'))).toEqual([]);
    vi.restoreAllMocks();
  });
});

const flushAll = () => new Promise((resolve) => setTimeout(resolve, 0));

const empty = (): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
const tries = (count: number) => Array.from({ length: count }, (_, i) => toolCall('generate_image', { prompt: `try ${i}` }, `call_${i}`));

describe('a reply that runs out of steps', () => {
  it('is marked ranOut when its forced last step says nothing at all, as Qwen did', async () => {
    const { agent, store, toolChoices } = setup([...tries(MAX_STEPS - 1), empty()]);
    await agent.send('build me a pomodoro timer');
    const { assistant } = store.current!.turns[0]!;
    expect(toolChoices).toHaveLength(MAX_STEPS);
    expect(assistant.status).toBe('done');
    expect(assistant.ranOut).toBe(true);
    // 9 tool steps, 9 results, and nothing from the silent last step.
    expect(assistant.messages).toHaveLength(18);
  });

  it('takes its step budget from configureChat({ maxSteps }), read at every reply', async () => {
    try {
      configureChat({ maxSteps: 3 });
      const { agent, store, toolChoices } = setup([...tries(2), empty()]);
      await agent.send('make a bike');
      expect(toolChoices).toEqual([{ type: 'auto' }, { type: 'auto' }, { type: 'none' }]);
      expect(store.current!.turns[0]!.assistant.ranOut).toBe(true);
    } finally {
      delete chatConfig.maxSteps;
    }
  });

  it('keeps a configured budget within 2 to 50, and is 10 unset', () => {
    try {
      expect(stepLimit()).toBe(10);
      for (const [value, limit] of [[1, 2], [7.4, 7], [400, 50], [Number.NaN, 10]] as const) {
        chatConfig.maxSteps = value;
        expect(stepLimit()).toBe(limit);
      }
    } finally {
      delete chatConfig.maxSteps;
    }
  });
});

/** Run (a-glm) turn 1 of the App Assistant evaluation: GLM's forced last step, as shown to the viewer. */
const GLM_LAST_STEP =
  '<tool_call>sandbox__list_dir<arg_key>path</arg_key><arg_value>pomodoro-glm</arg_value></tool_call><tool_call>sandbox__read_file<arg_key>path</arg_key><arg_value>pomodoro-glm/src/block.ts</arg_value></tool_call>';

describe("tool-call markup in a reply's last step", () => {
  it('is not kept or shown, and the reply still offers to continue', async () => {
    const { agent, store, seen } = setup([...tries(MAX_STEPS - 1), text('<tool_call>sandbox__list_dir<arg_key>path', '</arg_key><arg_value>pomodoro-glm</arg_value></tool_call>', GLM_LAST_STEP.slice(GLM_LAST_STEP.indexOf('<tool_call>sandbox__read_file')))]);
    await agent.send('build me a pomodoro timer');
    const { assistant } = store.current!.turns[0]!;
    expect(JSON.stringify(assistant.messages)).not.toContain('tool_call');
    expect(JSON.stringify(seen)).not.toContain('tool_call');
    expect(assistant.messages).toHaveLength(18);
    expect(assistant.ranOut).toBe(true);
  });

  it('keeps the words around it', async () => {
    const { agent, store } = setup([...tries(MAX_STEPS - 1), text('I read the files but ran out of steps. ', GLM_LAST_STEP, ' Say continue and I will carry on.')]);
    await agent.send('build me a pomodoro timer');
    expect(store.current!.turns[0]!.assistant.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'I read the files but ran out of steps.  Say continue and I will carry on.' }],
    });
  });

  it('is left alone in any earlier step, where a model may mean to show code', async () => {
    const { agent, store } = setup([text('Write it like <tool_call>x</tool_call>.')]);
    await agent.send('how do tool calls look?');
    expect(JSON.stringify(store.current!.turns[0]!.assistant.messages)).toContain('<tool_call>x</tool_call>');
  });
});

describe("an errored reply's trace", () => {
  function failing(responses: Parameters<typeof setup>[0]) {
    const made = setup(responses);
    const errors: { trace: unknown }[] = [];
    made.agent.addEventListener('error', (event) => errors.push((event as CustomEvent).detail));
    return { ...made, errors };
  }

  it('says the request failed, at which step, with what, and sends it with the error event', async () => {
    const { agent, store, errors } = failing([toolCall('generate_image', { prompt: 'a' }), new TypeError('Failed to fetch')]);
    await agent.send('make a bike');
    const { errorTrace } = store.current!.turns[0]!.assistant;
    expect(errorTrace).toMatchObject({ stage: 'request', step: 2, name: 'TypeError', message: 'Failed to fetch', lastTool: { name: 'generate_image', state: 'done' } });
    expect(errors[0]!.trace).toEqual(errorTrace);
  });

  it("keeps a service error's status, host, request id, body and cause", async () => {
    const failure = new APICallError({
      message: 'Failed to process successful response',
      url: 'https://orchestration.example/v1/chat/completions?token=secret',
      requestBodyValues: {},
      statusCode: 200,
      responseHeaders: { 'x-request-id': 'req-42' },
      responseBody: 'x'.repeat(2_000),
      cause: new SyntaxError('Unexpected token < in JSON at position 0'),
      isRetryable: false,
    });
    const { agent, store } = failing([failure]);
    await agent.send('hello');
    expect(store.current!.turns[0]!.assistant.errorTrace).toEqual({
      stage: 'request',
      step: 1,
      msIntoStep: expect.any(Number),
      name: 'AI_APICallError',
      message: 'Failed to process successful response',
      statusCode: 200,
      isRetryable: false,
      host: 'orchestration.example',
      responseBody: 'x'.repeat(500),
      cause: 'Unexpected token < in JSON at position 0',
      requestId: 'req-42',
    });
  });

  it('says the stream failed when a malformed chunk came after the answer started', async () => {
    const { agent, store } = failing([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Hi' },
        { type: 'error', error: Object.assign(new Error('JSON parsing failed: Text: {not json.'), { name: 'AI_JSONParseError', cause: new SyntaxError("Expected property name or '}' in JSON at position 1") }) },
      ],
    ]);
    await agent.send('hello');
    expect(store.current!.turns[0]!.assistant.errorTrace).toMatchObject({ stage: 'stream', step: 1, name: 'AI_JSONParseError', cause: "Expected property name or '}' in JSON at position 1" });
  });

  it('says the tools failed when they could not be built, before any request', async () => {
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream(text('no')) as never }) });
    const agent = new Agent({ model: () => model, store, jobs: new JobManager({} as never), toolSet: async () => Promise.reject(new Error('MCP listTools timed out')), attachments: () => [] });
    await agent.send('hello');
    expect(store.current!.turns[0]!.assistant.errorTrace).toMatchObject({ stage: 'tools', step: 0, message: 'MCP listTools timed out' });
  });
});
