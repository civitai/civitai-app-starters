import { jsonSchema, tool, type LanguageModel, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { gateToolSet, nextReply, type ChatToolResult } from '../tools/gate.js';
import { AgentCore } from './core.js';
import {
  DISPATCH_AGENT,
  SUBAGENT_PREAMBLE,
  WRITE_UNAVAILABLE,
  dispatchAgentTool,
  resolveSubagents,
  subagentToolNames,
  type ChatSubagents,
  type SubagentResult,
} from './subagents.js';

/**
 * `dispatch_agent` driven by a real parent {@link AgentCore}: the parent and every subagent ask mock
 * models, told apart by the subagent rules in the system prompt, so each test can count exactly which
 * model requests a subagent made (none, for one that was refused).
 */

type StreamPart = Record<string, unknown>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const says = (words: string): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: words },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
/** A step that makes each call (`[toolName, input]`), with ids `<prefix>-<n>`. */
const calls = (prefix: string, ...list: [string, unknown][]): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  ...list.map(([toolName, input], index) => ({ type: 'tool-call', toolCallId: `${prefix}-${index + 1}`, toolName, input: JSON.stringify(input) })),
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];
const dispatch = (...tasks: [string, string?][]) => calls('d', ...tasks.map(([task, mode = 'read']): [string, unknown] => [DISPATCH_AGENT, { task, mode }]));
/** A stream that never ends until the request is aborted. */
const hangs = (signal?: AbortSignal): ReadableStream<StreamPart> =>
  new ReadableStream<StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
    },
  });

type Step = StreamPart[] | Error | ((signal?: AbortSignal) => ReadableStream<StreamPart>);
interface ChildRequest {
  task: string;
  tools: string[];
  toolChoice: unknown;
  system: string;
}

/**
 * A parent reply whose model answers from `parent` in order, and subagents whose model answers by
 * task: `child(task, n)` is the `n`th step (from 1) of the subagent given `task`.
 */
