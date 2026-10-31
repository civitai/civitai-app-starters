import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from './agent/agent.js';
import { RemoteAgent } from './remote/remote-agent.js';
import { ChatSession } from './session.js';
import type { ChatConversation } from './store/conversation-store.js';
import { HostThreadStore } from './store/host-store.js';
import { completion, memoryStore, textReply, urlOf } from './test-support/fake-backend.js';
import { fakeRunner, RUNNER_URL } from './test-support/fake-runner.js';

/**
 * `runner: 'remote'` with a store-only backend: the host keeps the conversations (list, open, rename,
 * delete), and every reply runs on the server runner, which is the only writer of what is saved.
 */

const GATEWAY = 'https://host.example/api/llm';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const record = (id: string, title: string, updatedAt: string, turns: ChatConversation['turns'] = []): ChatConversation => ({
  id,
  title,
  titleSource: 'first-message',
  createdAt: updatedAt,
  updatedAt,
  turns,
  scope: 'notes',
});

const PLANNED = record('c1', 'Week plan', '2026-10-20T09:00:00.000Z', [
  { seq: 1, createdAt: '2026-10-20T09:00:00.000Z', user: { content: 'plan my week', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'Here is a plan.' }], status: 'done' } },
]);
const OLD = record('c2', 'Old chat', '2026-10-19T09:00:00.000Z');

type Wrap = (fetch: typeof globalThis.fetch, runner: ReturnType<typeof fakeRunner>) => typeof globalThis.fetch;

function remoteOnHostStore({ wrap = (fetch) => fetch, timeoutMs }: { wrap?: Wrap; timeoutMs?: number } = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Anything the page sends outside the runner and the host's store would land here.
  const global = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', global);
  const store = memoryStore([PLANNED, OLD]);
  const runner = fakeRunner();
  // Typed loosely so this file also typechecks against a package without the store-only backend.
  const backend = { model: 'host/default', models: [{ id: 'host/big', label: 'Big' }], store } as never;
  const remote = { url: RUNNER_URL, fetch: wrap(runner.fetch, runner), reconnectDelaysMs: [0], ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
  const session = new ChatSession(null, { scope: 'notes', runner: 'remote', remote, backend });
  return { session, store, runner, global };
}

describe("ChatSession with runner 'remote' and a store-only backend", () => {
  it("keeps the conversations in the host's store and runs each reply on the runner, which alone saves them", async () => {
    const { session, store, runner, global } = remoteOnHostStore();
    expect(session.agent).toBeInstanceOf(RemoteAgent);
    expect(session.store).toBeInstanceOf(HostThreadStore);

    // The list and a chat come from the host's store.
    await session.store.refreshList();
    expect(session.store.summaries.map((summary) => [summary.id, summary.title])).toEqual([
      ['c1', 'Week plan'],
      ['c2', 'Old chat'],
    ]);
    await session.openConversation('c1');
    expect(session.store.current?.turns.map((turn) => turn.user.content)).toEqual(['plan my week']);
    // Opening a chat asks the runner for its live run, as remote mode always does.
    await vi.waitFor(() => expect(runner.requests.some((request) => request.path === 'runs?conversationId=c1')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The reply runs on the runner, with the backend's model.
    void session.send('next step');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const starts = runner.requests.filter((request) => request.method === 'POST' && request.path === 'runs');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.body).toMatchObject({ v: 1, conversationId: 'c1', scope: 'notes', turn: { seq: 2, user: { content: 'next step', attachments: [] } }, model: 'host/default' });

    // The model and title the viewer sets go to the runner as patches, as does a rename of another chat.
    await session.setChatModel('host/big');
    await session.store.setTitle('Week plan, revised', 'user');
    await session.store.rename('c2', 'Archive');
    expect(runner.requests.filter((request) => request.path.startsWith('conversations/')).map((request) => [request.path, request.body])).toEqual([
      ['conversations/c1/patch', { v: 1, model: 'host/big' }],
      ['conversations/c1/patch', { v: 1, title: 'Week plan, revised', titleSource: 'user' }],
      ['conversations/c2/patch', { v: 1, title: 'Archive', titleSource: 'user' }],
    ]);
    expect(session.store.summaries.find((summary) => summary.id === 'c2')?.title).toBe('Archive');

    // The run ends: the chat is read again from the host's store, not looked up on the runner again.
    runner.push('r1', { type: 'run-ended', status: 'done', messages: [{ role: 'assistant', content: 'Done.' }], steps: 1 });
    await vi.waitFor(() => expect(session.agent.running).toBe(false));
    await vi.waitFor(() => expect(store.calls.filter((call) => call === 'load c1')).toHaveLength(2));

    // Deleting a chat goes to the host's store.
    await session.store.remove('c2');

    // The page wrote nothing into the host's store, and asked nothing of anyone else.
    expect(store.calls).toEqual(['list', 'load c1', 'load c1', 'delete c2']);
    expect(store.records.get('c1')).toEqual(PLANNED);
    expect(global).not.toHaveBeenCalled();
    expect(runner.requests.filter((request) => request.path.startsWith('runs?conversationId='))).toHaveLength(1);
  });

  it("offers the backend's models, and uses a chat's own one only when the backend names it", async () => {
    const { session, runner } = remoteOnHostStore();
    expect(session.defaultModel()).toBe('host/default');
    expect(session.modelChoices().map((choice) => choice.id)).toEqual(['host/default', 'host/big']);
    session.newConversation();
    await session.setChatModel('elsewhere/model');
    expect(session.assistantModel()).toBe('host/default');
    await session.setChatModel('host/big');
    expect(session.assistantModel()).toBe('host/big');
    // Nothing saved yet: no patch; the model goes with the chat's first run.
    expect(runner.requests).toEqual([]);
  });
});

/** The runner's answer to a stop of r1: `answer` it, and end the run `afterMs` later, as a runner does once the reply has stopped. */
function onStop({ afterMs = 20, answer }: { afterMs?: number; answer?: number } = {}): Wrap {
  return (fetch, runner) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs/r1/stop')) {
        setTimeout(() => runner.push('r1', { type: 'run-ended', status: 'stopped', messages: [], steps: 1 }), afterMs);
        if (answer !== undefined) return new Response(JSON.stringify({ v: 1, error: 'not-found', message: 'No such run.' }), { status: answer });
      }
      return fetch(input, init);
    }) as typeof globalThis.fetch;
}

