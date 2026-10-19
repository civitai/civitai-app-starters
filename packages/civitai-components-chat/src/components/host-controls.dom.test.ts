import type { CivitaiToastRegion } from '@civitai/components/civitai-toast-region';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatToolResult } from '../tools/gate.js';
import { defineElements } from './define.js';

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })) },
  } as never;
}

/** An OpenAI-compatible streamed reply. */
function sse(...chunks: unknown[]): Response {
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const toolCall = (name: string, args: unknown) =>
  sse(
    { id: 'r1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] },
    { id: 'r1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  );
const text = (words: string) =>
  sse(
    { id: 'r2', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: words }, finish_reason: null }] },
    { id: 'r2', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  );

async function mount(setup: (chat: HTMLElementTagNameMap['civitai-chat']) => void = () => undefined) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  // No tool servers, so a reply goes straight to the model.
  chat.mcp = { orchestration: false, site: false };
  setup(chat);
  chat.app = fakeApp();
  document.body.append(chat);
  const root = chat.shadowRoot!;
  await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  const composer = root.querySelector('civitai-chat-composer')!;
  return { chat, root, composer };
}

const completions = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([url]) => String(url).includes('chat/completions'));

describe('civitai-chat holdReason', () => {
  it('sends nothing while held, keeps the message in the box and says why; sends once the hold lifts', async () => {
    const fetch = vi.fn(async (url: unknown) => (String(url).includes('chat/completions') ? text('Hi!') : new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    const { chat, composer } = await mount((el) => (el.holdReason = 'The sandbox is starting…'));
    await chat.updateComplete;
    await composer.updateComplete;

    expect(composer.querySelector('.cvt-composer-hold')?.textContent).toBe('The sandbox is starting…');
    composer.draft = 'build me a timer';
    await composer.updateComplete;
    expect(composer.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(true);

    // The composer's own event (Enter with the button off can still reach it) and the page's send().
    composer.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text: 'build me a timer' } }));
    await chat.send('and a clock');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(completions(fetch)).toHaveLength(0);
    expect(composer.draft).toBe('build me a timer');

    chat.holdReason = undefined;
    await chat.updateComplete;
    await composer.updateComplete;
    expect(composer.querySelector('.cvt-composer-hold')).toBeNull();
    expect(composer.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(false);
    await chat.send('build me a timer');
    await vi.waitFor(() => expect(completions(fetch)).toHaveLength(1));
  });

  it('holds on its own while an added server is still listing its tools', async () => {
    // The server never answers, so its listing stays in flight for this test.
    vi.stubGlobal('fetch', vi.fn((url: unknown) => (String(url).includes('sandbox') ? new Promise<Response>(() => undefined) : Promise.resolve(new Response('{}')))));
    const { chat, composer } = await mount((el) => (el.mcpServers = [{ id: 'sandbox', url: 'https://sandbox.example/mcp', label: 'Sandbox', token: () => 'tok' }]));
    await chat.updateComplete;
    await vi.waitFor(() => expect(composer.querySelector('.cvt-composer-hold')?.textContent).toBe('Connecting to Sandbox…'));
  });
});

describe('civitai-chat /model', () => {
  async function commands() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    localStorage.setItem('cvt:settings', JSON.stringify({ assistantModel: 'viewer/default-model' }));
    const { root, composer } = await mount();
    await vi.waitFor(() => expect(root.querySelector('civitai-toast-region')).not.toBeNull());
    const region = root.querySelector<CivitaiToastRegion>('civitai-toast-region')!;
    const shown = vi.spyOn(region, 'show');
    const say = async (words: string) => {
      shown.mockClear();
      composer.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text: words } }));
      await vi.waitFor(() => expect(shown).toHaveBeenCalled());
      return (shown.mock.calls[0]![0] as { message: string }).message;
    };
    return { say };
  }

  it('says this chat changed, and which default new chats keep, naming where that default is set', async () => {
    const { say } = await commands();
    expect(await say('/model z-ai/glm-5.3-flash')).toBe(
      'This chat now uses z-ai/glm-5.3-flash, from the next reply. New chats use your default, viewer/default-model (Settings → Assistant).',
    );
    expect(await say('/model default')).toBe('This chat now follows your default, viewer/default-model (Settings → Assistant), from the next reply.');
  });
});

describe('civitai-chat beforeToolCall and tool-result', () => {
  it('stops a refused call before the tool runs, tells the assistant why, and reports it as a tool-result event', async () => {
    const requests: { messages: { role: string; content: unknown }[] }[] = [];
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).includes('chat/completions')) return new Response('{}');
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1 ? toolCall('pin', { board: 'ideas' }) : text('I could not pin it.');
    });
    vi.stubGlobal('fetch', fetch);
    const execute = vi.fn(() => ({ pinned: true }));
    const gate = vi.fn((name: string) => (name === 'pin' ? { refuse: 'Pinning is off on this page.' } : { allow: true as const }));
    const { chat } = await mount((el) => {
      el.tools = { pin: { description: 'Pin it to a board', inputSchema: { type: 'object', properties: { board: { type: 'string' } } }, execute } };
      el.beforeToolCall = gate;
    });
    const results: ChatToolResult[] = [];
    document.body.addEventListener('tool-result', (event) => results.push((event as CustomEvent<ChatToolResult>).detail));

    await chat.send('pin this');
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(gate).toHaveBeenCalledWith('pin', { board: 'ideas' }, expect.objectContaining({ conversationId: expect.any(String) }));
    expect(execute).not.toHaveBeenCalled();
    expect(results).toEqual([{ name: 'pin', input: { board: 'ideas' }, output: { error: 'Pinning is off on this page.', note: expect.any(String) }, isError: true, refused: 'Pinning is off on this page.' }]);
    const toolMessage = requests[1]!.messages.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).toContain('Pinning is off on this page.');
  });
});

