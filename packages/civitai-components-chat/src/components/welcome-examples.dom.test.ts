import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { memoryStore } from '../test-support/fake-backend.js';
import { flush } from '../test-support/fakes.js';
import type { CivitaiChat } from './civitai-chat.js';
import { CivitaiChatComposer } from './civitai-chat-composer.js';
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
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
}

/** A signed-in chat, or a signed-out one that signs in on send, showing its empty-chat welcome. */
async function mount(setup: (chat: CivitaiChat) => void, signedIn = true): Promise<CivitaiChat> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  setup(chat);
  if (signedIn) chat.app = fakeApp();
  else chat.signIn = () => new Promise<never>(() => undefined);
  document.body.append(chat);
  // The first mount in this file pays the cold import of the runtime.
  await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-welcome')).not.toBeNull(), { timeout: 10_000 });
  for (let i = 0; i < 3; i++) await flush();
  return chat;
}

const titles = (chat: CivitaiChat) =>
  [...chat.shadowRoot!.querySelectorAll('civitai-chat-welcome .cvt-example strong')].map((el) => el.textContent);

const composer = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-composer') as CivitaiChatComposer;

const BUILT_IN_HINT = 'Ask for a picture, a video, a song… or anything about Civitai';

const APP_EXAMPLES = [
  { title: 'Tip calculator', prompt: 'Build a tip calculator that splits the bill between friends' },
  { title: 'Memory game', prompt: 'Make a memory card game with images from my collections' },
];

describe('<civitai-chat> welcome examples', () => {
  it('shows the built-in examples when the page sets none', async () => {
    const chat = await mount(() => undefined);
    expect(titles(chat)).toEqual(['Make a picture', 'Change my photo', 'Make a short video', 'Write a song', 'Find a model', 'Say it out loud']);
  });

  it("shows the page's examples instead of the built-in ones", async () => {
    const chat = await mount((el) => (el.examples = APP_EXAMPLES));
    expect(titles(chat)).toEqual(['Tip calculator', 'Memory game']);
    expect(chat.shadowRoot!.querySelector('civitai-chat-welcome')?.textContent).not.toContain('Make a picture');
  });

  it("puts a clicked example's prompt in the message box", async () => {
    const chat = await mount((el) => (el.examples = APP_EXAMPLES));
    const buttons = chat.shadowRoot!.querySelectorAll<HTMLButtonElement>('civitai-chat-welcome .cvt-example');
    buttons[1]!.click();
    await vi.waitFor(() => expect(composer(chat).draft).toBe('Make a memory card game with images from my collections'));
  });

  it('uses examples set after the chat has started', async () => {
    const chat = await mount(() => undefined);
    chat.examples = APP_EXAMPLES;
    await chat.updateComplete;
    await vi.waitFor(() => expect(titles(chat)).toEqual(['Tip calculator', 'Memory game']));
  });

  it('shows no examples for an empty list', async () => {
    const chat = await mount((el) => (el.examples = []));
    expect(chat.shadowRoot!.querySelector('civitai-chat-welcome .cvt-examples')).toBeNull();
    expect(chat.shadowRoot!.querySelector('civitai-chat-welcome h1')?.textContent).toContain('what shall we make?');
  });

  it("shows the page's examples to a signed-out viewer too, and fills the message box from one", async () => {
    const chat = await mount((el) => (el.examples = APP_EXAMPLES), false);
    expect(titles(chat)).toEqual(['Tip calculator', 'Memory game']);
    chat.shadowRoot!.querySelector<HTMLButtonElement>('civitai-chat-welcome .cvt-example')!.click();
    await vi.waitFor(() => expect(composer(chat).draft).toBe('Build a tip calculator that splits the bill between friends'));
  });
});

