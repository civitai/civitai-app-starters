import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatSubagents } from './agent/subagents.js';
import type { ChatBackend } from './backend.js';
import { ChatSession, type SessionOptions } from './session.js';
import type { ChatToolGateContext, ChatToolResult } from './tools/gate.js';
import { fakeMcpServers } from './test-support/fake-mcp.js';
import { completion, memoryStore, sse, textReply } from './test-support/fake-backend.js';

/**
 * Subagents through the whole session, on a host backend: the page's options, its gate and its
 * `tool-result` event, the reply's tools, and the model requests the parent and its subagents make,
 * told apart by the subagent rules in the system prompt.
 */

const GATEWAY = 'https://host.example/api/llm';
const SANDBOX = 'https://sandbox.example/mcp';
const turn = { conversationId: 'c1', seq: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Body {
  model?: string;
  messages: { role: string; content?: unknown }[];
  tools?: { function: { name: string } }[];
  stream?: boolean;
}

const chunk = (delta: unknown, finish: string | null) => ({ id: 't', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });
/** A reply that makes every call in one step (`[id, name, args]`). */
const callsReply = (...calls: [string, string, unknown][]) =>
  sse(
    chunk({ role: 'assistant', tool_calls: calls.map(([id, name, args], index) => ({ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }, null),
    chunk({}, 'tool_calls'),
  );

const isChild = (body: Body) => String(body.messages[0]?.content ?? '').includes('You are a subagent.');
const taskOf = (body: Body) => /Your task:\n\n([\s\S]*)$/.exec(String(body.messages.find((message) => message.role === 'user')?.content ?? ''))?.[1];

function setup(options: Partial<SessionOptions> & { parent?: (() => Response)[]; child?: (task: string, n: number) => Response } = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const ran: string[] = [];
  const sandboxTool = (name: string) => ({ name, run: (args: Record<string, unknown>) => (ran.push(`${name}:${String(args.path)}`), { content: [{ type: 'text' as const, text: `${name} ${String(args.path)}` }] }) });
  const mcp = fakeMcpServers({ [SANDBOX]: [sandboxTool('read_file'), sandboxTool('list_dir'), sandboxTool('write_file')] });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => mcp.fetch(input, init)));
  const parentBodies: Body[] = [];
  const childBodies: Body[] = [];
  const steps = new Map<string, number>();
  const queue = [...(options.parent ?? [])];
  const backend: ChatBackend = {
    url: GATEWAY,
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Body;
      if (!body.stream) return completion('A title');
      if (isChild(body)) {
        childBodies.push(body);
        const task = taskOf(body) ?? '?';
        const n = (steps.get(task) ?? 0) + 1;
        steps.set(task, n);
        return options.child?.(task, n) ?? textReply('found nothing');
      }
      parentBodies.push(body);
      return queue.shift()?.() ?? textReply('(no more replies)');
    },
    model: 'host/default-model',
    models: [],
    store: memoryStore(),
  };
  const { parent: _parent, child: _child, ...rest } = options;
  const session = new ChatSession(null, {
    backend,
    mcp: () => ({ mcpServers: [{ id: 'sandbox', url: SANDBOX, token: () => 'tok' }] }),
    hostTools: () => ({ pin: { description: 'Pin it', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, execute: ({ path }) => (ran.push(`pin:${String(path)}`), { pinned: true }) } }),
    ...rest,
  });
  return { session, parentBodies, childBodies, ran };
}

const names = async (session: ChatSession) => Object.keys(await session.toolSet(turn)).sort();

describe('subagents are opt-in', () => {
  it('offers no dispatch_agent without the option, with an empty allowlist, or with none of the listed tools there; the tools are otherwise the same', async () => {
    const off = await names(setup().session);
    expect(off).not.toContain('dispatch_agent');
    expect(off).toEqual(expect.arrayContaining(['sandbox__read_file', 'sandbox__write_file', 'pin', 'ask_choice']));
    for (const subagents of [undefined, { tools: [] }, { tools: ['not_there', 'dispatch_agent', 'ask_choice'] }] as (ChatSubagents | undefined)[]) {
      expect(await names(setup({ subagents: () => subagents }).session)).toEqual(off);
    }
    // Positive control: one listed tool that is there turns it on, and adds only dispatch_agent.
    expect(await names(setup({ subagents: () => ({ tools: ['sandbox__read_file'] }) }).session)).toEqual([...off, 'dispatch_agent'].sort());
  });

  it('keeps dispatch_agent its own when on: a page tool of that name is skipped then, and kept when off', async () => {
    const pageTool = { description: 'mine', inputSchema: { type: 'object' }, execute: () => ({ page: true }) };
    const off = setup({ hostTools: () => ({ dispatch_agent: pageTool }) });
    expect(await (await off.session.toolSet(turn)).dispatch_agent!.execute!({}, { toolCallId: 'x', messages: [] })).toEqual({ page: true });
    const on = setup({ hostTools: () => ({ dispatch_agent: pageTool }), subagents: () => ({ tools: ['sandbox__read_file'] }) });
    expect(await (await on.session.toolSet(turn)).dispatch_agent!.execute!({ task: 'x', mode: 'write' }, { toolCallId: 'x', messages: [] })).toMatchObject({ error: 'write subagents are not available yet' });
  });
});

describe('write subagents through the session', () => {
  const dispatchDescription = (body: Body | undefined) =>
    String((body?.tools?.find((tool) => tool.function.name === 'dispatch_agent')?.function as { description?: string } | undefined)?.description ?? '');

  // An invariant guard: without a write opt-in, a write dispatch is refused as in S1.
  it('refuses mode "write" without the write opt-in, with write tools in the read allowlist: no subagent request, nothing run', async () => {
    const { session, childBodies, ran, parentBodies } = setup({
      subagents: () => ({ tools: ['sandbox__read_file', 'sandbox__write_file'] }),
      parent: [() => callsReply(['d1', 'dispatch_agent', { task: 'edit it', mode: 'write' }]), () => textReply('ok')],
    });
    session.newConversation();
    await session.send('go');
    expect(childBodies).toHaveLength(0);
    expect(ran).toEqual([]);
    const turn = session.store.current!.turns[0]!;
    const result = turn.assistant.messages.flatMap((m) => (m.role === 'tool' ? m.content : [])).find((part) => part.type === 'tool-result' && part.toolCallId === 'd1');
    expect((result as { output: { value: unknown } }).output.value).toMatchObject({ kind: 'subagent', error: 'write subagents are not available yet' });
    // The tool tells the assistant only read is available.
    expect(dispatchDescription(parentBodies[0])).toContain('mode must be "read"');
  });

  it('offers dispatch_agent when the page allows only write subagents', async () => {
    const off = await names(setup().session);
    const subagents = { tools: [], write: { tools: ['sandbox__write_file'] } } as unknown as ChatSubagents;
    expect(await names(setup({ subagents: () => subagents }).session)).toEqual([...off, 'dispatch_agent'].sort());
  });

  it('runs a write subagent with its write allowlist; its file writes reach tool-result marked with the dispatch, and come back in changed', async () => {
    const subagents = {
      tools: ['sandbox__read_file'],
      write: { tools: ['sandbox__read_file', 'sandbox__write_file', 'ask_choice', 'dispatch_agent'], files: { sandbox__write_file: { op: 'write' } } },
    } as unknown as ChatSubagents;
    const { session, childBodies, parentBodies, ran } = setup({
      subagents: () => subagents,
      parent: [() => callsReply(['d1', 'dispatch_agent', { task: 'edit the app', mode: 'write' }]), () => textReply('Edited.')],
      child: (_task, n) => (n === 1 ? callsReply(['w1', 'sandbox__write_file', { path: '/src/a.ts' }]) : textReply('Changed /src/a.ts and /src/b.ts.')),
    });
    const results: ChatToolResult[] = [];
    session.addEventListener('tool-result', (event) => results.push((event as CustomEvent<ChatToolResult>).detail));
    session.newConversation();
    await session.send('go');
    expect(childBodies[0]!.tools!.map((tool) => tool.function.name).sort()).toEqual(['sandbox__read_file', 'sandbox__write_file']);
    expect(ran).toEqual(['write_file:/src/a.ts']);
    // The page sees the write (its checks can be cleared), marked as the subagent's.
    expect(results.filter((r) => r.name === 'sandbox__write_file')).toEqual([expect.objectContaining({ isError: false, subagent: 'd1' })]);
    const turn = session.store.current!.turns[0]!;
    const result = turn.assistant.messages.flatMap((m) => (m.role === 'tool' ? m.content : [])).find((part) => part.type === 'tool-result' && part.toolCallId === 'd1');
    expect((result as { output: { value: unknown } }).output.value).toMatchObject({ kind: 'subagent', mode: 'write', status: 'done', changed: [{ path: '/src/a.ts', op: 'write' }], ranCommands: 0 });
    expect(dispatchDescription(parentBodies[0])).toContain('"write"');
    expect(dispatchDescription(parentBodies[0])).toContain('ranCommands');
  });
});

describe('a subagent’s tools', () => {
  it('are exactly the allowlisted ones this reply has: never dispatch_agent or ask_choice, even when listed, and no tool that is not listed', async () => {
    const { session, childBodies, parentBodies } = setup({
      subagents: () => ({ tools: ['sandbox__read_file', 'sandbox__list_dir', 'pin', 'ask_choice', 'dispatch_agent', 'not_there'] }),
      parent: [() => callsReply(['d1', 'dispatch_agent', { task: 'map the app', mode: 'read' }]), () => textReply('Mapped.')],
    });
    session.newConversation();
    await session.send('go');
    expect(childBodies).toHaveLength(1);
    expect(childBodies[0]!.tools!.map((tool) => tool.function.name).sort()).toEqual(['pin', 'sandbox__list_dir', 'sandbox__read_file']);
    // The parent had more: write_file, ask_choice and dispatch_agent stay with it.
    expect(parentBodies[0]!.tools!.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['sandbox__write_file', 'ask_choice', 'dispatch_agent']));
  });

  it('ask the reply’s own model unless the page names one', async () => {
    const run = async (subagents: ChatSubagents) => {
      const t = setup({ subagents: () => subagents, parent: [() => callsReply(['d1', 'dispatch_agent', { task: 'look', mode: 'read' }]), () => textReply('ok')] });
      t.session.newConversation();
      await t.session.send('go');
      return t.childBodies.map((body) => body.model);
    };
    expect(await run({ tools: ['sandbox__read_file'] })).toEqual(['host/default-model']);
    expect(await run({ tools: ['sandbox__read_file'], model: 'host/cheap-model' })).toEqual(['host/cheap-model']);
  });
});