function setup(parent: Step[], child: (task: string, n: number) => Step, options: Partial<ChatSubagents> & { write?: unknown } = {}) {
  const childRequests: ChildRequest[] = [];
  const parentRequests: unknown[] = [];
  const results: ChatToolResult[] = [];
  const ran: string[] = [];
  const byTask = new Map<string, number>();
  const answer = (next: Step | undefined, signal?: AbortSignal) => {
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return { stream: next(signal) as never };
    return { stream: convertArrayToReadableStream(next ?? says('…')) as never };
  };
  const childModel = new MockLanguageModelV3({
    doStream: async (request) => {
      const system = String((request.prompt[0] as { content?: unknown }).content);
      const user = JSON.stringify(request.prompt[1]);
      const task = /Your task:\\n\\n(.*?)"/.exec(user)?.[1] ?? '?';
      childRequests.push({ task, tools: (request.tools ?? []).map((t) => t.name).sort(), toolChoice: request.toolChoice?.type, system });
      const n = (byTask.get(task) ?? 0) + 1;
      byTask.set(task, n);
      let next = child(task, n);
      // As a real provider does: a step asked with tool choice none answers in words.
      if (request.toolChoice?.type === 'none' && Array.isArray(next) && next.some((part) => part.type === 'tool-call')) next = says('Out of steps: here is what I found.');
      return answer(next, request.abortSignal);
    },
  });
  const queue = [...parent];
  const parentModel = new MockLanguageModelV3({
    doStream: async (request) => {
      parentRequests.push(request.prompt);
      return answer(queue.shift(), request.abortSignal);
    },
  });
  const read = (name: string) =>
    tool({
      inputSchema: jsonSchema<{ path?: string }>({ type: 'object', properties: { path: { type: 'string' } } }),
      execute: async ({ path }) => (ran.push(`${name}:${path ?? ''}`), { text: `contents of ${path}` }),
    });
  const raw: ToolSet = {
    read_file: read('read_file'),
    list_dir: read('list_dir'),
    write_file: read('write_file'),
    // Fails (an error output, as an MCP tool's failure reads) for a path with "fail" in it.
    edit_file: tool({
      inputSchema: jsonSchema<{ path?: string }>({ type: 'object', properties: { path: { type: 'string' } } }),
      execute: async ({ path }) => (ran.push(`edit_file:${path ?? ''}`), path?.includes('fail') ? { error: 'The text to replace was not found.' } : { edited: true }),
    }),
    // Its path is under `target`, not `path`.
    delete_path: tool({
      inputSchema: jsonSchema<{ target?: string }>({ type: 'object', properties: { target: { type: 'string' } } }),
      execute: async ({ target }) => (ran.push(`delete_path:${target ?? ''}`), { deleted: true }),
    }),
    // Throws: the call never gives a result.
    boom: tool({
      inputSchema: jsonSchema<{ path?: string }>({ type: 'object', properties: { path: { type: 'string' } } }),
      execute: async ({ path }): Promise<{ written: true }> => {
        ran.push(`boom:${path ?? ''}`);
        throw new Error('disk full');
      },
    }),
    run_command: tool({
      inputSchema: jsonSchema<{ command?: string }>({ type: 'object', properties: { command: { type: 'string' } } }),
      execute: async ({ command }) => (ran.push(`run_command:${command ?? ''}`), command === 'false' ? { error: 'exit code 1' } : { stdout: 'ok' }),
    }),
    ask_choice: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ shown: true, awaitsUser: true }) }),
    // A page tool that hands the next move to the viewer, as an ask panel does.
    confirm: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => (ran.push('confirm:'), { shown: true, awaitsUser: true }) }),
  };
  const resolved = resolveSubagents({ tools: ['read_file', 'list_dir'], ...options } as ChatSubagents)!;
  const reply = nextReply();
  const gate = { conversationId: 'c1', reply, onResult: (result: ChatToolResult) => results.push(result) };
  const tools: ToolSet = {
    ...raw,
    [DISPATCH_AGENT]: dispatchAgentTool({
      options: resolved,
      tools: raw,
      gate: (childTools, subagent) => gateToolSet(childTools, { ...gate, subagent }),
      model: () => childModel as LanguageModel,
      maxOutputTokens: () => 1_000,
      networkRetryDelaysMs: [0, 0, 0],
    }),
  };
  const core = new AgentCore();
  const run = () =>
    core.run({
      seq: 1,
      tools: async () => gateToolSet(tools, gate),
      request: () => ({ model: parentModel, system: 'You are the parent.', history: [{ role: 'user', content: 'go' }], maxOutputTokens: 1_000, networkRetryDelaysMs: [0, 0, 0] }),
    });
  /** What each `dispatch_agent` call gave back, by call id. */
  const dispatched = () => new Map(results.filter((r) => r.name === DISPATCH_AGENT).map((r) => [(r.input as { task: string }).task, r.output as SubagentResult & { error?: string }]));
  const requestsFor = (task: string) => childRequests.filter((r) => r.task === task).length;
  return { core, run, childRequests, parentRequests, results, ran, dispatched, requestsFor };
}

