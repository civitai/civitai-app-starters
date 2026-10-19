import type { WorkflowTemplate } from '@civitai/sdk';
import { APICallError, jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { chatConfig, configureChat, MAX_STEPS, stepLimit } from '../config.js';
import { JobManager } from '../orchestration/jobs.js';
import { ThreadStore } from '../store/thread-store.js';
import { workflow } from '../test-support/fakes.js';
import { ASK_CHOICE } from '../tools/build.js';
import { Agent, type AgentDeps } from './agent.js';
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
  extra: Partial<AgentDeps> = {},
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
    ...extra,
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

  it('keeps a configured budget within 2 to 1,000, and is 10 unset', () => {
    try {
      expect(stepLimit()).toBe(10);
      for (const [value, limit] of [[1, 2], [7.4, 7], [400, 400], [1_000, 1_000], [5_000, 1_000], [Number.NaN, 10]] as const) {
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
  // Retries off: these are about the trace of the failure the viewer sees.
  function failing(responses: Parameters<typeof setup>[0]) {
    const made = setup(responses, undefined, {}, { networkRetryDelaysMs: [] });
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

/** Chromium's two shapes when it drops in-flight connections because the client's network changed. */
const failedToFetch = () => new TypeError('Failed to fetch');
const bodyCut = () =>
  new APICallError({
    message: 'Failed to process successful response',
    url: 'https://orchestration.example/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 200,
    cause: new TypeError('network error'),
    isRetryable: false,
  });

/**
 * A 200 answer whose body starts (`parts`) and then dies with `error`. Each part is handed over only
 * when read, since erroring a stream throws away what is still queued in it.
 */
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

/** Every tool call the model was ever shown for `id`, across all the requests sent in one prompt. */
const callsIn = (prompt: unknown, id: string) => (JSON.stringify(prompt).match(new RegExp(`"type":"tool-call","toolCallId":"${id}"`, 'g')) ?? []).length;

describe('a reply the network cut off', () => {
  function cut(responses: Parameters<typeof setup>[0], delays: readonly number[] = [0, 0]) {
    const made = setup(responses, undefined, {}, { networkRetryDelaysMs: delays });
    const errors: unknown[] = [];
    const retries: { attempt: number; trace: { stage: string; step: number; name?: string } }[] = [];
    made.agent.addEventListener('error', (event) => errors.push((event as CustomEvent).detail));
    made.agent.addEventListener('network-retry', (event) => retries.push((event as CustomEvent).detail));
    return { ...made, errors, retries };
  }

  it('asks again for the step whose request failed to fetch, without running the finished step’s tool again', async () => {
    const { agent, store, prompts, generate, errors, retries } = cut([toolCall('generate_image', { prompt: 'a red bike' }), failedToFetch(), text('On its way!')]);
    await agent.send('make a red bike');
    const { assistant } = store.current!.turns[0]!;
    expect(assistant.status).toBe('done');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(3);
    // The retried request carries the finished step once: its call and its result, not asked for again.
    expect(callsIn(prompts[2], 'call_1')).toBe(1);
    expect(JSON.stringify(prompts[2])).toContain('gen1-1');
    expect(assistant.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(assistant.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'On its way!' }] });
    expect(errors).toEqual([]);
    expect(retries).toMatchObject([{ attempt: 1, trace: { stage: 'request', step: 2, name: 'TypeError', message: 'Failed to fetch' } }]);
    expect(assistant.networkRetries).toEqual([retries[0]!.trace]);
    expect(assistant.errorTrace).toBeUndefined();
  });

  it('asks again for a step whose answer was cut mid-stream, and shows and keeps its words once', async () => {
    const { agent, store, prompts, generate, seen, retries } = cut([
      toolCall('generate_image', { prompt: 'a red bike' }),
      cutAfter([{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Your bike is ' }], bodyCut),
      text('Your bike is ', 'on its way!'),
    ]);
    await agent.send('make a red bike');
    const { assistant } = store.current!.turns[0]!;
    expect(assistant.status).toBe('done');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(3);
    expect(callsIn(prompts[2], 'call_1')).toBe(1);
    expect(retries).toMatchObject([{ attempt: 1, trace: { stage: 'stream', step: 2, name: 'AI_APICallError', statusCode: 200, cause: 'network error' } }]);
    // Kept: the tool step and the answer, once.
    expect(assistant.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(JSON.stringify(assistant.messages).match(/Your bike is/g)).toHaveLength(1);
    // Shown: the cut words went when the step was asked for again, so the answer never reads twice.
    for (const parts of seen) expect(JSON.stringify(parts).match(/Your bike is/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(seen.at(-1)!.filter((part) => part.kind === 'tool')).toHaveLength(1);
    expect(seen.at(-1)!.at(-1)).toEqual({ kind: 'text', text: 'Your bike is on its way!' });
  });

  it('drops a cut step that the stream still closed after the error, rather than keeping it as finished', async () => {
    const { agent, store, prompts, generate, seen } = cut([
      toolCall('generate_image', { prompt: 'a red bike' }),
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Your bike is ' },
        { type: 'error', error: new TypeError('network error') },
        { type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage },
      ],
      text('Your bike is ', 'on its way!'),
    ]);
    await agent.send('make a red bike');
    const { assistant } = store.current!.turns[0]!;
    expect(assistant.status).toBe('done');
    expect(prompts).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prompts[2])).not.toContain('Your bike is');
    expect(assistant.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(JSON.stringify(assistant.messages).match(/Your bike is/g)).toHaveLength(1);
    for (const parts of seen) expect(JSON.stringify(parts).match(/Your bike is/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(seen.at(-1)!.at(-1)).toEqual({ kind: 'text', text: 'Your bike is on its way!' });
  });

  it('keeps the words of a step the stream closed after the error once, when the reply then fails', async () => {
    const { agent, store } = cut(
      [
        [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'Your bike is ' },
          { type: 'error', error: new TypeError('network error') },
          { type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage },
        ],
      ],
      [],
    );
    await agent.send('make a red bike');
    const { assistant } = store.current!.turns[0]!;
    expect(assistant).toMatchObject({ status: 'error', errorKind: 'network' });
    expect(assistant.messages.map((m) => m.role)).toEqual(['assistant']);
    expect(JSON.stringify(assistant.messages).match(/Your bike is/g)).toHaveLength(1);
  });

  /** A step whose answer has an error part and then, as the provider allows, a tool call and a tool-calls finish. */
  const errorThenToolCall = (error: unknown): StreamPart[] => [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'Making it. ' },
    { type: 'text-end', id: 't' },
    { type: 'error', error },
    { type: 'tool-call', toolCallId: 'call_1', toolName: 'generate_image', input: JSON.stringify({ prompt: 'a red bike' }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
  ];

  it('keeps a tool call that ran after an error in the stream, with its result, when the reply then fails', async () => {
    const parseError = Object.assign(new Error('JSON parsing failed: Text: {not json.'), { name: 'AI_JSONParseError' });
    const { agent, store, generate } = cut([errorThenToolCall(parseError), text('Here it is.')]);
    await agent.send('make a red bike');
    const { assistant } = store.current!.turns[0]!;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(assistant.status).toBe('error');
    const saved = JSON.stringify(assistant.messages);
    expect(saved.match(/"type":"tool-call","toolCallId":"call_1"/g)).toHaveLength(1);
    expect(saved).toContain('gen1-1');
    expect(saved.match(/Making it\./g)).toHaveLength(1);
  });

  it('does not ask again when a tool call came after a network-shaped error, so the tool runs once', async () => {
    const { agent, store, prompts, generate, retries } = cut([errorThenToolCall(new TypeError('network error')), text('Here it is.'), toolCall('generate_image', { prompt: 'a red bike' }), text('again')]);
    await agent.send('make a red bike');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(retries).toEqual([]);
    // The SDK's own next step after the tools, and nothing asked again.
    expect(prompts).toHaveLength(2);
    expect(store.current!.turns[0]!.assistant.status).toBe('error');
  });

  it('keeps the words of a step the stream closed after an error once, when the viewer then stops', async () => {
    const parseError = Object.assign(new Error('JSON parsing failed: Text: {not json.'), { name: 'AI_JSONParseError' });
    let release: (() => void) | undefined;
    const { agent, store } = cut([
      errorThenToolCall(parseError),
      // The next step's request waits until the viewer stops.
      (signal) =>
        new ReadableStream<StreamPart>({
          start(controller) {
            release = () => controller.error(signal?.reason);
            signal?.addEventListener('abort', () => release?.());
          },
        }),
    ]);
    const done = agent.send('make a red bike');
    await vi.waitFor(() => expect(release).toBeDefined());
    agent.abort();
    await done;
    const { assistant } = store.current!.turns[0]!;
    expect(assistant.status).toBe('aborted');
    const saved = JSON.stringify(assistant.messages);
    expect(saved.match(/Making it\./g)).toHaveLength(1);
    expect(saved.match(/"type":"tool-call","toolCallId":"call_1"/g)).toHaveLength(1);
  });

  it('asks again when the first request fails to fetch or the first answer is cut 0 bytes in', async () => {
    for (const first of [failedToFetch(), bodyCut(), cutAfter([], () => new TypeError('network error'))]) {
      const { agent, store, prompts } = cut([first, text('Hello!')]);
      await agent.send('hi');
      expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'done', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] }] });
      expect(prompts).toHaveLength(2);
    }
  });

  // A tool call before the error. The SDK runs tools only after an answer's finish chunk, so this one
  // never ran; the reply is still not asked again, since a provider or SDK could run one sooner.
  it('does not ask again when the cut step had already called a tool, which may have run', async () => {
    const { agent, store, prompts, generate, errors, retries } = cut([
      cutAfter([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'call_1', toolName: 'generate_image', input: JSON.stringify({ prompt: 'a red bike' }) }], bodyCut),
      text('should not run'),
    ]);
    await agent.send('make a red bike');
    expect(prompts).toHaveLength(1);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(1);
    expect(retries).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'error', errorKind: 'network', errorTrace: { name: 'AI_APICallError', cause: 'network error' } });
  });

  it('asks again when the cut came while a tool call was still being written, before it could run', async () => {
    const { agent, store, prompts, generate } = cut([
      cutAfter(
        [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'call_1', toolName: 'generate_image' },
          { type: 'tool-input-delta', id: 'call_1', delta: '{"prompt":"a re' },
        ],
        () => new TypeError('network error'),
      ),
      toolCall('generate_image', { prompt: 'a red bike' }),
      text('On its way!'),
    ]);
    await agent.send('make a red bike');
    expect(store.current!.turns[0]!.assistant.status).toBe('done');
    expect(prompts).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.current!.turns[0]!.assistant.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('says the reply failed once its retries are used up, with every cut on record', async () => {
    const { agent, store, prompts, errors, retries } = cut([failedToFetch(), bodyCut(), failedToFetch(), text('never')]);
    await agent.send('hi');
    const { assistant } = store.current!.turns[0]!;
    expect(prompts).toHaveLength(3);
    expect(assistant).toMatchObject({ status: 'error', errorKind: 'network', errorTrace: { name: 'TypeError', message: 'Failed to fetch' } });
    expect(errors).toHaveLength(1);
    expect(retries.map((retry) => retry.attempt)).toEqual([1, 2]);
    expect(assistant.networkRetries).toHaveLength(2);
  });

  it('does not ask again for a failure that is not a dropped connection', async () => {
    const malformed = new APICallError({ message: 'Failed to process successful response', url: 'https://x.example', requestBodyValues: {}, statusCode: 200, cause: new SyntaxError('Unexpected token <'), isRetryable: false });
    const cases: Parameters<typeof setup>[0][number][] = [
      Object.assign(new Error('Insufficient buzz'), { statusCode: 402 }),
      Object.assign(new Error('Free allowance used up until 2026-10-07T14:55:36Z'), { statusCode: 400 }),
      new APICallError({ message: 'Unauthorized', url: 'https://x.example', requestBodyValues: {}, statusCode: 401, isRetryable: false }),
      new APICallError({ message: 'Bad gateway', url: 'https://x.example', requestBodyValues: {}, statusCode: 502, isRetryable: false }),
      malformed,
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      [{ type: 'stream-start', warnings: [] }, { type: 'error', error: { message: 'Chat completion failed', type: 'server_error' } }],
    ];
    for (const failure of cases) {
      const { agent, store, prompts, retries } = cut([failure, text('should not run')]);
      await agent.send('hello');
      expect(prompts).toHaveLength(1);
      expect(retries).toEqual([]);
      expect(store.current!.turns[0]!.assistant.status).toBe('error');
      expect(store.current!.turns[0]!.assistant.networkRetries).toBeUndefined();
    }
  });

  it('does not ask again for a reply the viewer stopped', async () => {
    const { agent, store, prompts } = cut([
      (signal) =>
        new ReadableStream<StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'Once upon' });
            signal?.addEventListener('abort', () => controller.error(signal.reason));
          },
        }),
      text('should not run'),
    ]);
    const done = agent.send('tell me a story');
    await vi.waitFor(() => expect(agent.live?.parts[0]).toMatchObject({ text: 'Once upon' }));
    agent.abort();
    await done;
    expect(prompts).toHaveLength(1);
    expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'aborted', messages: [{ role: 'assistant', content: 'Once upon' }] });
  });

  it('stops waiting to ask again when the viewer stops the reply', async () => {
    const { agent, store, prompts, retries } = cut([failedToFetch(), text('should not run')], [60_000]);
    const done = agent.send('hi');
    await vi.waitFor(() => expect(retries).toHaveLength(1));
    agent.abort();
    await done;
    expect(prompts).toHaveLength(1);
    expect(store.current!.turns[0]!.assistant.status).toBe('aborted');
    expect(agent.running).toBe(false);
  });

  it('keeps the reply to its step budget across a retry, and still makes the last step speak', async () => {
    try {
      configureChat({ maxSteps: 3 });
      const { agent, store, toolChoices, generate } = cut([toolCall('generate_image', { prompt: 'a' }, 'call_a'), failedToFetch(), toolCall('generate_image', { prompt: 'b' }, 'call_b'), text('Made two.')]);
      await agent.send('make two bikes');
      // Step 1, step 2 (cut), step 2 again, step 3: the last, which cannot call tools.
      expect(toolChoices).toEqual([{ type: 'auto' }, { type: 'auto' }, { type: 'auto' }, { type: 'none' }]);
      expect(generate).toHaveBeenCalledTimes(2);
      const { assistant } = store.current!.turns[0]!;
      expect(assistant).toMatchObject({ status: 'done', ranOut: true });
      expect(assistant.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant']);
    } finally {
      delete chatConfig.maxSteps;
    }
  });
});