describe('civitai-chat beforeToolCall with stop', () => {
  /** One step that calls each of `calls` in parallel. */
  const toolCalls = (...calls: [name: string, args: unknown][]) =>
    sse(
      {
        id: 'r1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls.map(([name, args], index) => ({ index, id: `call_${index + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: null }],
      },
      { id: 'r1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    );
  const schema = { type: 'object', properties: { board: { type: 'string' } } };

  /** A model that calls a tool on every step, as one that ignores a refusal does. */
  async function run(gate: NonNullable<HTMLElementTagNameMap['civitai-chat']['beforeToolCall']>, firstStep: () => Response = () => toolCall('pin', { board: 'ideas' })) {
    let steps = 0;
    const fetch = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
      if (!String(url).includes('chat/completions')) return new Response('{}');
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      // Naming the chat is a separate, non-streamed request.
      if (!body.stream) return new Response(JSON.stringify({ id: 't', choices: [{ index: 0, message: { role: 'assistant', content: 'Pins' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
      return ++steps === 1 ? firstStep() : toolCall('pin', { board: 'again' });
    });
    vi.stubGlobal('fetch', fetch);
    const pin = vi.fn(() => ({ pinned: true }));
    const note = vi.fn(() => ({ noted: true }));
    const { chat, root } = await mount((el) => {
      el.tools = { pin: { description: 'Pin it to a board', inputSchema: schema, execute: pin }, note: { description: 'Write a note', inputSchema: schema, execute: note } };
      el.beforeToolCall = gate;
    });
    const results: ChatToolResult[] = [];
    document.body.addEventListener('tool-result', (event) => results.push((event as CustomEvent<ChatToolResult>).detail));
    await chat.send('pin this');
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-thread .cvt-note')).not.toBeNull());
    return { fetch, pin, note, results, root };
  }
  const streamed = (fetch: ReturnType<typeof vi.fn>) => completions(fetch).filter(([, init]) => JSON.parse(String((init as RequestInit).body)).stream);
  const continueButton = (root: ShadowRoot) => [...root.querySelectorAll<HTMLElement>('civitai-chat-thread .cvt-ran-out civitai-button')].find((b) => b.textContent?.trim() === 'Continue');

  it('ends the reply: the call does not run, the model is not asked again, the page’s words show with Continue', async () => {
    const replies: unknown[] = [];
    const { fetch, pin, results, root } = await run((_name, _input, context) => {
      replies.push(context.reply);
      return { refuse: 'Tool budget reached.', stop: true, message: 'This reply used its tool budget.' };
    });
    // Give a further step the time it would need to be requested.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(streamed(fetch)).toHaveLength(1);
    expect(pin).not.toHaveBeenCalled();
    expect(root.querySelector('civitai-chat-thread .cvt-ran-out')?.textContent).toContain('This reply used its tool budget.');
    expect(root.querySelector('civitai-chat-thread civitai-alert')).toBeNull();
    expect(results).toEqual([{ name: 'pin', input: { board: 'ideas' }, output: expect.objectContaining({ error: 'Tool budget reached.' }), isError: true, refused: 'Tool budget reached.', stopped: true }]);

    continueButton(root)!.click();
    await vi.waitFor(() => expect(streamed(fetch)).toHaveLength(2));
    expect(String((streamed(fetch)[1]![1] as RequestInit).body)).toContain('Continue where you left off.');
    // The Continue reply puts its calls to the gate again, as a new reply.
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(typeof replies[0]).toBe('number');
    expect(replies[1]).not.toBe(replies[0]);
  });

  it('says the reply was stopped in its own words when the page gives none', async () => {
    const { fetch, root } = await run(() => ({ refuse: 'Tool budget reached.', stop: true }));
    expect(streamed(fetch)).toHaveLength(1);
    expect(root.querySelector('civitai-chat-thread .cvt-ran-out')?.textContent).toContain('The page ended this reply before the assistant could do more.');
    expect(continueButton(root)).toBeDefined();
  });

  it('control: a refusal without stop goes back to the assistant and the reply goes on, as before', async () => {
    let calls = 0;
    const { fetch, pin, root } = await run(() => (++calls === 1 ? { refuse: 'Not that board.' } : { refuse: 'Tool budget reached.', stop: true }));
    // The first refusal went back to the model, which asked again; only the second call ended the reply.
    expect(streamed(fetch)).toHaveLength(2);
    expect(pin).not.toHaveBeenCalled();
    expect(calls).toBe(2);
    expect(root.querySelector('civitai-chat-thread .cvt-ran-out')).not.toBeNull();
  });

  it('runs none of the calls made alongside a stopped one in the same step, whatever the gate says about them', async () => {
    const { fetch, pin, note, results } = await run(
      (name) => (name === 'pin' ? { refuse: 'Tool budget reached.', stop: true } : { allow: true }),
      () => toolCalls(['pin', { board: 'ideas' }], ['note', { board: 'ideas' }]),
    );
    expect(streamed(fetch)).toHaveLength(1);
    expect(pin).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    expect(results.map((r) => [r.name, r.isError, r.stopped])).toEqual([
      ['pin', true, true],
      ['note', true, true],
    ]);
  });
});
