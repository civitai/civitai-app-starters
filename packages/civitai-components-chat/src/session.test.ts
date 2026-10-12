import type { ToolSet } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { partsFromMessages } from './agent/parts.js';
import { chatConfig } from './config.js';
import type { ChatMcpServer } from './mcp/servers.js';
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
