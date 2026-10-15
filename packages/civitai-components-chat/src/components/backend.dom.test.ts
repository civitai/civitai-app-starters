import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend } from '../backend.js';
import { completion, isCivitaiRequest, memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import type { CivitaiChat } from './civitai-chat.js';
import type { CivitaiChatComposer } from './civitai-chat-composer.js';
import { defineElements } from './define.js';

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GATEWAY = '/api/llm';

/**
 * Every request the page makes, by URL. The gateway is reached through the page's own `fetch` (the
 * backend sets none), so the spy sees its requests too: proof the spy is on the path at all.
 */
function spyOnRequests(reply: (url: string, body: { stream?: boolean }) => Response = () => textReply('Hello ', 'there.')) {
  const urls: string[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    urls.push(url);
    if (!url.includes('/v1/chat/completions')) return new Response('not here', { status: 404 });
    const body = JSON.parse(String(init?.body)) as { stream?: boolean };
    return body.stream ? reply(url, body) : completion('Greeting');
  });
  vi.stubGlobal('fetch', spy);
  return urls;
}

function backendOf(store = memoryStore(), extra: Partial<ChatBackend> = {}): ChatBackend {
  return { url: GATEWAY, model: 'host/default-model', store, ...extra };
}

async function mount(set: (chat: CivitaiChat) => void): Promise<CivitaiChat> {
  const chat = document.createElement('civitai-chat');
  set(chat);
  document.body.append(chat);
  // The first test in a file pays the cold import of the whole runtime.
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return chat;
}

const root = (chat: CivitaiChat) => chat.shadowRoot!;
const threadText = (chat: CivitaiChat) => root(chat).querySelector('civitai-chat-thread')?.textContent ?? '';

function fakeApp() {
  return {
    getToken: async () => 'viewer-token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: vi.fn(async () => ({ items: [], next: '' })), submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })) },
  };
}

