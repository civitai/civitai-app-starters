import { afterEach, describe, expect, it, vi } from 'vitest';

import { partsFromMessages } from './agent/parts.js';
import type { ChatBackend } from './backend.js';
import { chatConfig } from './config.js';
import { ChatSession } from './session.js';
import { HostThreadStore } from './store/host-store.js';
import { ThreadStore } from './store/thread-store.js';
import { fakeMcpServers } from './test-support/fake-mcp.js';
import { completion, isCivitaiRequest, memoryStore, sse, textReply, toolCallReply, urlOf } from './test-support/fake-backend.js';

const GATEWAY = 'https://host.example/api/llm';
const COMPLETIONS = `${GATEWAY}/v1/chat/completions`;
const SANDBOX = 'https://sandbox.example/mcp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Sent {
  url: string;
  headers: Headers;
  body: { model?: string; messages?: { role: string; content?: unknown; tool_calls?: unknown }[]; tools?: { function: { name: string } }[]; chat_template_kwargs?: unknown };
}

/**
 * A session on a backend whose gateway answers from `replies` in order. Every request the page makes
 * goes through the global fetch spy, so a request to Civitai would be seen there; the gateway itself
 * is reached only through the host's own `fetch`, which adds its header.
 */
function setup({ replies = [] as (() => Response)[], title = 'A title', models = [] as ChatBackend['models'], sandbox = false, store = memoryStore() } = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const mcp = fakeMcpServers({ [SANDBOX]: [{ name: 'run_command', run: (args) => ({ content: [{ type: 'text', text: `ran ${String(args.command)}` }] }) }] });
  const global = vi.fn((input: RequestInfo | URL, init?: RequestInit) => mcp.fetch(input, init));
  vi.stubGlobal('fetch', global);
  const sent: Sent[] = [];
  const queue = [...replies];
  const hostFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as Sent['body'] & { stream?: boolean };
    sent.push({ url: urlOf(input), headers, body });
    // Naming a chat asks for a whole reply at once, not a stream.
    if (!body.stream) return completion(title);
    const next = queue.shift();
    return next ? next() : textReply('(no more replies)');
  });
  const backend: ChatBackend = {
    url: GATEWAY,
    fetch: (input, init) => hostFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-csrf-token': 'csrf-1' } }),
    model: 'host/default-model',
    models,
    store,
  };
  const session = new ChatSession(null, {
    backend,
    ...(sandbox ? { mcp: () => ({ mcpServers: [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'sandbox-token' }] }) } : {}),
  });
  return { session, sent, store, global, backend, mcp };
}

const assistantText = (session: ChatSession, index = -1) =>
  partsFromMessages(session.store.current!.turns.at(index)!.assistant.messages)
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('');

