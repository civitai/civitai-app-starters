import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { chatConfig, configureChat } from '../config.js';
import { defineElements } from './define.js';

/**
 * A page that offers only its own models (`configureChat({ modelsOnly: true })`): the model button
 * shows for every viewer, lists the default and the page's models with each one's note, loads no
 * other list, and takes no typed id.
 */

beforeAll(() => defineElements());
const before = { model: chatConfig.model, models: chatConfig.models };
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  Object.assign(chatConfig, before);
  delete chatConfig.modelsOnly;
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

const PAGE_MODELS = {
  model: 'page/default',
  models: [
    { id: 'page/default', label: 'Page Default', note: 'Standard cost' },
    { id: 'page/cheaper', label: 'Cheaper', note: 'About half the cost' },
  ],
};

async function mount(fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  chat.mcp = { orchestration: false, site: false };
  chat.app = fakeApp();
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return chat;
}

const options = (chat: HTMLElement) => [...chat.shadowRoot!.querySelectorAll('.cvt-model-options button')].map((button) => button.textContent!.replace(/\s+/g, ' ').trim());

describe('a page that offers only its own models', () => {
  it('shows the model button without Premium models, with only its models and their notes, and loads no other list', async () => {
    configureChat({ ...PAGE_MODELS, modelsOnly: true });
    const fetch = vi.fn(async (_url: unknown) => new Response('{}', { status: 400 }));
    const chat = await mount(fetch);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-chip')).not.toBeNull());

    root.querySelector<HTMLButtonElement>('.cvt-model-chip')!.click();
    await chat.updateComplete;
    expect(options(chat)).toEqual(['Page Default · default Standard cost The app\'s default model', 'Cheaper About half the cost page/cheaper']);
    // No OpenRouter or orchestrator model list was asked for.
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.endsWith('/models'))).toEqual([]);

    // A typed id that is not listed is no option.
    const search = root.querySelector<HTMLInputElement>('.cvt-model-search')!;
    search.value = 'someone/unlisted-model';
    search.dispatchEvent(new Event('input'));
    await chat.updateComplete;
    expect(options(chat)).toEqual([]);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await chat.updateComplete;
    expect(root.querySelector<HTMLButtonElement>('.cvt-model-chip')!.title).toBe('Model for this chat: page/default');
  });

  it('switches the chat to a listed model, and its replies use it', async () => {
    configureChat({ ...PAGE_MODELS, modelsOnly: true });
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('{}', { status: 400 }));
    const chat = await mount(fetch);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-chip')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('.cvt-model-chip')!.click();
    await chat.updateComplete;
    [...root.querySelectorAll<HTMLButtonElement>('.cvt-model-options button')].find((button) => button.textContent!.includes('Cheaper'))!.click();
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.cvt-model-chip')!.title).toBe('Model for this chat: page/cheaper'));

    await chat.send('a red bike');
    const replies = () =>
      fetch.mock.calls.filter(([url]) => String(url).includes('chat/completions')).map(([, init]) => (JSON.parse(String(init?.body)) as { model: string }).model);
    await vi.waitFor(() => expect(replies()).toEqual(['page/cheaper']));
  });

  it('NEGATIVE CONTROL: without modelsOnly, the same page shows no model button until Premium models is on', async () => {
    configureChat(PAGE_MODELS);
    const chat = await mount(vi.fn(async () => new Response('{}', { status: 400 })));
    await chat.updateComplete;
    expect(chat.shadowRoot!.querySelector('.cvt-model-chip')).toBeNull();
  });
});