/** Send, then open the model list and Settings: everything a viewer would touch before a reload. */
async function useEverything(chat: CivitaiChat, sent: string): Promise<void> {
  await chat.send(sent);
  await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
  root(chat).querySelector<HTMLButtonElement>('.cvt-model-chip')?.click();
  root(chat).querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!.click();
  await chat.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('<civitai-chat> on a host backend', () => {
  it('makes no request to Civitai or OpenRouter through a send, the model list, Settings and a reload', async () => {
    const urls = spyOnRequests();
    const store = memoryStore();
    const backend = backendOf(store, { models: [{ id: 'host/big', label: 'Big' }] });
    const chat = await mount((c) => (c.backend = backend));

    await useEverything(chat, 'hello');
    expect(root(chat).querySelector('civitai-chat-settings-dialog')).toHaveProperty('open', true);
    expect(root(chat).querySelector('.cvt-model-menu')).not.toBeNull();
    expect(store.records.size).toBe(1);

    chat.remove();
    const again = await mount((c) => (c.backend = backend));
    await vi.waitFor(() => expect(threadText(again)).toContain('Hello there.'));
    expect(threadText(again)).toContain('hello');

    // Positive control on the same spy: it did see the gateway, so the zero below can be non-zero.
    expect(urls.filter((url) => url === `${location.origin}${GATEWAY}/v1/chat/completions`).length).toBeGreaterThanOrEqual(2);
    expect(urls.filter(isCivitaiRequest)).toEqual([]);
    expect(store.calls).toEqual(expect.arrayContaining(['list', `load ${[...store.records.keys()][0]}`]));
  });

  it('starts without an app or a sign-in, and shows nothing that needs Civitai', async () => {
    spyOnRequests();
    const signIn = vi.fn();
    const chat = await mount((c) => {
      c.signIn = signIn;
      c.backend = backendOf();
    });
    const composer = root(chat).querySelector<CivitaiChatComposer>('civitai-chat-composer')!;
    await chat.updateComplete;

    expect(root(chat).querySelector('.cvt-signed-out')).toBeNull();
    expect(composer.voice).toBe(false);
    expect(composer.noFiles).toBe(true);
    expect(composer.querySelector('[aria-label="Add a photo, video or audio file"]')).toBeNull();
    // One model: nothing to pick.
    expect(root(chat).querySelector('civitai-chat-model-picker')).toBeNull();
    expect(root(chat).querySelector('civitai-chat-welcome')?.textContent).toContain('How can I help?');
    expect(root(chat).querySelector('civitai-chat-welcome')?.textContent).not.toContain('Buzz');

    // Files would go to Civitai's orchestrator: none is taken, even through the method.
    chat.addFiles([new File(['x'], 'photo.png', { type: 'image/png' })]);
    expect(chat.uploads).toEqual([]);

    await chat.send('hello');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    await chat.updateComplete;
    expect(root(chat).querySelector('.cvt-spend')).toBeNull();
    expect(signIn).not.toHaveBeenCalled();

    root(chat).querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!.click();
    await chat.updateComplete;
    const settings = root(chat).querySelector('civitai-chat-settings-dialog')!;
    await (settings as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const labels = [...settings.querySelectorAll('[label]')].map((element) => element.getAttribute('label'));
    expect(labels).toEqual(expect.arrayContaining(['Longest reply step', 'Custom instructions']));
    for (const label of ['Ask before spending more than', 'Assistant', 'Show mature content']) expect(labels).not.toContain(label);
    expect(settings.textContent).not.toContain('Signed in');
  });

  it('never asks the page to sign in, even before the chat has loaded', async () => {
    spyOnRequests();
    const signIn = vi.fn(() => new Promise<never>(() => undefined));
    const chat = document.createElement('civitai-chat');
    chat.signIn = signIn;
    chat.backend = backendOf();
    document.body.append(chat);
    await chat.updateComplete;
    // The runtime is still loading: a loader, not the signed-out chat, and a message waits for it.
    expect(root(chat).querySelector('.cvt-signed-out')).toBeNull();
    const sent = chat.send('hello');
    await sent;
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    expect(signIn).not.toHaveBeenCalled();
  });

  it('tells the viewer when the host could not save the chat', async () => {
    spyOnRequests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    store.save = async () => {
      throw new Error('503');
    };
    const chat = await mount((c) => (c.backend = backendOf(store, { models: [{ id: 'host/big', label: 'Big' }] })));
    const toasts = () => [...root(chat).querySelectorAll('civitai-toast-region civitai-toast')].map((toast) => toast.textContent?.trim());
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

    // One failure, one note: a send, a model change and a rename of the open chat each say it once.
    await chat.send('hello');
    await vi.waitFor(() => expect(toasts()).toEqual(['Could not save this chat. It is saved again with your next message.']));
    await settle();
    expect(toasts()).toHaveLength(1);

    const picker = root(chat).querySelector('civitai-chat-model-picker')!;
    picker.dispatchEvent(new CustomEvent('cvt-model-pick', { detail: { model: 'host/big' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(toasts()).toHaveLength(2));
    await settle();
    expect(toasts().slice(1)).toEqual(["Could not save this chat's model; it applies until you reload."]);

    const sidebar = root(chat).querySelector('civitai-chat-sidebar')!;
    const id = sidebar.currentId;
    expect(id).toEqual(expect.any(String));
    sidebar.dispatchEvent(new CustomEvent('cvt-rename', { detail: { id, title: 'Renamed' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(toasts()).toHaveLength(3));
    await settle();
    expect(toasts().slice(2)).toEqual(['Could not rename that chat.']);

    // The command switches the model for this session too: it says so, as the picker does.
    root(chat).querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { detail: { text: '/model default' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(toasts()).toHaveLength(4));
    await settle();
    expect(toasts().slice(3)).toEqual(["Could not save this chat's model; it applies until you reload."]);
  });

  it('opens no shared panel: panels run on Civitai', async () => {
    spyOnRequests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    const chat = await mount((c) => (c.backend = backendOf(store)));
    await chat.openPanel({ v: 1, id: 'P1', version: 1, spec: { title: 'Beat maker', inputs: {}, run: { stepType: 'aceStepAudio', input: {} } }, values: {} } as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chat.panels).toEqual([]);
    expect(store.records.size).toBe(0);
  });

  it("offers the backend's models only, with no typed model id", async () => {
    spyOnRequests();
    const chat = await mount((c) => (c.backend = backendOf(memoryStore(), { models: [{ id: 'host/big', label: 'Big' }] })));
    const picker = root(chat).querySelector('civitai-chat-model-picker')!;
    picker.querySelector<HTMLButtonElement>('.cvt-model-chip')!.click();
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const search = picker.querySelector<HTMLInputElement>('.cvt-model-search')!;
    search.value = 'vendor/anything';
    search.dispatchEvent(new Event('input'));
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(picker.querySelector('.cvt-model-custom')).toBeNull();
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect([...picker.querySelectorAll('.cvt-model-name')].map((name) => name.textContent)).toEqual(['Default', 'Big']);
  });

  it('switches /model only to a model the backend names, and has no /model with one model', async () => {
    spyOnRequests();
    const toasts = (chat: CivitaiChat) => root(chat).querySelector('civitai-toast-region')?.textContent ?? '';
    const type = (chat: CivitaiChat, text: string) =>
      root(chat).querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { detail: { text }, bubbles: true, composed: true }));

    const chat = await mount((c) => (c.backend = backendOf(memoryStore(), { models: [{ id: 'host/big', label: 'Big' }] })));
    type(chat, '/model vendor/anything');
    await vi.waitFor(() => expect(toasts(chat)).toContain('There is no model called vendor/anything here.'));
    type(chat, '/model big');
    await vi.waitFor(() => expect(toasts(chat)).toContain('This chat now uses Big (host/big)'));

    chat.remove();
    const single = await mount((c) => (c.backend = backendOf()));
    type(single, '/model big');
    await vi.waitFor(() => expect(toasts(single)).toContain('There is no /model command.'));
  });

  it("shows the gateway's own refusal in the error card, and in reply-error", async () => {
    spyOnRequests(() => Response.json({ error: { message: 'You have used this month’s budget.' } }, { status: 402 }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chat = await mount((c) => (c.backend = backendOf()));
    const errors: { message: string }[] = [];
    chat.addEventListener('reply-error', (event) => errors.push((event as CustomEvent<{ message: string }>).detail));

    await chat.send('hello');
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-thread civitai-alert')?.textContent).toContain('You have used this month’s budget.'));
    expect(errors.map((error) => error.message)).toEqual(['You have used this month’s budget.']);
  });
});

describe('<civitai-chat> without a backend (the default)', () => {
  it('does reach Civitai through the same spy: the control for the zero above', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const urls = spyOnRequests();
    // Its built-in servers off, as the backend's are, so the reply (and the spy) gets as far as the model.
    const chat = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    await useEverything(chat, 'hello');
    const civitai = urls.filter(isCivitaiRequest);
    expect(civitai).toEqual(expect.arrayContaining(['https://orchestration.civitai.com/v1/chat/completions']));
    expect(civitai.length).toBeGreaterThan(1);
  });

  it('needs an app to start, keeps chats on the orchestrator, and still offers files and voice', async () => {
    spyOnRequests();
    const waiting = document.createElement('civitai-chat');
    document.body.append(waiting);
    await waiting.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(waiting.shadowRoot!.querySelector('.cvt-starting')).not.toBeNull();
    expect(waiting.shadowRoot!.querySelector('civitai-chat-composer')).toBeNull();

    const app = fakeApp();
    const chat = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = app as never;
    });
    await vi.waitFor(() => expect(app.orchestration.queryWorkflows).toHaveBeenCalledWith(expect.objectContaining({ tags: expect.arrayContaining(['chat-cvt', 'cvt:head']) })));
    const composer = root(chat).querySelector<CivitaiChatComposer>('civitai-chat-composer')!;
    expect(composer.voice).toBe(true);
    expect(composer.noFiles).toBe(false);
    expect(composer.querySelector('[aria-label="Add a photo, video or audio file"]')).not.toBeNull();
    expect(root(chat).querySelector('civitai-chat-model-picker')).not.toBeNull();
  });
});