describe('dispatch_agent: what it refuses, before any subagent runs', () => {
  it('refuses mode "write" with a clear error, and asks no subagent model anything', async () => {
    const t = setup([dispatch(['edit the readme', 'write']), says('ok')], () => says('should not run'));
    await t.run();
    expect(t.dispatched().get('edit the readme')).toEqual({ kind: 'subagent', error: WRITE_UNAVAILABLE, note: expect.any(String) });
    expect(WRITE_UNAVAILABLE).toBe('write subagents are not available yet');
    expect(t.childRequests).toHaveLength(0);
    // Positive control: the same call with mode "read" does ask a subagent model.
    const control = setup([dispatch(['read the readme']), says('ok')], () => says('found it'));
    await control.run();
    expect(control.requestsFor('read the readme')).toBe(1);
  });

  it('refuses the 4th subagent running at once, and runs nothing for it', async () => {
    // Each subagent waits until all four calls were decided, so three are running when the 4th comes.
    let release!: () => void;
    const decided = new Promise<void>((resolve) => (release = resolve));
    const t = setup([dispatch(['t1'], ['t2'], ['t3'], ['t4']), says('ok')], () => () =>
      new ReadableStream<StreamPart>({
        async start(controller) {
          await decided;
          for (const part of says('done')) controller.enqueue(part);
          controller.close();
        },
      }),
    );
    const running = t.run();
    await vi.waitFor(() => expect(t.dispatched().has('t4')).toBe(true));
    release();
    await running;
    const out = t.dispatched();
    expect(out.get('t4')).toEqual({ kind: 'subagent', error: '3 subagents are already running, the most at once. Dispatch this after one returns.', note: expect.any(String) });
    expect(['t1', 't2', 't3'].map((task) => out.get(task)?.status)).toEqual(['done', 'done', 'done']);
    expect(t.requestsFor('t4')).toBe(0);
    expect(t.childRequests.map((r) => r.task).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('refuses the 9th subagent of one reply, and runs nothing for it', async () => {
    const t = setup([dispatch(['a1'], ['a2'], ['a3']), dispatch(['b1'], ['b2'], ['b3']), dispatch(['c1'], ['c2'], ['c3']), says('ok')], () => says('done'));
    await t.run();
    const out = t.dispatched();
    expect(out.get('c3')).toEqual({ kind: 'subagent', error: 'This reply already started 8 subagents, the most one reply may.', note: expect.any(String) });
    expect(t.requestsFor('c3')).toBe(0);
    expect(t.childRequests).toHaveLength(8);
  });

  it('takes the page’s caps over the defaults', async () => {
    const t = setup([dispatch(['p1'], ['p2']), dispatch(['p3']), says('ok')], () => says('done'), { maxLive: 1, maxPerReply: 2 });
    await t.run();
    const out = t.dispatched();
    expect(out.get('p1')?.status).toBe('done');
    expect(out.get('p2')?.error).toBe('1 subagents are already running, the most at once. Dispatch this after one returns.');
    expect(out.get('p3')?.status).toBe('done');
    expect(t.childRequests.map((r) => r.task)).toEqual(['p1', 'p3']);
    // The per-reply cap counts started subagents only: p2 was refused, so p3 is the 2nd.
  });
});

describe('a subagent’s own caps', () => {
  it('takes 30 steps at most: the 30th is asked for words (tool choice none), and it ends ran_out', async () => {
    const t = setup([dispatch(['dig']), says('ok')], (_task, n) => calls(`s${n}`, ['read_file', { path: `/f${n}` }]));
    await t.run();
    const asked = t.childRequests.filter((r) => r.task === 'dig');
    expect(asked).toHaveLength(30);
    expect(asked.slice(0, 29).every((r) => r.toolChoice === 'auto')).toBe(true);
    expect(asked[29]!.toolChoice).toBe('none');
    expect(asked[29]!.system).toContain('This is your last step');
    expect(t.dispatched().get('dig')).toMatchObject({ status: 'ran_out', steps: 30, toolCalls: 29, summary: 'Out of steps: here is what I found.' });
  });

  it('ends at its 41st tool call: that call and the ones after it do not run, and one last step in words gives its summary', async () => {
    // 10 calls a step: the 5th step holds calls 41 to 50.
    const t = setup([dispatch(['many']), says('ok')], (_task, n) =>
      calls(`m${n}`, ...Array.from({ length: 10 }, (_, i): [string, unknown] => ['read_file', { path: `/s${n}/f${i}` }])),
    );
    await t.run();
    expect(t.ran).toHaveLength(40);
    expect(t.ran.at(-1)).toBe('read_file:/s4/f9');
    // One more step, in words only, so the parent gets what it found.
    const asked = t.childRequests.filter((r) => r.task === 'many');
    expect(asked).toHaveLength(6);
    expect(asked.map((r) => r.toolChoice)).toEqual(['auto', 'auto', 'auto', 'auto', 'auto', 'none']);
    expect(asked[5]!.system).toContain('This is your last step');
    expect(t.dispatched().get('many')).toMatchObject({ status: 'ran_out', toolCalls: 40, steps: 6, summary: 'Out of steps: here is what I found.' });
    // The activity log is the calls' tools and paths only, capped at 50 (40 here).
    expect(t.dispatched().get('many')!.activity).toHaveLength(40);
    expect(t.dispatched().get('many')!.activity[0]).toEqual({ tool: 'read_file', arg: '/s1/f0' });
  });

  it('takes the page’s step and call caps over the defaults', async () => {
    const t = setup([dispatch(['few']), says('ok')], (_task, n) => calls(`f${n}`, ['read_file', { path: `/f${n}` }], ['list_dir', { path: `/d${n}` }]), { maxSteps: 7, maxToolCalls: 11 });
    await t.run();
    // 2 calls a step: the 6th step holds calls 11 and 12, so 11 run, the 12th ends it, and a 7th step is in words.
    expect(t.ran).toHaveLength(11);
    expect(t.requestsFor('few')).toBe(7);
    expect(t.dispatched().get('few')).toMatchObject({ status: 'ran_out', toolCalls: 11 });
  });

  it('keeps the activity log to 50 entries', async () => {
    const t = setup([dispatch(['wide']), says('ok')], (_task, n) => (n <= 7 ? calls(`w${n}`, ...Array.from({ length: 9 }, (_, i): [string, unknown] => ['list_dir', { path: `/w${n}/${i}` }])) : says('found')), { maxToolCalls: 100 });
    await t.run();
    expect(t.dispatched().get('wide')).toMatchObject({ status: 'done', toolCalls: 63 });
    expect(t.dispatched().get('wide')!.activity).toHaveLength(50);
  });
});

describe('what a subagent gives back', () => {
  it('returns its final words cut to 4,000 characters, its counts and activity, and never its transcript', async () => {
    const words = Array.from({ length: 4_100 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
    const t = setup([dispatch(['summarise']), says('ok')], (_task, n) => (n === 1 ? calls('r', ['read_file', { path: '/secret.txt' }]) : says(words)));
    await t.run();
    const out = t.dispatched().get('summarise')!;
    expect(out.summary).toBe(words.slice(0, 4_000));
    expect(out.summary).toHaveLength(4_000);
    expect(out).toEqual({ kind: 'subagent', status: 'done', summary: words.slice(0, 4_000), steps: 2, toolCalls: 1, activity: [{ tool: 'read_file', arg: '/secret.txt' }] });
    // The tool's output stayed in the subagent: the parent never sees it.
    expect(JSON.stringify(out)).not.toContain('contents of');
  });

  it('keeps final words of exactly 4,000 characters whole', async () => {
    const words = 'x'.repeat(3_999) + 'y';
    const t = setup([dispatch(['exact']), says('ok')], () => says(words));
    await t.run();
    expect(t.dispatched().get('exact')!.summary).toBe(words);
  });

  it('asks the subagent with only the task, the subagent rules in its system prompt, and its allowlisted tools', async () => {
    const t = setup([dispatch(['look around']), says('ok')], () => says('done'), { instructions: 'Report paths relative to the app.' });
    await t.run();
    const [first] = t.childRequests;
    expect(first!.tools).toEqual(['list_dir', 'read_file']);
    expect(first!.system).toContain(SUBAGENT_PREAMBLE);
    expect(first!.system).toContain('Report paths relative to the app.');
  });
});

describe('a tool that waits for the viewer', () => {
  it('comes back to a subagent as an error when the page allowed it, and does not end the subagent', async () => {
    const t = setup([dispatch(['ask them']), says('ok')], (_task, n) => (n === 1 ? calls('c', ['confirm', {}]) : says('could not ask')), { tools: ['confirm'] });
    await t.run();
    expect(t.ran).toEqual(['confirm:']);
    expect(t.requestsFor('ask them')).toBe(2);
    expect(t.dispatched().get('ask them')).toMatchObject({ status: 'done', summary: 'could not ask', steps: 2 });
  });
});

describe('stopping and retrying', () => {
  it('stops every running subagent when the parent is stopped, and asks their models nothing more', async () => {
    const t = setup([dispatch(['s1'], ['s2']), says('ok')], (_task, n) => (n === 1 ? calls('x', ['read_file', { path: '/a' }]) : hangs));
    const running = t.run();
    await vi.waitFor(() => expect(t.childRequests).toHaveLength(4));
    t.core.abort();
    const outcome = await running;
    expect(outcome?.status).toBe('aborted');
    await vi.waitFor(() => expect(t.dispatched().size).toBe(2));
    expect([...t.dispatched().values()].map((out) => out.status)).toEqual(['stopped', 'stopped']);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(t.childRequests).toHaveLength(4);
    expect(t.ran).toEqual(['read_file:/a', 'read_file:/a']);
  });

  it('asks a subagent’s step that the network cut, having called no tool, again once, and only once', async () => {
    const drop = () => new TypeError('Failed to fetch');
    const once = setup([dispatch(['flaky']), says('ok')], (_task, n) => (n === 1 ? drop() : says('found it')));
    await once.run();
    expect(once.requestsFor('flaky')).toBe(2);
    expect(once.dispatched().get('flaky')).toMatchObject({ status: 'done', summary: 'found it' });

    const twice = setup([dispatch(['flakier']), says('ok')], (_task, n) => (n <= 2 ? drop() : says('found it')));
    await twice.run();
    expect(twice.requestsFor('flakier')).toBe(2);
    expect(twice.dispatched().get('flakier')).toMatchObject({ status: 'error', error: expect.any(String) });
  });

  // An invariant guard on the core's no-double-run rule, which already covers dispatch_agent as a tool.
  // The SDK runs a step's tools only after its finish chunk, so the cut call never ran here; it is still
  // not asked again, since a provider or SDK could run one sooner.
  it('never asks again for a parent step that called dispatch_agent when the network cut it, so no subagent runs twice', async () => {
    const cut = (): ReadableStream<StreamPart> => {
      const queue = [...dispatch(['once']).slice(0, 2)];
      return new ReadableStream<StreamPart>({ pull: (controller) => (queue.length ? controller.enqueue(queue.shift()!) : controller.error(new TypeError('Failed to fetch'))) }, { highWaterMark: 0 });
    };
    const t = setup([cut, says('should not be asked')], () => says('found'));
    const outcome = await t.run();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(outcome?.status).toBe('error');
    expect(t.parentRequests).toHaveLength(1);
    expect(t.requestsFor('once')).toBeLessThanOrEqual(1);
  });
});

describe('which tools a subagent gets', () => {
  const available = Object.fromEntries(['a', 'b', 'c', DISPATCH_AGENT, 'ask_choice', 'open_panel', 'update_panel'].map((name) => [name, {}])) as ToolSet;

  it('gets exactly the allowlisted tools this reply has, never dispatch_agent or one that waits for the viewer', () => {
    expect(subagentToolNames(['b', 'a', 'missing', DISPATCH_AGENT, 'ask_choice', 'open_panel', 'update_panel', 'a'], available)).toEqual(['b', 'a']);
    expect(subagentToolNames([], available)).toEqual([]);
  });

  it('is off without the option or with an empty allowlist, and keeps caps in bounds', () => {
    expect(resolveSubagents(undefined)).toBeUndefined();
    expect(resolveSubagents({ tools: [] })).toBeUndefined();
    expect(resolveSubagents({ tools: ['a'] })).toEqual({ tools: ['a'], maxLive: 3, maxPerReply: 8, maxSteps: 30, maxToolCalls: 40 });
    expect(resolveSubagents({ tools: ['a'], maxLive: 99, maxPerReply: 0, maxSteps: 2.6, maxToolCalls: Number.NaN, model: ' m ' })).toEqual({
      tools: ['a'],
      model: 'm',
      maxLive: 10,
      maxPerReply: 1,
      maxSteps: 3,
      maxToolCalls: 40,
    });
  });
});

describe('write subagents', () => {
  /** The page's write opt-in: an allowlist (hard exclusions and a missing tool listed too), its file tools and its command tool. */
  const WRITE = {
    tools: ['read_file', 'write_file', 'edit_file', 'delete_path', 'boom', 'run_command', 'ask_choice', DISPATCH_AGENT, 'not_there'],
    instructions: 'Keep to the game folder.',
    files: { write_file: { op: 'write' }, edit_file: { op: 'edit' }, boom: { op: 'write' }, delete_path: { op: 'delete', path: (input: unknown) => (input as { target?: string }).target } },
    commands: ['run_command'],
  };
  /** The write rules a write subagent gets, pinned whole: a reworded rule fails here. */
  const WRITE_PREAMBLE = [
    'You are a subagent. Another assistant gave you the task in the user message and reads what you return; the user never sees your words.',
    '- You cannot talk to the user or ask anyone anything. Do not ask questions: decide, or say what you could not do.',
    '- You may edit files and run commands to do the task. Do only the task.',
    '- Another subagent may be editing files at the same time: keep each edit small, and read a file again right before you edit it.',
    '- Finish with, in at most 200 words: what you changed, what you ran, and what you could not do.',
  ].join('\n');
  const out = (t: ReturnType<typeof setup>, task: string) => t.dispatched().get(task) as unknown as Record<string, unknown> | undefined;

  // An invariant guard: S1 refused every write dispatch, and these pages still have no usable write opt-in.
  it.each([
    ['no write opt-in, write tools in the read allowlist', { tools: ['read_file', 'write_file', 'run_command'] }],
    ['an empty write allowlist', { write: { tools: [] } }],
    ['none of the write tools there this reply', { write: { tools: ['not_there'] } }],
  ])('refuses mode "write" with %s, and asks no subagent model anything', async (_name, options) => {
    const t = setup([dispatch(['edit the readme', 'write']), says('ok')], () => says('should not run'), options);
    await t.run();
    expect(t.dispatched().get('edit the readme')).toEqual({ kind: 'subagent', error: WRITE_UNAVAILABLE, note: expect.any(String) });
    expect(t.childRequests).toHaveLength(0);
    expect(t.ran).toEqual([]);
  });

  it('gives a write subagent exactly its write allowlist (no dispatch_agent, no ask_choice, even when listed), and a read subagent still only the read one', async () => {
    const t = setup([dispatch(['fix it', 'write'], ['look', 'read']), says('ok')], () => says('done'), { write: WRITE });
    await t.run();
    expect(t.childRequests.find((r) => r.task === 'fix it')?.tools).toEqual(['boom', 'delete_path', 'edit_file', 'read_file', 'run_command', 'write_file']);
    expect(t.childRequests.find((r) => r.task === 'look')?.tools).toEqual(['list_dir', 'read_file']);
    expect(t.childRequests).toHaveLength(2);
  });

  it('lists in changed only the files its file tools changed, read from their successful results, never from its words', async () => {
    const t = setup(
      [dispatch(['fix it', 'write']), says('ok')],
      (_task, n) =>
        n === 1
          ? calls('w', ['write_file', { path: 'src/a.ts' }], ['edit_file', { path: 'src/fail.ts' }], ['boom', { path: 'src/boom.ts' }], ['delete_path', { target: 'old.ts' }], ['write_file', { path: 'src/a.ts' }], ['read_file', { path: 'src/read.ts' }])
          : says('I changed src/a.ts, src/fail.ts, src/boom.ts, src/read.ts and src/claimed.ts.'),
      { write: WRITE },
    );
    await t.run();
    // Every call ran: the failed edit, the throw and the read are left out for how they went, not because they never ran.
    expect([...t.ran].sort()).toEqual(['boom:src/boom.ts', 'delete_path:old.ts', 'edit_file:src/fail.ts', 'read_file:src/read.ts', 'write_file:src/a.ts', 'write_file:src/a.ts']);
    const result = out(t, 'fix it');
    expect(result).toMatchObject({ kind: 'subagent', mode: 'write', status: 'done', ranCommands: 0 });
    expect([...((result?.changed ?? []) as { path: string; op: string }[])].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'old.ts', op: 'delete' },
      { path: 'src/a.ts', op: 'write' },
    ]);
    expect(JSON.stringify(result?.changed)).not.toContain('claimed');
  });

  it('counts the commands it ran in ranCommands, failed ones included, and lists none of them in changed', async () => {
    const t = setup([dispatch(['test it', 'write']), says('ok')], (_task, n) => (n === 1 ? calls('c', ['run_command', { command: 'npm test' }], ['run_command', { command: 'false' }]) : says('Ran the tests.')), { write: WRITE });
    await t.run();
    expect(t.ran).toEqual(['run_command:npm test', 'run_command:false']);
    const result = out(t, 'test it');
    expect(result).toMatchObject({ kind: 'subagent', mode: 'write', status: 'done', summary: 'Ran the tests.', steps: 2, toolCalls: 2, changed: [], ranCommands: 2 });
    expect(Object.keys(result ?? {}).sort()).toEqual(['activity', 'changed', 'kind', 'mode', 'ranCommands', 'status', 'steps', 'summary', 'toolCalls']);
  });

  it('reports each of a write subagent’s calls to the page, marked with its dispatch_agent call id', async () => {
    const t = setup([dispatch(['fix it', 'write']), says('ok')], (_task, n) => (n === 1 ? calls('w', ['write_file', { path: 'src/a.ts' }]) : says('done')), { write: WRITE });
    await t.run();
    expect(t.results.filter((r) => r.name === 'write_file')).toEqual([expect.objectContaining({ name: 'write_file', input: { path: 'src/a.ts' }, isError: false, subagent: 'd-1' })]);
  });

  it('asks a write subagent with the write rules and the page’s write instructions, and a read one as before', async () => {
    const t = setup([dispatch(['fix it', 'write'], ['look', 'read']), says('ok')], () => says('done'), { instructions: 'Report paths relative to the app.', write: WRITE });
    await t.run();
    const writer = t.childRequests.find((r) => r.task === 'fix it')?.system;
    expect(writer).toContain(WRITE_PREAMBLE);
    expect(writer).toContain('Keep to the game folder.');
    expect(writer).not.toContain('Stay read-only');
    expect(writer).not.toContain('Report paths relative to the app.');
    const reader = t.childRequests.find((r) => r.task === 'look')?.system;
    expect(reader).toContain(SUBAGENT_PREAMBLE);
    expect(reader).toContain('Report paths relative to the app.');
    expect(reader).not.toContain('Keep to the game folder.');
  });

  it('leaves a read subagent’s result exactly as before when the page also opted in to write subagents', async () => {
    const t = setup([dispatch(['look', 'read']), says('ok')], (_task, n) => (n === 1 ? calls('r', ['read_file', { path: '/a' }]) : says('found')), { write: WRITE });
    await t.run();
    expect(t.dispatched().get('look')).toEqual({ kind: 'subagent', status: 'done', summary: 'found', steps: 2, toolCalls: 1, activity: [{ tool: 'read_file', arg: '/a' }] });
  });
});
