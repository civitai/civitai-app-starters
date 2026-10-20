import { describe, expect, it, vi } from 'vitest';

import { Agent } from './agent/agent.js';
import { RemoteAgent } from './remote/remote-agent.js';
import { ChatSession, type ChatRunner } from './session.js';
import { fakeRunner, RUNNER_URL } from './test-support/fake-runner.js';

/** The experimental `runner` option: the page's own loop unless set, or a server runner's (`remote`). */
describe("ChatSession's runner", () => {
  const app = (heads: unknown[] = []) =>
    ({
      getToken: async () => 'token',
      site: {},
      orchestration: {
        queryWorkflows: vi.fn(async () => ({ items: heads, next: '' })),
        submitWorkflow: vi.fn(async () => ({ id: 'never' })),
      },
    }) as never;

  it("runs in the browser unless told otherwise, and when told 'browser'", () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      expect(new ChatSession(app()).agent).toBeInstanceOf(Agent);
      expect(new ChatSession(app(), { runner: 'browser' }).agent).toBeInstanceOf(Agent);
      // A runner configured but not chosen is not used.
      expect(new ChatSession(app(), { remote: { url: RUNNER_URL } }).agent).toBeInstanceOf(Agent);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("follows a server runner with 'remote', contacting nothing until a reply or a chat needs it", () => {
    const runner = fakeRunner();
    const session = new ChatSession(app(), { runner: 'remote', remote: { url: RUNNER_URL, fetch: runner.fetch } });
    expect(session.agent).toBeInstanceOf(RemoteAgent);
    expect(session.agent.running).toBe(false);
    expect(runner.requests).toEqual([]);
  });

  it('asks no tool server anything in remote mode: the runner holds the tools', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    try {
      const runner = fakeRunner();
      const session = new ChatSession(app(), {
        runner: 'remote',
        remote: { url: RUNNER_URL, fetch: runner.fetch },
        mcp: () => ({ mcpServers: [{ id: 'sandbox', url: 'https://mcp.example.com/sandbox' }] }),
      });
      expect(await session.catalog()).toEqual({ orchestration: [], site: [] });
      session.syncMcpServers();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(session.mcpServers.servers).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      expect(runner.requests).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses 'remote' without a runner to use, or with a backend, before wiring anything", () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      expect(() => new ChatSession(app(), { runner: 'remote' })).toThrow("The 'remote' chat runner needs remote.url: the server runner's base URL.");
      expect(() => new ChatSession(app(), { runner: 'remote', remote: { url: ' ' } })).toThrow(/needs remote\.url/);
      expect(() => new ChatSession(null, { runner: 'remote', remote: { url: RUNNER_URL }, backend: { url: '/api/chat', model: 'm', store: {} as never } })).toThrow(
        "The 'remote' chat runner cannot be used with a backend: a backend's replies run on the page.",
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a runner it does not know', () => {
    expect(() => new ChatSession(app(), { runner: 'server' as ChatRunner })).toThrow('Unknown chat runner "server": use \'browser\' or \'remote\'.');
  });

  it('looks for a live run of each chat it opens, and follows it', async () => {
    const runner = fakeRunner();
    const session = new ChatSession(app(), { runner: 'remote', remote: { url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs: [0] } });
    // A run already going for c1, started from another page.
    const started = await runner.fetch(`${RUNNER_URL}/runs`, {
      method: 'POST',
      body: JSON.stringify({ v: 1, idempotencyKey: 'other', conversationId: 'c1', turn: { seq: 1, user: { content: 'hi', attachments: [] } }, model: 'm', settings: {} }),
    });
    expect(started.status).toBe(201);
    await session.openConversation('c1');
    await vi.waitFor(() => expect(session.agent.running).toBe(true));
    expect(runner.requests.some((request) => request.path === 'runs?conversationId=c1')).toBe(true);
    expect(session.agent.live?.seq).toBe(1);
    expect(session.store.current?.turns.map((turn) => turn.user.content)).toEqual(['hi']);
    session.agent.leave();
  });

  it('leaves a remote reply running on the server when another chat is opened or started: only Stop stops it', async () => {
    const runner = fakeRunner();
    const session = new ChatSession(app(), { runner: 'remote', remote: { url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs: [0] } });
    void session.send('build it');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    session.newConversation();
    expect(session.agent.running).toBe(false);
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(0));
    expect(runner.requests.filter((request) => request.path.endsWith('/stop'))).toEqual([]);
    expect(runner.runs.get('r1')!.live).toBe(true);
  });

  it('sends the title and model the viewer sets to the runner, and writes no head itself', async () => {
    const runner = fakeRunner();
    const orchestration = { queryWorkflows: vi.fn(async () => ({ items: [], next: '' })), submitWorkflow: vi.fn() };
    const session = new ChatSession({ getToken: async () => 'token', site: {}, orchestration } as never, { runner: 'remote', remote: { url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs: [0] } });
    void session.send('build it');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await session.setChatModel('model-b');
    await session.store.setTitle('Todo app', 'user');
    expect(runner.requests.filter((request) => request.path.startsWith('conversations/')).map((request) => request.body)).toEqual([
      { v: 1, model: 'model-b' },
      { v: 1, title: 'Todo app', titleSource: 'user' },
    ]);
    expect(orchestration.submitWorkflow).not.toHaveBeenCalled();
    session.agent.leave();
  });
});