describe('ChatSession on a host backend', () => {
  it("streams a reply from the host's gateway through the host's fetch, with the backend's model and no Civitai token", async () => {
    const { session, sent, global } = setup({ replies: [() => textReply('Hello ', 'there.')], title: 'Greeting' });
    session.newConversation();
    await session.send('hi');

    expect(session.store.current!.turns[0]!.assistant.status).toBe('done');
    expect(assistantText(session)).toBe('Hello there.');
    expect(sent[0]).toMatchObject({ url: COMPLETIONS, body: { model: 'host/default-model' } });
    expect(sent[0]!.headers.get('x-csrf-token')).toBe('csrf-1');
    expect(sent[0]!.headers.get('authorization')).toBeNull();
    // Civitai's model server options are not the host's: a strict gateway would refuse them.
    expect(sent[0]!.body).not.toHaveProperty('chat_template_kwargs');
    expect(sent[0]!.body.messages!.at(-1)).toMatchObject({ role: 'user' });
    // The title is asked of the same gateway and model.
    await vi.waitFor(() => expect(session.store.current!.title).toBe('Greeting'));
    expect(sent[1]!.body).toMatchObject({ model: 'host/default-model' });
    expect(sent[1]!.body).not.toHaveProperty('stream', true);
    expect(global.mock.calls.map(([input]) => urlOf(input)).filter(isCivitaiRequest)).toEqual([]);
  });

  it("offers no Civitai tools, only the page's added servers and the chat's own", async () => {
    const { session, global } = setup({ sandbox: true });
    const names = Object.keys(await session.toolSet({ conversationId: 'c1', seq: 1 }));
    expect(names).toEqual(expect.arrayContaining(['sandbox__run_command', 'ask_choice']));
    for (const name of ['run_step', 'run_workflow', 'open_panel', 'find_services', 'search_models', 'post_to_civitai']) expect(names).not.toContain(name);
    expect(await session.catalog()).toEqual({ orchestration: [], site: [] });
    expect(global.mock.calls.map(([input]) => urlOf(input)).filter(isCivitaiRequest)).toEqual([]);
  });

  it('runs a tool call through an added MCP server and sends its result back to the gateway', async () => {
    const { session, sent, mcp } = setup({
      sandbox: true,
      replies: [() => toolCallReply('sandbox__run_command', { command: 'ls' }), () => textReply('Three files.')],
    });
    session.newConversation();
    await session.send('what is in the box?');

    expect(sent[0]!.body.tools!.map((tool) => tool.function.name)).toContain('sandbox__run_command');
    expect(mcp.servers[SANDBOX]!.authorizations).toContain('Bearer sandbox-token');
    // The second request carries the call and its result, as an OpenAI-compatible gateway expects.
    const [, call, result] = sent[1]!.body.messages!.slice(-3);
    expect(call).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'sandbox__run_command' } }] });
    expect(result).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    expect(JSON.stringify(result)).toContain('ran ls');
    expect(assistantText(session)).toBe('Three files.');
    expect(partsFromMessages(session.store.current!.turns[0]!.assistant.messages)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'tool', toolName: 'sandbox__run_command', state: 'done' })]),
    );
  });

  it("saves the conversation to the host's store and loads it back in a new session", async () => {
    const store = memoryStore();
    const first = setup({ store, replies: [() => textReply('Sure.')], title: 'Plans' });
    const conversation = first.session.store.startNew();
    await first.session.send('make plans');
    await vi.waitFor(() => expect(store.records.get(conversation.id)?.title).toBe('Plans'));

    const saved = store.records.get(conversation.id)!;
    expect(saved).toMatchObject({ id: conversation.id, titleSource: 'llm', turns: [{ seq: 1, user: { content: 'make plans' }, assistant: { status: 'done' } }] });
    expect(JSON.stringify(saved.turns)).toContain('Sure.');
    // The user's message is saved at once, before the reply: a reload mid-reply keeps it.
    expect(store.calls.filter((call) => call === `save ${conversation.id}`).length).toBeGreaterThanOrEqual(2);

    const second = setup({ store });
    expect(second.session.store).toBeInstanceOf(HostThreadStore);
    await second.session.store.refreshList();
    expect(second.session.store.summaries).toEqual([{ id: conversation.id, title: 'Plans', updatedAt: saved.updatedAt }]);
    await second.session.openConversation(conversation.id);
    expect(second.session.store.current!.turns.map((turn) => turn.user.content)).toEqual(['make plans']);
    expect(assistantText(second.session)).toBe('Sure.');
    expect(second.global.mock.calls.map(([input]) => urlOf(input)).filter(isCivitaiRequest)).toEqual([]);
  });

  it('renames and deletes through the store', async () => {
    const store = memoryStore([
      { id: 'A', title: 'Old', titleSource: 'llm', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', turns: [] },
      { id: 'B', title: 'Other', titleSource: 'llm', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', turns: [] },
    ]);
    const { session } = setup({ store });
    await session.store.refreshList();
    await session.store.rename('A', 'New name');
    expect(store.records.get('A')).toMatchObject({ title: 'New name', titleSource: 'user' });
    expect(session.store.summaries.map((s) => s.title)).toEqual(['Other', 'New name']);
    await session.store.remove('B');
    expect([...store.records.keys()]).toEqual(['A']);
    expect(session.store.summaries.map((s) => s.id)).toEqual(['A']);
  });

  it("uses a chat's own model only when the backend names it", async () => {
    const { session, sent } = setup({ models: [{ id: 'host/big', label: 'Big' }], replies: Array.from({ length: 8 }, () => () => textReply('ok')) });
    session.updateSettings({ assistantModel: 'civitai/viewer-default' });
    session.newConversation();
    await session.send('one');
    await session.setChatModel('host/big');
    await session.send('two');
    await session.setChatModel('somewhere/else');
    await session.send('three');
    const replies = sent.filter((request) => (request.body as { stream?: boolean }).stream === true);
    // The viewer's stored default is Civitai's setting: a backend's chat never follows it.
    expect(replies.map((request) => request.body.model)).toEqual(['host/default-model', 'host/big', 'host/default-model']);
    expect(session.modelChoices().map((entry) => entry.id)).toEqual(['host/default-model', 'host/big']);
  });
});

