import type { ToolSet } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { partsFromMessages } from './agent/parts.js';
import { chatConfig } from './config.js';
import type { ChatMcpOptions, ChatMcpServer } from './mcp/servers.js';
import type { ChatToolResult } from './tools/gate.js';
import { ChatSession, type McpServerErrorDetail } from './session.js';
import { fakeMcpServers, type FakeTool } from './test-support/fake-mcp.js';
import { flush } from './test-support/fakes.js';

describe('ChatSession', () => {
  it('offers no tools from a server the embedding page switched off, without contacting it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const app = { getToken: async () => 'token', site: {}, orchestration: {} } as never;
    const session = new ChatSession(app, { mcp: () => ({ orchestration: false, site: false }) });
    expect(await session.catalog()).toEqual({ orchestration: [], site: [] });
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('opens a shared panel as its own conversation the viewer can run and talk about, without an assistant reply', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const submitted: { metadata?: unknown }[] = [];
    const app = {
      getToken: async () => 'token',
      site: {},
      orchestration: {
        submitWorkflow: vi.fn(async (template: { metadata?: unknown }) => {
          submitted.push(template);
          return { id: `7-${submitted.length}`, cost: { total: 0 } };
        }),
        queryWorkflows: vi.fn(async () => ({ items: [], next: '' })),
      },
    } as never;
    const session = new ChatSession(app);

    await session.openShared({
      v: 1,
      id: 'P1',
      version: 3,
      spec: { title: 'Beat maker', inputs: { mood: { kind: 'choice', options: ['Calm', 'Bold'] } }, run: { stepType: 'aceStepAudio', input: { prompt: '{{mood}}' } } },
      values: { mood: 'Bold' },
    });
    await flush();

    const conversation = session.store.current!;
    expect(conversation.title).toBe('Beat maker');
    const [turn] = conversation.turns;
    expect(turn?.user.content).toBe('Opened a shared panel: Beat maker');
    expect(partsFromMessages(turn!.assistant.messages)).toMatchObject([{ kind: 'tool', toolName: 'open_panel', state: 'done', output: { panel: 'p1' } }]);
    const panel = session.panels.get('p1')!;
    expect(panel).toMatchObject({ forkedFrom: { id: 'P1', version: 3 }, values: { mood: 'Bold' } });
    expect(panel.id).not.toBe('P1');
    expect(session.panels.context()).toContain('Someone else made this panel');
    const saved = fetch.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => String(init?.body));
    expect(saved.at(-1)).toContain('"forkedFrom":{"id":"P1","version":3}');
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('chat/completions'))).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("ChatSession's model and output cap, as the reply request carries them", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(stored: Record<string, unknown> = {}) {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const replies: { model?: unknown; max_tokens?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (!String(url).includes('chat/completions')) return new Response('{}');
        replies.push(JSON.parse(String(init?.body)));
        // A 400 fails the reply at once: a 5xx would be retried with a backoff.
        return new Response('{}', { status: 400 });
      }),
    );
    const heads = Object.entries(stored).map(([conversationId, model]) => ({
      id: `head-${conversationId}`,
      tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
      metadata: { v: 2, app: 'chat-cvt', conversationId, title: 'Saved', titleSource: 'llm', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', turns: [], ...(model ? { model } : {}) },
    }));
    const app = {
      getToken: async () => 'token',
      site: {},
      orchestration: {
        submitWorkflow: vi.fn(async () => ({ id: `7-${Math.random()}`, cost: { total: 0 } })),
        queryWorkflows: vi.fn(async (query: { tags: string[] }) => ({ items: heads.filter((head) => query.tags.every((tag) => head.tags.includes(tag))), next: '' })),
      },
    } as never;
    const session = new ChatSession(app, { mcp: () => ({ orchestration: false, site: false }) });
    return { session, replies };
  }

  it("asks with the chat's own model, else the viewer's default, else the page's, from the next reply", async () => {
    const { session, replies } = setup();
    session.newConversation();
    await session.send('one');
    session.updateSettings({ assistantModel: ' viewer/default-model ' });
    await session.send('two');
    await session.setChatModel('chat/own-model');
    await session.send('three');
    await session.setChatModel(undefined);
    await session.send('four');
    session.newConversation();
    await session.send('five');
    expect(replies.map((reply) => reply.model)).toEqual([chatConfig.model, 'viewer/default-model', 'chat/own-model', 'viewer/default-model', 'viewer/default-model']);
  });

  it("uses a saved chat's model after a reload, and the default for a chat saved without one", async () => {
    const { session, replies } = setup({ OLD: undefined, PICKED: 'saved/chat-model' });
    session.updateSettings({ assistantModel: 'viewer/default-model' });
    await session.openConversation('PICKED');
    await session.send('again');
    await session.openConversation('OLD');
    await session.send('again');
    expect(replies.map((reply) => reply.model)).toEqual(['saved/chat-model', 'viewer/default-model']);
  });

  it("sends the viewer's output cap as max_tokens, 16,384 when unset, and a stale stored value kept within range", async () => {
    const { session, replies } = setup();
    session.newConversation();
    await session.send('default');
    session.updateSettings({ maxOutputTokens: 7_000 });
    await session.send('mine');
    session.updateSettings({ maxOutputTokens: 300 });
    await session.send('stale');
    session.updateSettings({ maxOutputTokens: 'lots' as never });
    await session.send('garbage');
    expect(replies.map((reply) => reply.max_tokens)).toEqual([16_384, 7_000, 1_024, 16_384]);
  });
});