describe("<civitai-chat> examples on a host's own backend", () => {
  /** A chat on a host backend, showing its empty-chat welcome. */
  async function hosted(setup: (chat: CivitaiChat) => void = () => undefined): Promise<CivitaiChat> {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chat = document.createElement('civitai-chat');
    chat.backend = { url: '/api/llm', model: 'host/default-model', store: memoryStore() };
    setup(chat);
    document.body.append(chat);
    await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-welcome')).not.toBeNull(), { timeout: 10_000 });
    for (let i = 0; i < 3; i++) await flush();
    await chat.updateComplete;
    return chat;
  }
  const BUILT_IN_TITLES = ['Make a picture', 'Change my photo', 'Make a short video', 'Write a song', 'Find a model', 'Say it out loud'];
  const buttons = (chat: CivitaiChat) => chat.shadowRoot!.querySelectorAll<HTMLButtonElement>('civitai-chat-welcome .cvt-example');

  it("shows the page's examples, and a click puts its prompt in the message box", async () => {
    const chat = await hosted((el) => (el.examples = APP_EXAMPLES));
    expect(titles(chat)).toEqual(['Tip calculator', 'Memory game']);
    buttons(chat)[1]!.click();
    await vi.waitFor(() => expect(composer(chat).draft).toBe('Make a memory card game with images from my collections'));
  });

  it('shows no examples, and none of the built-in ones, when the page sets none', async () => {
    const chat = await hosted();
    expect(buttons(chat)).toHaveLength(0);
    const text = chat.shadowRoot!.querySelector('civitai-chat-welcome')!.textContent ?? '';
    for (const title of BUILT_IN_TITLES) expect(text).not.toContain(title);
  });

  it('shows no examples for an empty list', async () => {
    const chat = await hosted((el) => (el.examples = []));
    expect(buttons(chat)).toHaveLength(0);
    expect(chat.shadowRoot!.querySelector('civitai-chat-welcome .cvt-examples')).toBeNull();
  });

  it('keeps the greeting plain with examples set: the same heading as without them', async () => {
    const bare = (await hosted()).shadowRoot!.querySelector('civitai-chat-welcome h1')!.textContent;
    document.body.replaceChildren();
    const withExamples = await hosted((el) => (el.examples = APP_EXAMPLES));
    expect(withExamples.shadowRoot!.querySelector('civitai-chat-welcome h1')!.textContent).toBe(bare);
    expect(withExamples.shadowRoot!.querySelector('civitai-chat-welcome .cvt-fineprint')).toBeNull();
  });

  it('a file-wanting example fills the message box but opens no picker: the chat takes no files', async () => {
    const picker = vi.spyOn(HTMLInputElement.prototype, 'click');
    const chat = await hosted((el) => (el.examples = [{ title: 'Restyle my photo', prompt: 'Turn my photo into a watercolor', wantsFile: true }]));
    buttons(chat)[0]!.click();
    await vi.waitFor(() => expect(composer(chat).draft).toBe('Turn my photo into a watercolor'));
    expect(picker).not.toHaveBeenCalled();
  });

  it("INVARIANT GUARD: the page's hint still shows beside its examples", async () => {
    const chat = await hosted((el) => {
      el.examples = APP_EXAMPLES;
      el.placeholder = 'Ask the docs';
    });
    expect(composer(chat).placeholder).toBe('Ask the docs');
  });
});