describe("a gateway's refusal on a host backend", () => {
  async function failWith(response: () => Response) {
    const { session } = setup({ replies: [response, response, response] });
    const errors: unknown[] = [];
    session.agent.addEventListener('error', (event) => errors.push((event as CustomEvent).detail));
    session.newConversation();
    await session.send('hi');
    return { turn: session.store.current!.turns[0]!, errors };
  }

  it("shows the gateway's own message from a JSON body", async () => {
    const { turn, errors } = await failWith(() => Response.json({ error: { message: 'Monthly spend cap reached. It resets on the 1st.' } }, { status: 402 }));
    expect(turn.assistant).toMatchObject({ status: 'error', error: 'Monthly spend cap reached. It resets on the 1st.', errorKind: 'insufficient_buzz' });
    expect(errors).toMatchObject([{ message: 'Monthly spend cap reached. It resets on the 1st.' }]);
  });

  it("shows a plain-text refusal, after the retries a 429 gets", async () => {
    const { turn } = await failWith(() => new Response('Slow down: 20 messages an hour.', { status: 429, headers: { 'retry-after-ms': '0' } }));
    expect(turn.assistant).toMatchObject({ status: 'error', error: 'Slow down: 20 messages an hour.', errorKind: 'rate_limit' });
  });

  it('shows an error the gateway sends inside the stream', async () => {
    const { turn } = await failWith(() => sse({ error: { message: 'The model is overloaded.', type: 'server_error' } }));
    expect(turn.assistant).toMatchObject({ status: 'error', error: 'The model is overloaded.' });
  });

  it('says what went wrong without naming Civitai or Buzz when the gateway gave no words', async () => {
    const { turn } = await failWith(() => new Response('', { status: 402 }));
    expect(turn.assistant).toMatchObject({ status: 'error', error: 'This request was refused.' });
  });
});

describe('ChatSession without a backend (the default)', () => {
  it("keeps conversations on the orchestrator and requires a signed-in app", () => {
    const app = { getToken: async () => 'token', site: {}, orchestration: { queryWorkflows: vi.fn(), submitWorkflow: vi.fn() } } as never;
    const session = new ChatSession(app);
    expect(session.store).toBeInstanceOf(ThreadStore);
    expect(session.backend).toBeUndefined();
    expect(session.app).toBe(app);
    expect(session.defaultModel()).toBe(chatConfig.model);
    expect(() => new ChatSession(null)).toThrow('A chat session needs a signed-in app or a backend.');
  });

  it("still sends Civitai's model server options and the viewer's token to the orchestrator", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bodies: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url.includes('chat/completions')) bodies.push({ url, auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
        return url.includes('chat/completions') ? textReply('ok') : new Response('{}');
      }),
    );
    const app = { getToken: async () => 'viewer-token', site: {}, orchestration: { submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })), queryWorkflows: vi.fn(async () => ({ items: [], next: '' })) } } as never;
    const session = new ChatSession(app, { mcp: () => ({ orchestration: false, site: false }) });
    session.updateSettings({ assistantTier: 'paid' });
    session.newConversation();
    await session.send('hi');
    expect(bodies[0]).toMatchObject({ url: 'https://orchestration.civitai.com/v1/chat/completions', auth: 'Bearer viewer-token', body: { chat_template_kwargs: { enable_thinking: false } } });
  });
});