describe('ChatSession with added MCP servers', () => {
  const ORCH = chatConfig.orchestrationMcpUrl;
  const SANDBOX = 'https://sandbox.example/mcp';
  const OTHER = 'https://other.example/mcp';
  const turn = { conversationId: 'c1', seq: 1 };
  const tools = (...names: string[]): FakeTool[] => names.map((name) => ({ name }));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(routes: Record<string, FakeTool[] | 'down'>, servers: () => ReadonlyArray<ChatMcpServer> | undefined) {
    const fake = fakeMcpServers({ [ORCH]: tools('run_step', 'find_services'), ...routes });
    vi.stubGlobal('fetch', fake.fetch);
    const app = { getToken: async () => 'app-token', site: {}, orchestration: {}, requestGrants: async () => true } as never;
    const session = new ChatSession(app, { mcp: () => ({ site: false, mcpServers: servers() }) });
    return { session, servers: fake.servers };
  }

  const run = async (set: ToolSet, name: string, input: Record<string, unknown> = {}) =>
    set[name]!.execute!(input, { toolCallId: 'call-1', messages: [], abortSignal: new AbortController().signal });

  it("adds each server's tools to the built-in ones, every one named `${id}__${tool}`, and calls them on that server", async () => {
    const calls: unknown[] = [];
    const { session } = setup({ [SANDBOX]: [{ name: 'run_command', run: (args) => (calls.push(args), { content: [{ type: 'text', text: 'listed 3 files' }] }) }, { name: 'read_file' }] }, () => [
      { id: 'sandbox', url: SANDBOX, token: () => 'tok' },
    ]);

    const set = await session.toolSet(turn);

    expect(Object.keys(set)).toEqual(expect.arrayContaining(['run_step', 'find_services', 'sandbox__run_command', 'sandbox__read_file']));
    expect(Object.keys(set)).not.toContain('run_command');
    expect(await run(set, 'sandbox__run_command', { command: 'ls' })).toBe('listed 3 files');
    expect(calls).toEqual([{ command: 'ls' }]);
  });

  it("keeps a tool whose name a built-in tool or another server also uses apart, under its server's id", async () => {
    const ran: string[] = [];
    const tagged = (server: string, ...names: string[]): FakeTool[] =>
      names.map((name) => ({ name, run: () => (ran.push(`${server}:${name}`), { content: [{ type: 'text', text: `${server} ${name}` }] }) }));
    const { session } = setup({ [SANDBOX]: tagged('a', 'run_command', 'run_step'), [OTHER]: tagged('b', 'run_command') }, () => [
      { id: 'a', url: SANDBOX, token: () => 'tok' },
      { id: 'b', url: OTHER, token: () => 'tok' },
    ]);

    const set = await session.toolSet(turn);

    expect(Object.keys(set)).toEqual(expect.arrayContaining(['run_step', 'a__run_step', 'a__run_command', 'b__run_command']));
    // The built-in run_step is still the job tool, not the server's.
    expect(set.run_step!.description).toContain('Runs in the background');
    expect(await run(set, 'a__run_step')).toBe('a run_step');
    expect(await run(set, 'a__run_command')).toBe('a run_command');
    expect(await run(set, 'b__run_command')).toBe('b run_command');
    expect(ran).toEqual(['a:run_step', 'a:run_command', 'b:run_command']);
  });

  it('sends each server its own token, and never the viewer\'s Civitai token to a server that brings none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const THIRD = 'https://third.example/mcp';
    const tokenless = { id: 'c', url: THIRD } as ChatMcpServer;
    const { session, servers } = setup({ [SANDBOX]: tools('run_command'), [OTHER]: tools('ping'), [THIRD]: tools('ping') }, () => [
      { id: 'a', url: SANDBOX, token: () => 'tok-a' },
      { id: 'b', url: OTHER, token: async () => 'tok-b' },
      tokenless,
    ]);

    const set = await session.toolSet(turn);
    await run(set, 'a__run_command');
    await run(set, 'b__ping');

    // initialize, initialized, tools/list, tools/call
    for (const url of [SANDBOX, OTHER]) expect(servers[url]!.authorizations).toHaveLength(4);
    expect(new Set(servers[SANDBOX]!.authorizations)).toEqual(new Set(['Bearer tok-a']));
    expect(new Set(servers[OTHER]!.authorizations)).toEqual(new Set(['Bearer tok-b']));
    // Left out, uncontacted: a missing token is a page bug, not a reason to hand over the viewer's.
    expect(Object.keys(set).filter((name) => name.startsWith('c__'))).toEqual([]);
    expect(servers[THIRD]!.initializes).toBe(0);
    expect(servers[THIRD]!.authorizations).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MCP server "c" is skipped: it has no token'));
  });

  it('requires a token in the type', () => {
    // @ts-expect-error `token` is required: the chat never sends a server the viewer's own token.
    const server: ChatMcpServer = { id: 'c', url: 'https://third.example/mcp' };
    expect(server.id).toBe('c');
  });

  it('opens a new server and closes the old one when the list changes, keeping the conversation; an equal list changes nothing', async () => {
    let list: ChatMcpServer[] = [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'old' }];
    let waiting = 0;
    const hang: FakeTool = { name: 'wait', run: () => (waiting++, new Promise(() => undefined)) };
    const { session, servers } = setup({ [SANDBOX]: [...tools('run_command'), hang], [OTHER]: [...tools('run_command', 'read_file'), hang] }, () => list);
    session.store.startNew();
    session.store.appendUserTurn('build me a site', []);
    const conversation = session.store.current;

    await run(await session.toolSet(turn), 'sandbox__run_command');
    expect(servers[SANDBOX]!.initializes).toBe(1);

    // Equal in value, every object new, and a new token function: the same connection, the new token.
    list = [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'new' }];
    session.syncMcpServers();
    await run(await session.toolSet(turn), 'sandbox__run_command');
    expect(servers[SANDBOX]!.initializes).toBe(1);
    expect(servers[SANDBOX]!.authorizations.at(-1)).toBe('Bearer new');

    // A new url: the old connection is closed at once, before any reply, ending a call still running on it.
    const running = run(await session.toolSet(turn), 'sandbox__wait');
    await vi.waitFor(() => expect(waiting).toBe(1));
    list = [{ id: 'sandbox', url: OTHER, token: () => 'new' }];
    session.syncMcpServers();
    await expect(running).rejects.toThrow(/connection closed/i);
    const swapped = await session.toolSet(turn);
    expect(Object.keys(swapped)).toEqual(expect.arrayContaining(['sandbox__run_command', 'sandbox__read_file']));
    expect(servers[OTHER]!.initializes).toBe(1);

    // Removed: closed, and its tools are gone.
    const stillRunning = run(swapped, 'sandbox__wait');
    await vi.waitFor(() => expect(waiting).toBe(2));
    list = [];
    session.syncMcpServers();
    await expect(stillRunning).rejects.toThrow(/connection closed/i);
    expect(Object.keys(await session.toolSet(turn)).filter((name) => name.startsWith('sandbox__'))).toEqual([]);

    expect(session.store.current).toBe(conversation);
    expect(session.store.current!.turns.map((t) => t.user.content)).toEqual(['build me a site']);
  });

  it('refuses a tool kept from before a swap, instead of reopening the old server with the old token', async () => {
    let list: ChatMcpServer[] = [{ id: 'sandbox', url: SANDBOX, token: () => 'old-token' }];
    const { session, servers } = setup({ [SANDBOX]: tools('run_command'), [OTHER]: tools('run_command') }, () => list);
    const stale = await session.toolSet(turn);
    await run(stale, 'sandbox__run_command');
    const before = { initializes: servers[SANDBOX]!.initializes, requests: servers[SANDBOX]!.authorizations.length };

    list = [{ id: 'sandbox', url: OTHER, token: () => 'new-token' }];
    session.syncMcpServers();
    await expect(run(stale, 'sandbox__run_command')).rejects.toThrow(/removed from the chat/);

    expect(servers[SANDBOX]!.initializes).toBe(before.initializes);
    expect(servers[SANDBOX]!.authorizations).toHaveLength(before.requests);
  });

  it('leaves out a server it cannot reach, reports it once, and keeps the built-in tools and the other servers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session } = setup({ [SANDBOX]: 'down', [OTHER]: tools('run_command') }, () => [
      { id: 'broken', url: SANDBOX, label: 'Broken box', token: () => 'tok' },
      { id: 'ok', url: OTHER, token: () => 'tok' },
    ]);
    const errors: McpServerErrorDetail[] = [];
    session.addEventListener('mcp-server-error', (event) => errors.push((event as CustomEvent<McpServerErrorDetail>).detail));

    const set = await session.toolSet(turn);
    expect(Object.keys(set)).toEqual(expect.arrayContaining(['run_step', 'find_services', 'ok__run_command']));
    expect(Object.keys(set).filter((name) => name.startsWith('broken__'))).toEqual([]);
    expect(await run(set, 'ok__run_command')).toBe('run_command ran');

    await session.toolSet(turn);
    expect(errors.map((detail) => detail.server.id)).toEqual(['broken']);
  });

  it('passes arguments to an added server as the assistant wrote them, never swapping a chat file id for its signed URL', async () => {
    const calls: unknown[] = [];
    const { session } = setup({ [SANDBOX]: [{ name: 'run_command', run: (args) => (calls.push(args), { content: [{ type: 'text', text: 'ok' }] }) }] }, () => [
      { id: 'sandbox', url: SANDBOX, token: () => 'tok' },
    ]);
    session.store.startNew();
    session.store.appendUserTurn('use this picture', [{ id: 'up1-1', kind: 'image', source: { type: 'upload', blobId: 'b1' }, url: 'https://files.example/signed.png?sig=secret' }]);

    await run(await session.toolSet(turn), 'sandbox__run_command', { file: 'up1-1', nested: { files: ['up1-1'] } });

    expect(calls).toEqual([{ file: 'up1-1', nested: { files: ['up1-1'] } }]);
  });

  it("shows a running tool under its server's label, or its id without one", async () => {
    const { session } = setup({ [SANDBOX]: tools('run_command'), [OTHER]: tools('ping') }, () => [
      { id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'tok' },
      { id: 'other', url: OTHER, token: () => 'tok' },
    ]);
    await session.toolSet(turn);
    expect(session.mcpServerViews()).toEqual({ sandbox__run_command: { activity: 'Sandbox: run_command…' }, other__ping: { activity: 'other: ping…' } });
  });

  it('skips a server whose id is not lowercase letters, digits and -', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session, servers } = setup({ [SANDBOX]: tools('run_command'), [OTHER]: tools('run_command') }, () => [
      { id: 'Bad_Id', url: SANDBOX, token: () => 'tok' },
      { id: 'good', url: OTHER, token: () => 'tok' },
    ]);
    const set = await session.toolSet(turn);
    expect(Object.keys(set).filter((name) => name.includes('__'))).toEqual(['good__run_command']);
    expect(servers[SANDBOX]!.initializes).toBe(0);
  });
});