describe('telling a subagent’s calls from the reply’s own', () => {
  it('marks each subagent call with its dispatch_agent call id, at the gate and on tool-result, so a per-reply count can leave them out', async () => {
    const gated: { name: string; context: ChatToolGateContext }[] = [];
    // The page's per-reply budget, fed only the reply's own calls; it would end the reply at its 6th.
    const LIMIT = 5;
    const counted = new Map<number, number>();
    const { session, ran } = setup({
      subagents: () => ({ tools: ['sandbox__read_file'] }),
      beforeToolCall: () => (name, _input, context) => {
        gated.push({ name, context });
        if (context.subagent !== undefined) return { allow: true };
        const calls = (counted.get(context.reply) ?? 0) + 1;
        counted.set(context.reply, calls);
        return calls <= LIMIT ? { allow: true } : { refuse: 'Budget used.', stop: true };
      },
      // The reply: 3 reads and a dispatch in one step (4 calls of its own), then words.
      parent: [
        () => callsReply(['p1', 'sandbox__read_file', { path: '/a' }], ['p2', 'sandbox__read_file', { path: '/b' }], ['p3', 'sandbox__read_file', { path: '/c' }], ['d1', 'dispatch_agent', { task: 'read seven', mode: 'read' }]),
        () => textReply('All read.'),
      ],
      // The subagent: 7 reads, one a step, then words.
      child: (_task, n) => (n <= 7 ? callsReply([`s${n}`, 'sandbox__read_file', { path: `/s${n}` }]) : textReply('Read seven files.')),
    });
    const results: ChatToolResult[] = [];
    session.addEventListener('tool-result', (event) => results.push((event as CustomEvent<ChatToolResult>).detail));
    session.newConversation();
    await session.send('go');

    const reply = gated[0]!.context.reply;
    const own = gated.filter((g) => g.context.subagent === undefined);
    const child = gated.filter((g) => g.context.subagent !== undefined);
    expect(own.map((g) => g.name)).toEqual(['sandbox__read_file', 'sandbox__read_file', 'sandbox__read_file', 'dispatch_agent']);
    expect(child).toHaveLength(7);
    expect(child.every((g) => g.context.subagent === 'd1' && g.context.reply === reply)).toBe(true);
    expect([...counted.values()]).toEqual([4]);
    // The same split on tool-result: the subagent's results are seen, and marked.
    expect(results.filter((r) => r.subagent === 'd1')).toHaveLength(7);
    expect(results.filter((r) => r.subagent === undefined).map((r) => r.name)).toEqual(expect.arrayContaining(['dispatch_agent']));
    expect(results.filter((r) => r.subagent === undefined)).toHaveLength(4);
    // The page's budget never tripped: every call ran, and the reply ended as done.
    expect(ran).toHaveLength(10);
    expect(session.store.current!.turns[0]!.assistant).toMatchObject({ status: 'done' });
    expect(session.store.current!.turns[0]!.assistant.stopped).toBeUndefined();
  });

  it('ends only the subagent when the page answers one of its calls with stop: true; the reply carries on', async () => {
    const { session, ran, childBodies } = setup({
      subagents: () => ({ tools: ['sandbox__read_file'] }),
      beforeToolCall: () => (_name, input, { subagent }) => (subagent !== undefined && (input as { path?: string }).path === '/s2' ? { refuse: 'No more.', stop: true } : { allow: true }),
      parent: [() => callsReply(['d1', 'dispatch_agent', { task: 'read on', mode: 'read' }]), () => callsReply(['p1', 'sandbox__read_file', { path: '/after' }]), () => textReply('Done.')],
      child: (_task, n) => callsReply([`s${n}`, 'sandbox__read_file', { path: `/s${n}` }]),
    });
    session.newConversation();
    await session.send('go');
    const turn = session.store.current!.turns[0]!;
    const result = turn.assistant.messages.flatMap((m) => (m.role === 'tool' ? m.content : [])).find((part) => part.type === 'tool-result' && part.toolCallId === 'd1');
    expect((result as { output: { value: unknown } }).output.value).toMatchObject({ status: 'ran_out', toolCalls: 2 });
    expect(childBodies).toHaveLength(2);
    // The reply's own later call still ran, and the reply ended as done, not ended by the page.
    expect(ran).toEqual(['read_file:/s1', 'read_file:/after']);
    expect(turn.assistant).toMatchObject({ status: 'done' });
    expect(turn.assistant.stopped).toBeUndefined();
  });

  it('stops every subagent when the page ends the reply on one of the reply’s own calls: no subagent request after it', async () => {
    const events: string[] = [];
    let t!: ReturnType<typeof setup>;
    t = setup({
      subagents: () => ({ tools: ['sandbox__read_file'] }),
      beforeToolCall: () => async (name, _input, { subagent }) => {
        // The subagent's first read waits for the page's stop, so it is still running when the reply ends.
        if (subagent !== undefined) {
          await vi.waitFor(() => expect(events).toContain('stop'));
          return { allow: true };
        }
        if (name !== 'sandbox__read_file') return { allow: true };
        // The reply's own read is answered once its subagent is under way.
        await vi.waitFor(() => expect(t.childBodies.length).toBeGreaterThanOrEqual(1));
        events.push('stop');
        return { refuse: 'Budget used.', stop: true, message: 'Budget used.' };
      },
      parent: [() => callsReply(['d1', 'dispatch_agent', { task: 'keep reading', mode: 'read' }], ['p1', 'sandbox__read_file', { path: '/a' }]), () => textReply('should not be asked')],
      child: (_task, n) => (events.push(`child ${n}`), callsReply([`s${n}`, 'sandbox__read_file', { path: `/s${n}` }])),
    });
    t.session.newConversation();
    await t.session.send('go');
    const turn = t.session.store.current!.turns[0]!;
    expect(turn.assistant).toMatchObject({ status: 'done', stopped: 'Budget used.' });
    const stopAt = events.indexOf('stop');
    expect(stopAt).toBeGreaterThan(0);
    expect(events.slice(stopAt + 1)).toEqual([]);
    const result = turn.assistant.messages.flatMap((m) => (m.role === 'tool' ? m.content : [])).find((part) => part.type === 'tool-result' && part.toolCallId === 'd1');
    expect((result as { output: { value: unknown } }).output.value).toMatchObject({ status: 'stopped' });
  });
});