describe('<civitai-chat> examples that want a file', () => {
  const PHOTO_EXAMPLE = [{ title: 'Restyle my photo', prompt: 'Turn my photo into a watercolor', wantsFile: true }];

  it.each([
    ['signed in', true],
    ['signed out', false],
  ])("open the file picker from a page's example, %s", async (_label, signedIn) => {
    const browse = vi.spyOn(CivitaiChatComposer.prototype, 'browse').mockImplementation(() => undefined);
    const chat = await mount((el) => (el.examples = PHOTO_EXAMPLE), signedIn);
    chat.shadowRoot!.querySelector<HTMLButtonElement>('civitai-chat-welcome .cvt-example')!.click();
    await vi.waitFor(() => expect(composer(chat).draft).toBe('Turn my photo into a watercolor'));
    expect(browse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['signed in', true],
    ['signed out', false],
  ])('NEGATIVE CONTROL: an example that wants no file opens no picker, %s', async (_label, signedIn) => {
    const browse = vi.spyOn(CivitaiChatComposer.prototype, 'browse').mockImplementation(() => undefined);
    const chat = await mount((el) => (el.examples = APP_EXAMPLES), signedIn);
    chat.shadowRoot!.querySelector<HTMLButtonElement>('civitai-chat-welcome .cvt-example')!.click();
    await vi.waitFor(() => expect(composer(chat).draft).toBe('Build a tip calculator that splits the bill between friends'));
    expect(browse).not.toHaveBeenCalled();
  });
});

describe('<civitai-chat> signing in keeps what the viewer was writing', () => {
  /** A signed-out chat whose sign-in finishes when the test says so. */
  async function signedOut(setup: (chat: CivitaiChat) => void = () => undefined) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = fakeApp() as { orchestration: { submitWorkflow: ReturnType<typeof vi.fn> } };
    let finish = (): void => undefined;
    const chat = document.createElement('civitai-chat');
    chat.signIn = vi.fn(() => new Promise<never>((resolve) => (finish = () => resolve(app as never))));
    setup(chat);
    document.body.append(chat);
    await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    return { chat, app, finish: () => finish() };
  }
  const photo = () => new File(['x'], 'photo.png', { type: 'image/png' });

  it('a file-wanting example: the file and the example both survive sign-in', async () => {
    vi.spyOn(CivitaiChatComposer.prototype, 'browse').mockImplementation(() => undefined);
    const { chat, finish } = await signedOut(
      (el) => (el.examples = [{ title: 'Restyle my photo', prompt: 'Turn my photo into a watercolor', wantsFile: true }])
    );
    chat.shadowRoot!.querySelector<HTMLButtonElement>('civitai-chat-welcome .cvt-example')!.click();
    await vi.waitFor(() => expect(composer(chat).draft).toBe('Turn my photo into a watercolor'));
    const before = composer(chat);
    // The picker hands its files over as the composer's file event does.
    chat.addFiles([photo()]);
    finish();
    await vi.waitFor(() => expect(composer(chat)).not.toBe(before));
    await vi.waitFor(() => expect(chat.uploads).toHaveLength(1));
    expect(composer(chat).draft).toBe('Turn my photo into a watercolor');
  });

  it('what the viewer typed survives adding a file and signing in', async () => {
    const { chat, finish } = await signedOut();
    composer(chat).draft = 'a red bike';
    chat.addFiles([photo()]);
    finish();
    await vi.waitFor(() => expect(chat.uploads).toHaveLength(1));
    await vi.waitFor(() => expect(composer(chat).draft).toBe('a red bike'));
  });

  it('a returning viewer sees the text in the new box while their last chat loads, and keeps what they type then', async () => {
    localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
    const { chat, app, finish } = await signedOut();
    const held: (() => void)[] = [];
    const load = () => held.splice(0).forEach((release) => release());
    (app.orchestration as unknown as { queryWorkflows: unknown }).queryWorkflows = (query: { tags: string[] }) =>
      query.tags.includes('cvt:conv:CONV1')
        ? new Promise((resolve) => held.push(() => resolve({ items: [], next: '' })))
        : Promise.resolve({ items: [], next: '' });
    const before = composer(chat);
    composer(chat).draft = 'a red bike';
    chat.addFiles([photo()]);
    finish();
    await vi.waitFor(() => expect(composer(chat)).not.toBe(before));
    // Signed in, the last chat still loading.
    await vi.waitFor(() => expect(composer(chat).draft).toBe('a red bike'));
    composer(chat).draft = 'a blue bike';
    for (let i = 0; i < 5; i++) await flush();
    expect(held.length).toBeGreaterThan(0);
    load();
    await vi.waitFor(() => expect(chat.uploads).toHaveLength(1));
    for (let i = 0; i < 5; i++) await flush();
    expect(composer(chat).draft).toBe('a blue bike');
  });

  it('a message sent while signed out is sent, not left in the box as well', async () => {
    const { chat, app, finish } = await signedOut();
    composer(chat).dispatchEvent(new CustomEvent('cvt-send', { detail: { text: 'a red bike' } }));
    finish();
    await vi.waitFor(() => expect(app.orchestration.submitWorkflow).toHaveBeenCalled());
    expect(composer(chat).draft).toBe('');
  });
});

describe('<civitai-chat> placeholder', () => {
  it('keeps the built-in hint when the page sets none', async () => {
    const chat = await mount(() => undefined);
    expect(composer(chat).placeholder).toBe('Ask for a picture, a video, a song… or anything about Civitai');
  });

  it.each([
    ['signed in', true],
    ['signed out', false],
  ])('restores the built-in hint when the page clears its own, %s', async (_label, signedIn) => {
    const hint = 'Describe the app you want to build';
    const chat = await mount((el) => (el.placeholder = hint), signedIn);
    expect(composer(chat).placeholder).toBe(hint);

    chat.placeholder = undefined;
    await chat.updateComplete;
    expect(composer(chat).placeholder).toBe(BUILT_IN_HINT);

    chat.setAttribute('placeholder', hint);
    await chat.updateComplete;
    expect(composer(chat).placeholder).toBe(hint);
    chat.removeAttribute('placeholder');
    await chat.updateComplete;
    expect(composer(chat).placeholder).toBe(BUILT_IN_HINT);
  });

  // INVARIANT GUARD (existing behaviour): the page's hint on a host backend, with no examples set.
  it("puts the page's hint ahead of a host backend's own, and falls back to it", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const chat = document.createElement('civitai-chat');
    chat.backend = { url: '/api/llm', model: 'host/default-model', store: memoryStore() };
    chat.placeholder = 'Ask the docs';
    document.body.append(chat);
    await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    await chat.updateComplete;
    expect(composer(chat).placeholder).toBe('Ask the docs');
    chat.placeholder = undefined;
    await chat.updateComplete;
    expect(composer(chat).placeholder).toBe('Ask anything');
  });

  it("shows the page's hint in the message box, signed in or not", async () => {
    const hint = 'Describe the app you want to build';
    expect(composer(await mount((el) => (el.placeholder = hint))).placeholder).toBe(hint);
    document.body.replaceChildren();
    expect(composer(await mount((el) => (el.placeholder = hint), false)).placeholder).toBe(hint);
  });
});