describe('ChatSession host controls', () => {
  const ORCH = chatConfig.orchestrationMcpUrl;
  const SANDBOX = 'https://sandbox.example/mcp';
  const turn = { conversationId: 'c1', seq: 1 };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Options = NonNullable<ConstructorParameters<typeof ChatSession>[1]>;

  function setup(options: Omit<Options, 'mcp'> & { orchestration?: ChatMcpOptions['orchestration'] } = {}, sandbox: FakeTool[] = []) {
    const fake = fakeMcpServers({ [ORCH]: ['run_step', 'run_workflow', 'find_services', 'get_input_schema'].map((name) => ({ name })), [SANDBOX]: sandbox });
    vi.stubGlobal('fetch', fake.fetch);
    const app = { getToken: async () => 'app-token', site: {}, orchestration: {}, requestGrants: async () => true } as never;
    const { orchestration, ...rest } = options;
    const session = new ChatSession(app, {
      mcp: () => ({ site: false, ...(orchestration !== undefined ? { orchestration } : {}), mcpServers: sandbox.length ? [{ id: 'sandbox', url: SANDBOX, token: () => 'tok' }] : [] }),
      ...rest,
    });
    return { session };
  }

  const run = async (set: ToolSet, name: string, input: Record<string, unknown> = {}) =>
    set[name]!.execute!(input, { toolCallId: 'call-1', messages: [], abortSignal: new AbortController().signal });

  it('leaves out the orchestration tools the page excludes, and the panels that run through run_step, keeping the read-only ones', async () => {
    const all = Object.keys(await setup().session.toolSet(turn));
    // Positive control: without the exclude, all of them are offered.
    expect(all).toEqual(expect.arrayContaining(['run_step', 'run_workflow', 'open_panel', 'find_services', 'get_input_schema']));

    const { session } = setup({ orchestration: { exclude: ['run_step', 'run_workflow'] } });
    const names = Object.keys(await session.toolSet(turn));
    expect(names).toEqual(expect.arrayContaining(['find_services', 'get_input_schema', 'ask_choice']));
    for (const name of ['run_step', 'run_workflow', 'open_panel']) expect(names).not.toContain(name);
    expect((await session.catalog()).orchestration.map((tool) => tool.name)).toEqual(['find_services', 'get_input_schema']);
  });

  it("refuses a call the page's beforeToolCall refuses: the assistant gets the reason as an error and the server is never called", async () => {
    const calls: unknown[] = [];
    const asked: unknown[] = [];
    const { session } = setup(
      {
        beforeToolCall: () => (name, input, context) => {
          asked.push([name, input, context]);
          return name === 'sandbox__run_command' && (input as { command?: string }).command === 'app create' ? { refuse: 'Confirm the checklist first.' } : { allow: true };
        },
      },
      [{ name: 'run_command', run: (args) => (calls.push(args), { content: [{ type: 'text', text: 'ran' }] }) }],
    );
    const set = await session.toolSet(turn);

    const refused = await run(set, 'sandbox__run_command', { command: 'app create' });
    expect(refused).toEqual({ error: 'Confirm the checklist first.', note: expect.stringContaining('nothing ran') });
    expect(calls).toEqual([]);
    // Positive control: an allowed call reaches the server.
    expect(await run(set, 'sandbox__run_command', { command: 'ls' })).toBe('ran');
    expect(calls).toEqual([{ command: 'ls' }]);
    expect(asked).toEqual([
      ['sandbox__run_command', { command: 'app create' }, { conversationId: 'c1', signal: expect.any(AbortSignal) }],
      ['sandbox__run_command', { command: 'ls' }, { conversationId: 'c1', signal: expect.any(AbortSignal) }],
    ]);
  });

  it('refuses every call when beforeToolCall throws, so a broken gate lets nothing by', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls: unknown[] = [];
    const { session } = setup({ beforeToolCall: () => () => Promise.reject(new Error('gate down')) }, [
      { name: 'run_command', run: (args) => (calls.push(args), { content: [{ type: 'text', text: 'ran' }] }) },
    ]);
    expect(await run(await session.toolSet(turn), 'sandbox__run_command', { command: 'ls' })).toMatchObject({ error: 'The page could not check this call.' });
    expect(calls).toEqual([]);
  });

  it('reports each finished call once as a tool-result event, built-in, added-server and page tools alike', async () => {
    const { session } = setup(
      {
        beforeToolCall: () => (name) => (name === 'find_services' ? { refuse: 'not here' } : undefined),
        hostTools: () => ({
          pin: { description: 'Pin it', inputSchema: { type: 'object', properties: {} }, execute: () => ({ pinned: true }) },
          broken: {
            description: 'Fails',
            inputSchema: { type: 'object', properties: {} },
            execute: () => {
              throw new Error('no board');
            },
          },
        }),
      },
      [{ name: 'run_command' }],
    );
    const results: ChatToolResult[] = [];
    session.addEventListener('tool-result', (event) => results.push((event as CustomEvent<ChatToolResult>).detail));
    const set = await session.toolSet(turn);

    await run(set, 'sandbox__run_command', { command: 'ls' });
    await run(set, 'pin', { id: 1 });
    await run(set, 'broken');
    await run(set, 'find_services', { query: 'flux' });
    await run(set, 'ask_choice', { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] });

    expect(results.map(({ name, isError }) => [name, isError])).toEqual([
      ['sandbox__run_command', false],
      ['pin', false],
      ['broken', true],
      ['find_services', true],
      ['ask_choice', false],
    ]);
    expect(results[0]).toEqual({ name: 'sandbox__run_command', input: { command: 'ls' }, output: 'run_command ran', isError: false });
    expect(results[1]).toMatchObject({ input: { id: 1 }, output: { pinned: true } });
    expect(results[3]).toMatchObject({ refused: 'not here', output: { error: 'not here' } });
    // The job tool keeps what it is: its own description and type, behind the same gate.
    expect(set.run_step!.description).toContain('Runs in the background');
    expect(set.run_step!.type).toBe('dynamic');
  });
});