const seen = (runner: ReturnType<typeof fakeRunner>, from: number) => runner.requests.slice(from).map((request) => `${request.method} ${request.path}`);

async function running(session: ChatSession, runner: ReturnType<typeof fakeRunner>): Promise<string> {
  session.newConversation();
  void session.send('build it');
  await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
  return session.store.current!.id;
}

describe('stopRunBeforeDelete', () => {
  it('stops the live run, then resolves only once it has ended, looking it up again until then', async () => {
    const { session, runner } = remoteOnHostStore({ wrap: onStop() });
    const id = await running(session, runner);
    const before = runner.requests.length;
    await session.stopRunBeforeDelete(id, { pollMs: 10 });
    // Resolved only after the run ended, which the runner does after its final save.
    expect(runner.runs.get('r1')!.live).toBe(false);
    const calls = seen(runner, before);
    expect(calls.slice(0, 2)).toEqual([`GET runs?conversationId=${id}`, 'POST runs/r1/stop']);
    // Looked up again until none was live: the last lookup is the one that found none.
    expect(calls.slice(2).length).toBeGreaterThanOrEqual(1);
    expect(new Set(calls.slice(2))).toEqual(new Set([`GET runs?conversationId=${id}`]));
    session.agent.leave();
  });

  it('looks a chat with no live run up once, and stops nothing', async () => {
    const { session, runner, store } = remoteOnHostStore();
    await session.stopRunBeforeDelete('c2');
    expect(seen(runner, 0)).toEqual(['GET runs?conversationId=c2']);
    expect(store.calls).toEqual([]);
  });

  it('takes a stop answered 404 (the run ended meanwhile) as stopped', async () => {
    const made = remoteOnHostStore({ wrap: onStop({ afterMs: 0, answer: 404 }) });
    const id = await running(made.session, made.runner);
    await expect(made.session.stopRunBeforeDelete(id, { pollMs: 10 })).resolves.toBeUndefined();
    made.session.agent.leave();
  });

  it("refuses, with each reason's code: a refused stop, a run still live at the timeout, a runner that cannot be reached", async () => {
    const refused = remoteOnHostStore();
    refused.runner.knobs.refuseStop = { status: 503 };
    const id = await running(refused.session, refused.runner);
    await expect(refused.session.stopRunBeforeDelete(id)).rejects.toMatchObject({ code: 'stop-refused', message: 'The chat runner did not stop the reply.' });
    refused.session.agent.leave();

    // The stop is taken, but the run never ends.
    const slow = remoteOnHostStore({ timeoutMs: 200 });
    const slowId = await running(slow.session, slow.runner);
    const before = slow.runner.requests.length;
    await expect(slow.session.stopRunBeforeDelete(slowId, { pollMs: 20 })).rejects.toMatchObject({ code: 'still-stopping', message: 'The reply is still stopping.' });
    expect(seen(slow.runner, before).slice(0, 2)).toEqual([`GET runs?conversationId=${slowId}`, 'POST runs/r1/stop']);
    slow.session.agent.leave();

    const unreachable = remoteOnHostStore({
      wrap: (fetch) => (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('runs?conversationId=') ? Promise.reject(new TypeError('fetch failed')) : fetch(input, init))) as typeof globalThis.fetch,
    });
    await expect(unreachable.session.stopRunBeforeDelete('c2')).rejects.toMatchObject({ code: 'runner-unreachable', message: 'The chat runner could not be reached.' });
    expect(unreachable.runner.requests.filter((request) => request.path.endsWith('/stop'))).toEqual([]);
  });

  it('asks nothing outside remote mode on a host store', async () => {
    const runner = fakeRunner();
    // Remote on the orchestrator's store: unchanged, so no lookup before a delete.
    const app = { getToken: async () => 'token', site: {}, orchestration: { queryWorkflows: vi.fn(async () => ({ items: [], next: '' })), submitWorkflow: vi.fn() } } as never;
    await new ChatSession(app, { runner: 'remote', remote: { url: RUNNER_URL, fetch: runner.fetch } }).stopRunBeforeDelete('c1');
    // The browser on a gateway backend.
    await new ChatSession(null, { remote: { url: RUNNER_URL, fetch: runner.fetch }, backend: { url: GATEWAY, model: 'm', store: memoryStore() } }).stopRunBeforeDelete('c1');
    expect(runner.requests).toEqual([]);
  });
});