describe('a cut after an earlier error the stream recovered from', () => {
  const parseError = () => Object.assign(new Error('JSON parsing failed: Text: {not json.'), { name: 'AI_JSONParseError' });
  /** A step with an in-band error that the stream gets past: it still closes with a tool call and a tool-calls finish. */
  const recovered = (toolCallId: string): StreamPart[] => [
    { type: 'stream-start', warnings: [] },
    { type: 'error', error: parseError() },
    { type: 'tool-call', toolCallId, toolName: 'generate_image', input: JSON.stringify({ prompt: toolCallId }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
  ];

  function run(responses: Parameters<typeof setup>[0], delays: readonly number[]) {
    const made = setup(responses, undefined, {}, { networkRetryDelaysMs: delays });
    const retries: { trace: Record<string, unknown> }[] = [];
    made.agent.addEventListener('network-retry', (event) => retries.push((event as CustomEvent).detail));
    return { ...made, retries };
  }

  it('asks again when a later request fails to fetch, every tool running once (the long-reply shape)', async () => {
    const { agent, store, prompts, generate, retries } = run(
      [toolCall('generate_image', { prompt: 'a' }, 'call_a'), recovered('call_b'), toolCall('generate_image', { prompt: 'c' }, 'call_c'), new TypeError('Failed to fetch'), text('Done.')],
      [0],
    );
    await agent.send('build it');
    const { assistant } = store.current!.turns[0]!;
    expect(assistant.status).toBe('done');
    expect(generate.mock.calls.map((call) => ((call as unknown[])[0] as { prompt: string }).prompt)).toEqual(['a', 'call_b', 'c']);
    expect(prompts).toHaveLength(5);
    for (const id of ['call_a', 'call_b', 'call_c']) expect(callsIn(prompts[4], id)).toBe(1);
    expect(retries).toMatchObject([{ trace: { stage: 'request', step: 4, name: 'TypeError', message: 'Failed to fetch' } }]);
    expect(JSON.stringify(assistant.messages).match(/Done\./g)).toHaveLength(1);
  });

  it('does not ask again when the step the network cut had already called a tool', async () => {
    const { agent, store, prompts, retries } = run(
      [
        toolCall('generate_image', { prompt: 'a' }, 'call_a'),
        recovered('call_b'),
        cutAfter([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'call_c', toolName: 'generate_image', input: JSON.stringify({ prompt: 'c' }) }], bodyCut),
        text('should not run'),
      ],
      [0],
    );
    await agent.send('build it');
    expect(retries).toEqual([]);
    expect(prompts).toHaveLength(3);
    expect(store.current!.turns[0]!.assistant.status).toBe('error');
  });

  it('does not count a step the stream closed after a network error as the connection coming back', async () => {
    const closedAfterCut = (): StreamPart[] => [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Working' },
      { type: 'error', error: new TypeError('network error') },
      { type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage },
    ];
    const { agent, store, retries } = run([closedAfterCut(), closedAfterCut(), closedAfterCut(), closedAfterCut(), text('should not run')], [0, 0, 0]);
    await agent.send('build it');
    expect(retries).toHaveLength(3);
    expect(store.current!.turns[0]!.assistant.status).toBe('error');
  });

  it("describes in its trace the error that ended the reply, not the earlier one", async () => {
    const { agent, store } = run([toolCall('generate_image', { prompt: 'a' }, 'call_a'), recovered('call_b'), toolCall('generate_image', { prompt: 'c' }, 'call_c'), new TypeError('Failed to fetch')], []);
    await agent.send('build it');
    expect(store.current!.turns[0]!.assistant.errorTrace).toMatchObject({
      stage: 'request',
      step: 4,
      name: 'TypeError',
      message: 'Failed to fetch',
      lastTool: { name: 'generate_image', state: 'done' },
    });
  });
});

describe('asking again for a reply that failed (retry)', () => {
  // The agent's own retries off: these are about what asking again does once the reply failed.
  function failed(responses: Parameters<typeof setup>[0]) {
    const made = setup(responses, undefined, {}, { networkRetryDelaysMs: [] });
    const errors: unknown[] = [];
    made.agent.addEventListener('error', (event) => errors.push((event as CustomEvent).detail));
    return { ...made, errors };
  }
  const userMessages = (prompt: unknown) => (prompt as { role: string }[]).filter((message) => message.role === 'user').length;

  it('carries on from the finished steps: their tool is not run again, the message is not sent twice, and they stay on screen', async () => {
    const { agent, store, prompts, generate, seen } = failed([toolCall('generate_image', { prompt: 'a red bike' }), failedToFetch(), text('On its way!')]);
    await agent.send('make a red bike');
    const turn = store.current!.turns[0]!;
    expect(turn.assistant).toMatchObject({ status: 'error', errorKind: 'network', resume: { steps: 1, at: expect.any(Number) } });
    expect(turn.assistant.resume!.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);
    seen.length = 0;

    await agent.retry();
    expect(store.current!.turns).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(3);
    // The request asked again carries the user's message once, and the finished step once, as it was.
    expect(userMessages(prompts[2])).toBe(1);
    expect(callsIn(prompts[2], 'call_1')).toBe(1);
    expect(JSON.stringify(prompts[2])).toContain('gen1-1');
    // The finished step's tool card is on screen from the moment the reply is asked again.
    expect(seen[0]).toMatchObject([{ kind: 'tool', toolCallId: 'call_1', state: 'done' }]);
    expect(turn.assistant.status).toBe('done');
    expect(turn.assistant.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(turn.assistant.resume).toBeUndefined();
  });

  it('counts the finished steps against the step limit, as one reply', async () => {
    configureChat({ maxSteps: 3 });
    try {
      const { agent, store, toolChoices } = failed([toolCall('generate_image', { prompt: 'a' }, 'call_a'), failedToFetch(), toolCall('generate_image', { prompt: 'b' }, 'call_b'), text('Done.')]);
      await agent.send('two bikes');
      await agent.retry();
      // Step 3 of 3 is the last, so it may not call tools: the reply is asked for steps 2 and 3 only.
      expect(toolChoices.slice(2)).toEqual([{ type: 'auto' }, { type: 'none' }]);
      expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'done', ranOut: true });
    } finally {
      delete chatConfig.maxSteps;
    }
  });

  it('has no resume point when the step that failed had called a tool, which may have run', async () => {
    const { agent, store } = failed([
      cutAfter([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'call_1', toolName: 'generate_image', input: JSON.stringify({ prompt: 'a red bike' }) }], bodyCut),
    ]);
    await agent.send('make a red bike');
    expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'error', errorKind: 'network' });
    expect(store.current!.turns[0]!.assistant.resume).toBeUndefined();
  });

  it('has no resume point when a tool call came after the error, to the end of the stream', async () => {
    const { agent, store, generate } = failed([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'error', error: new TypeError('network error') },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'generate_image', input: JSON.stringify({ prompt: 'a red bike' }) },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
      ],
      text('Here it is.'),
    ]);
    await agent.send('make a red bike');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.current!.turns[0]!.assistant.status).toBe('error');
    expect(store.current!.turns[0]!.assistant.resume).toBeUndefined();
  });

  it('carries on past a tool call that came after an earlier error, once a later step was the one cut', async () => {
    const { agent, store, generate, prompts } = failed([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'error', error: new TypeError('network error') },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'generate_image', input: JSON.stringify({ prompt: 'a red bike' }) },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
      ],
      cutAfter([], () => new TypeError('network error')),
      text('On its way!'),
    ]);
    await agent.send('make a red bike');
    // The cut is the later step's, which called nothing; the step that ran the tool finished, so it is kept as it is.
    expect(store.current!.turns[0]!.assistant.resume).toMatchObject({ steps: 1 });
    await agent.retry();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(callsIn(prompts.at(-1), 'call_1')).toBe(1);
    expect(store.current!.turns[0]!.assistant.status).toBe('done');
  });

  it('has a resume point from the start when the very first request failed', async () => {
    const { agent, store, prompts } = failed([failedToFetch(), text('Hello!')]);
    await agent.send('hi');
    expect(store.current!.turns[0]!.assistant.resume).toMatchObject({ messages: [], steps: 0 });
    await agent.retry();
    expect(prompts).toHaveLength(2);
    expect(userMessages(prompts[1])).toBe(1);
    expect(store.current!.turns).toHaveLength(1);
    expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'done', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] }] });
  });

  it('has a resume point when the tools could not be built, before any request', async () => {
    let fail = true;
    const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream(text('Hello!')) as never }) });
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const agent = new Agent({ model: () => model, store, jobs: new JobManager({} as never), toolSet: async () => (fail ? Promise.reject(new Error('MCP listTools timed out')) : {}), attachments: () => [] });
    await agent.send('hello');
    expect(store.current!.turns[0]!.assistant.resume).toMatchObject({ messages: [], steps: 0 });
    fail = false;
    await agent.retry();
    expect(store.current!.turns[0]!.assistant.status).toBe('done');
  });
});