describe('a backend with a gateway, in the browser', () => {
  it("runs on the page's own loop and saves to the host's store, with runner unset or 'browser', whatever remote is configured", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const runner of [undefined, 'browser'] as const) {
      const global = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', global);
      const store = memoryStore();
      const asked: string[] = [];
      const gateway = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push(urlOf(input));
        return (JSON.parse(String(init?.body)) as { stream?: boolean }).stream ? textReply('Done.') : completion('A title');
      });
      const remote = fakeRunner();
      const session = new ChatSession(null, {
        ...(runner ? { runner } : {}),
        remote: { url: RUNNER_URL, fetch: remote.fetch },
        backend: { url: GATEWAY, fetch: gateway, model: 'host/default', store },
      });
      expect(session.agent).toBeInstanceOf(Agent);
      expect(session.store).toBeInstanceOf(HostThreadStore);
      session.newConversation();
      await session.send('hi');

      expect(asked[0]).toBe(`${GATEWAY}/v1/chat/completions`);
      const id = session.store.current!.id;
      const saves = store.calls.filter((call) => call.startsWith('save'));
      expect(saves.length).toBeGreaterThanOrEqual(2);
      expect(new Set(saves)).toEqual(new Set([`save ${id}`]));
      expect(store.records.get(id)?.turns.map((turn) => [turn.user.content, turn.assistant?.status])).toEqual([['hi', 'done']]);
      expect(remote.requests).toEqual([]);
      expect(global).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });
});

describe('a backend the runner cannot use', () => {
  it('is refused before anything is wired, with what to change', () => {
    const global = vi.fn();
    vi.stubGlobal('fetch', global);
    const store = memoryStore();
    const remote = { url: RUNNER_URL };
    const REMOTE_GATEWAY = "The 'remote' chat runner takes a backend's store and models only: leave out backend.url and backend.fetch, since replies run on the runner.";
    const NO_GATEWAY = "A backend without url needs runner 'remote': in the browser, replies go to backend.url.";
    // Remote with a gateway named: its replies would not go there.
    expect(() => new ChatSession(null, { runner: 'remote', remote, backend: { url: GATEWAY, model: 'm', store } })).toThrow(REMOTE_GATEWAY);
    expect(() => new ChatSession(null, { runner: 'remote', remote, backend: { fetch: vi.fn(), model: 'm', store } as never })).toThrow(REMOTE_GATEWAY);
    expect(() => new ChatSession(null, { runner: 'remote', remote, backend: { url: '', fetch: vi.fn(), model: 'm', store } as never })).toThrow(REMOTE_GATEWAY);
    // One test for a url in both modes: a blank one names no gateway, so remote takes it as store-only.
    expect(new ChatSession(null, { runner: 'remote', remote, backend: { url: ' ', model: 'm', store } }).agent).toBeInstanceOf(RemoteAgent);
    // In the browser, a store-only backend has no gateway for the reply.
    expect(() => new ChatSession(null, { backend: { model: 'm', store } as never })).toThrow(NO_GATEWAY);
    expect(() => new ChatSession(null, { runner: 'browser', backend: { model: 'm', store } as never })).toThrow(NO_GATEWAY);
    // A blank url names no gateway either.
    expect(() => new ChatSession(null, { backend: { url: '  ', model: 'm', store } })).toThrow(NO_GATEWAY);
    // Remote still needs its runner first, backend or not.
    expect(() => new ChatSession(null, { runner: 'remote', backend: { model: 'm', store } as never })).toThrow("The 'remote' chat runner needs remote.url: the server runner's base URL.");
    expect(store.calls).toEqual([]);
    expect(global).not.toHaveBeenCalled();
  });

  it('still takes a URL object as the gateway in the browser, as the model client always has', () => {
    const session = new ChatSession(null, { backend: { url: new URL(GATEWAY) as never, model: 'm', store: memoryStore() } });
    expect(session.agent).toBeInstanceOf(Agent);
  });
});
