import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { chatConfig, configureChat } from '../config.js';
import { flush } from '../test-support/fakes.js';
import { defineElements } from './define.js';

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
}

describe('civitai-chat', () => {
  it("lives in its own shadow root inside another app and leaves that page's theme and keys alone", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('cvt:settings:board', JSON.stringify({ theme: 'dark' }));
    const chat = document.createElement('civitai-chat');
    chat.scope = 'board';
    chat.app = fakeApp();
    document.body.append(chat);
    // The first test in this file pays the cold import of the whole runtime.
    await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });

    expect(document.querySelector('civitai-chat-composer')).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    const shortcut = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    document.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
  });

  it('shows the chat list as soon as it loads, without waiting for the viewer to do something', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let deliver = (): void => undefined;
    const head = {
      id: '7-1',
      status: 'succeeded',
      tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
      metadata: { v: 2, app: 'chat-cvt', conversationId: 'CONV1', title: 'Animate this', titleSource: 'llm', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', turns: [] },
    };
    const app = fakeApp() as { orchestration: { queryWorkflows: unknown } };
    app.orchestration.queryWorkflows = (query: { tags: string[] }) =>
      query.tags.some((tag) => tag.startsWith('cvt:conv:'))
        ? Promise.resolve({ items: [], next: '' })
        : new Promise((resolve) => (deliver = () => resolve({ items: [head], next: '' })));
    const chat = document.createElement('civitai-chat');
    chat.layout = 'wide';
    chat.app = app as never;
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-sidebar')?.textContent).toContain('Your chats will appear here'));

    deliver();
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-sidebar')?.textContent).toContain('Animate this'));
  });

  it('opens the chat list from the title and closes it on Escape, on a click elsewhere, or when settings open', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chat = document.createElement('civitai-chat');
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('.cvt-history-toggle')).not.toBeNull());
    const toggle = root.querySelector<HTMLButtonElement>('.cvt-history-toggle')!;
    const open = async () => {
      toggle.click();
      await chat.updateComplete;
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(root.querySelector('.cvt-history civitai-chat-sidebar')).not.toBeNull();
    };

    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await chat.updateComplete;
    expect(root.querySelector('.cvt-history')).toBeNull();
    expect(root.activeElement).toBe(toggle);

    await open();
    root.querySelector('.cvt-history')!.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await chat.updateComplete;
    expect(root.querySelector('.cvt-history')).not.toBeNull();
    root.querySelector('civitai-chat-composer')!.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await chat.updateComplete;
    expect(root.querySelector('.cvt-history')).toBeNull();

    await open();
    root.querySelector<HTMLButtonElement>('.cvt-history [aria-label="Settings"]')!.click();
    await chat.updateComplete;
    expect(root.querySelector('.cvt-history')).toBeNull();
  });

  it('opens signed out and signs in only when the viewer sends, then sends what they wrote', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = fakeApp() as { orchestration: { submitWorkflow: ReturnType<typeof vi.fn> } };
    let finish = (_: unknown): void => undefined;
    const signIn = vi.fn(() => new Promise<never>((resolve) => (finish = resolve as never)));
    const chat = document.createElement('civitai-chat');
    chat.signIn = signIn;
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());
    expect(root.querySelector('civitai-chat-welcome')).not.toBeNull();
    expect(signIn).not.toHaveBeenCalled();

    root.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { detail: { text: 'a red bike' } }));
    expect(signIn).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')!.draft).toBe('a red bike'));

    finish(app);
    await vi.waitFor(() => expect(app.orchestration.submitWorkflow).toHaveBeenCalled());
    expect(JSON.stringify(app.orchestration.submitWorkflow.mock.calls[0])).toContain('a red bike');
  });

  it("asks the host's sign-in for permission to spend Buzz once, before the first message goes out", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = fakeApp() as { requestGrants: ReturnType<typeof vi.fn>; orchestration: { submitWorkflow: ReturnType<typeof vi.fn> } };
    app.requestGrants = vi.fn(async () => true);
    const chat = document.createElement('civitai-chat');
    chat.app = app as never;
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());

    await chat.send('a red bike');
    await chat.send('a blue bike');

    expect(app.requestGrants).toHaveBeenCalledTimes(1);
    // With a signal, so a consent dialog the viewer closes (which answers nothing) cannot hold the chat forever.
    expect(app.requestGrants).toHaveBeenCalledWith(['ai:write:budgeted'], { signal: expect.any(AbortSignal) });
    expect(app.orchestration.submitWorkflow).toHaveBeenCalled();
  });

  it('sends nothing and keeps the message when the host cannot grant that permission', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = fakeApp() as { requestGrants: ReturnType<typeof vi.fn>; orchestration: { submitWorkflow: ReturnType<typeof vi.fn> } };
    app.requestGrants = vi.fn(async () => false);
    const chat = document.createElement('civitai-chat');
    chat.app = app as never;
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());

    await chat.send('a red bike');

    expect(app.orchestration.submitWorkflow).not.toHaveBeenCalled();
    expect(root.querySelector('civitai-chat-composer')!.draft).toBe('a red bike');
    expect(root.querySelector('civitai-toast-region')!.textContent).toContain('permission to use your Buzz');
  });

  it('says the viewer is signed out where their chats would be, and signs in from there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const signIn = vi.fn(async () => fakeApp());
    const chat = document.createElement('civitai-chat');
    chat.signIn = signIn;
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('[aria-label="Your chats"]')).not.toBeNull());
    expect(root.querySelector('[aria-label="Your chats"]')!.textContent).toContain('signed out');
    expect(root.querySelector('.cvt-topbar')!.textContent).toContain('Signed out');

    root.querySelector<HTMLElement>('.cvt-topbar civitai-button')!.click();
    expect(signIn).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-sidebar')).not.toBeNull());
  });

  it('keeps the message in the box when the viewer closes the sign-in', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chat = document.createElement('civitai-chat');
    chat.signIn = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('sign-in was canceled'), { code: 'canceled' }))));
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());

    root.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { detail: { text: 'a red bike' } }));
    await vi.waitFor(() => expect(root.querySelector('.cvt-sign-in-status button')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('.cvt-sign-in-status button')!.click();

    await vi.waitFor(() => expect(root.querySelector('.cvt-sign-in-status button')).toBeNull());
    expect(root.querySelector('civitai-chat-composer')!.draft).toBe('a red bike');
    expect(root.querySelector('civitai-toast-region')!.textContent).not.toContain('Sign-in');
  });

  it('offers appearance and sign out in settings only when the chat is the whole page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settingsText = async (chat: HTMLElement & { app?: unknown }) => {
      chat.app = fakeApp();
      document.body.append(chat);
      const root = chat.shadowRoot!;
      await vi.waitFor(() => expect(root.querySelector('civitai-chat-sidebar [aria-label="Settings"]')).not.toBeNull());
      root.querySelector<HTMLButtonElement>('civitai-chat-sidebar [aria-label="Settings"]')!.click();
      await vi.waitFor(() => expect(root.querySelector('civitai-chat-settings-dialog')?.innerHTML).toContain('Custom instructions'));
      return root.querySelector('civitai-chat-settings-dialog')!.innerHTML;
    };

    const embedded = await settingsText(document.createElement('civitai-chat'));
    expect(embedded).not.toContain('Appearance');
    expect(embedded).not.toContain('Sign out');

    document.body.replaceChildren();
    const page = document.createElement('civitai-chat');
    page.setAttribute('full-page', '');
    page.setAttribute('can-sign-out', '');
    const whole = await settingsText(page);
    expect(whole).toContain('Appearance');
    expect(whole).toContain('Sign out');
  });

  it('shows what the embedding page puts in the welcome slot instead of the built-in welcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chat = document.createElement('civitai-chat');
    chat.innerHTML = '<div slot="welcome">Welcome to Moodboard</div>';
    chat.app = fakeApp();
    document.body.append(chat);
    await vi.waitFor(() => expect(chat.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="welcome"]')).not.toBeNull());
    const slot = chat.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="welcome"]')!;
    expect(slot.assignedElements().map((el) => el.textContent)).toEqual(['Welcome to Moodboard']);
  });

  it("runs slash commands itself: switches this chat's model and starts a new chat without asking the assistant", async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('cvt:settings', JSON.stringify({ assistantModel: 'viewer/default-model' }));
    const app = fakeApp() as { orchestration: { submitWorkflow: ReturnType<typeof vi.fn> } };
    const chat = document.createElement('civitai-chat');
    // No tool servers, so a reply goes straight to the model.
    chat.mcp = { orchestration: false, site: false };
    chat.app = app as never;
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-model-picker')).not.toBeNull());
    const composer = root.querySelector('civitai-chat-composer')!;
    const say = (text: string) => composer.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text } }));
    const toast = () => root.querySelector('civitai-toast-region')!.textContent ?? '';
    const chip = () => root.querySelector<HTMLButtonElement>('.cvt-model-chip')!;
    const replies = () =>
      fetch.mock.calls.filter(([url]) => String(url).includes('chat/completions')).map(([, init]) => (JSON.parse(String(init?.body)) as { model: string }).model);

    say('/model');
    await vi.waitFor(() => expect(toast()).toContain('This chat uses the default (viewer/default-model).'));

    say('/model z-ai/glm-5.3-flash');
    await vi.waitFor(() => expect(chip().title).toBe('Model for this chat: z-ai/glm-5.3-flash'));
    expect(toast()).toContain('This chat now uses z-ai/glm-5.3-flash, from the next reply.');
    // The chat's own choice: the viewer's default stays as it was.
    expect(JSON.parse(localStorage.getItem('cvt:settings') ?? '{}').assistantModel).toBe('viewer/default-model');

    await chat.send('a red bike');
    await vi.waitFor(() => expect(replies()).toEqual(['z-ai/glm-5.3-flash']));
    expect(app.orchestration.submitWorkflow.mock.calls[0]?.[0]).toMatchObject({ metadata: { model: 'z-ai/glm-5.3-flash' } });

    say('/model default');
    await vi.waitFor(() => expect(chip().title).toBe('Model for this chat: viewer/default-model'));
    await chat.send('a blue bike');
    await vi.waitFor(() => expect(replies()).toEqual(['z-ai/glm-5.3-flash', 'viewer/default-model']));

    say('/clear');
    await chat.updateComplete;
    expect(replies()).toHaveLength(2);
  });

  it("picks this chat's model from a searchable list priced per million input and output tokens, or any model id", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const openRouter = {
      data: [
        { id: 'cheap/model', name: 'Cheap Model', pricing: { prompt: '0.00000015', completion: '0.00000061' }, supported_parameters: ['tools'] },
        { id: 'pricey/model', name: 'Pricey Model', pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['tools'] },
      ],
    };
    const routable = {
      data: [
        { id: 'cheap/model', owned_by: 'openrouter' },
        { id: 'pricey/model', owned_by: 'openrouter' },
        // Fits 1,024 + 34,000 tokens of reply, history, prompt and tools; not 16,384 + 34,000.
        { id: 'civitai/narrow-window', owned_by: 'civitai', context_length: 36_000 },
        { id: 'urn:air:hosted:behind-an-alias', owned_by: 'civitai', context_length: 262_144 },
      ],
    };
    const fetch = vi.fn(async (url: unknown, _init?: RequestInit) => {
      if (String(url) === 'https://openrouter.ai/api/v1/models') return new Response(JSON.stringify(openRouter));
      if (String(url).endsWith('/v1/models')) return new Response(JSON.stringify(routable));
      return new Response('{}', { status: 400 });
    });
    vi.stubGlobal('fetch', fetch);
    const chat = document.createElement('civitai-chat');
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-chip')).not.toBeNull());
    const chip = root.querySelector<HTMLButtonElement>('.cvt-model-chip')!;
    // The default is shown by its name, marked as the default, never as the bare word "Default".
    expect(chip.textContent).toContain('civitai/qwen3.8 · default');
    expect(chip.textContent).not.toMatch(/\bDefault\b/);
    const options = () => [...root.querySelectorAll('.cvt-model-options button')].map((button) => button.textContent!.replace(/\s+/g, ' ').trim());

    chip.click();
    await vi.waitFor(() => expect(options()).toContain('Cheap Model $0.15 in · $0.61 out /M cheap/model'));
    expect(options().join(' | ')).not.toContain('Pricey');
    expect(options().join(' | ')).not.toContain('behind-an-alias');
    expect(options().join(' | ')).not.toContain('narrow-window');
    const search = root.querySelector<HTMLInputElement>('.cvt-model-search')!;
    search.value = 'cheap';
    search.dispatchEvent(new Event('input'));
    await chat.updateComplete;
    root.querySelector<HTMLButtonElement>('.cvt-model-options button')!.click();
    await vi.waitFor(() => expect(chip.title).toBe('Model for this chat: cheap/model'));
    expect(chip.textContent).toContain('Cheap Model');
    expect(root.querySelector('.cvt-model-menu')).toBeNull();

    chip.click();
    await chat.updateComplete;
    const typed = root.querySelector<HTMLInputElement>('.cvt-model-search')!;
    typed.value = 'someone/unlisted-model';
    typed.dispatchEvent(new Event('input'));
    await chat.updateComplete;
    expect(options()).toEqual(['Use “someone/unlisted-model” Any chat model id the Civitai orchestrator serves']);
    typed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(chip.title).toBe('Model for this chat: someone/unlisted-model'));
    // A smaller reply cap leaves room for the narrow model, from the next look at the list.
    root.querySelector('civitai-chat-settings-dialog')!.dispatchEvent(new CustomEvent('cvt-settings-change', { detail: { maxOutputTokens: 1_024 } }));
    await chat.updateComplete;
    chip.click();
    await chat.updateComplete;
    expect(options().join(' | ')).toContain('civitai/narrow-window Hosted');
    // The list loaded once for the session.
    expect(fetch.mock.calls.filter(([url]) => String(url) === 'https://openrouter.ai/api/v1/models')).toHaveLength(1);
  });

  it("keeps listing and marking this chat's own model even when its window is too small for the cap", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const routable = {
      data: [
        { id: 'civitai/tiny-current', owned_by: 'civitai', context_length: 13_312 },
        { id: 'civitai/tiny-other', owned_by: 'civitai', context_length: 16_384 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => (String(url).endsWith('/v1/models') && !String(url).includes('openrouter') ? new Response(JSON.stringify(routable)) : new Response('{}', { status: 400 }))),
    );
    const chat = document.createElement('civitai-chat');
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-chip')).not.toBeNull());
    root.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text: '/model civitai/tiny-current' } }));
    const chip = root.querySelector<HTMLButtonElement>('.cvt-model-chip')!;
    await vi.waitFor(() => expect(chip.title).toBe('Model for this chat: civitai/tiny-current'));

    chip.click();
    const names = () => [...root.querySelectorAll('.cvt-model-options .cvt-model-name')].map((name) => name.textContent);
    // Wait for the hosted list itself, not for an absence that holds before anything renders.
    await vi.waitFor(() => expect(names()).toContain('civitai/tiny-current'));
    const listed = [...root.querySelectorAll('.cvt-model-options [role=option]')].map((option) => [option.querySelector('.cvt-model-name')!.textContent, option.getAttribute('aria-selected')]);
    expect(listed).toContainEqual(['civitai/tiny-current', 'true']);
    expect(listed.map(([name]) => name)).not.toContain('civitai/tiny-other');
  });

  it("goes back to the viewer's own default when they type Default in the model list", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    localStorage.setItem('cvt:settings', JSON.stringify({ assistantModel: 'z-ai/glm-5.3-prime' }));
    const chat = document.createElement('civitai-chat');
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-chip')).not.toBeNull());
    const chip = root.querySelector<HTMLButtonElement>('.cvt-model-chip')!;
    root.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text: '/model q/quill' } }));
    await vi.waitFor(() => expect(chip.title).toBe('Model for this chat: q/quill'));

    for (const typed of ['default', 'Default']) {
      chip.click();
      await chat.updateComplete;
      const search = root.querySelector<HTMLInputElement>('.cvt-model-search')!;
      search.value = typed;
      search.dispatchEvent(new Event('input'));
      await chat.updateComplete;
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.waitFor(() => expect(chip.title).toBe('Model for this chat: z-ai/glm-5.3-prime'));
      const own = root.querySelector('civitai-chat-model-picker')!.own;
      expect(own).toBe(false);
      // Pinned again for the second spelling.
      root.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text: '/model q/quill' } }));
      await vi.waitFor(() => expect(chip.title).toBe('Model for this chat: q/quill'));
    }
  });

  it('lets a viewer stuck on Free with a model that has no free replies allow paid replies and get the reply', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('cvt:settings', JSON.stringify({ assistantTier: 'free' }));
    const replies: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target.includes('free-tier')) {
          return new Response(JSON.stringify({ enabled: true, models: [{ key: 'default-chat', airs: ['urn:air:only:the-default'], remaining: 5, windows: [{ limit: 10, remaining: 5 }] }] }));
        }
        if (target.includes('chat/completions')) {
          replies.push(new Headers(init?.headers).get('X-Civitai-Tier'));
          return new Response('{}', { status: 400 });
        }
        return new Response('{}');
      }),
    );
    const chat = document.createElement('civitai-chat');
    chat.mcp = { orchestration: false, site: false };
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());
    root.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text: '/model z-ai/not-free' } }));
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.cvt-model-chip')!.title).toBe('Model for this chat: z-ai/not-free'));

    await chat.send('a red bike');
    const button = () => [...root.querySelectorAll<HTMLElement>('civitai-chat-thread civitai-button')].find((b) => b.textContent?.includes('Allow paid replies and try again'));
    await vi.waitFor(() => expect(button()).toBeDefined());
    expect(replies).toEqual([]);

    button()!.click();
    await vi.waitFor(() => expect(replies).toEqual([null]));
    expect(JSON.parse(localStorage.getItem('cvt:settings') ?? '{}').assistantTier).toBe('auto');
  });

  it('offers Continue on a reply that ran out of steps, and Continue asks the assistant to carry on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sse = (...chunks: unknown[]) =>
      new Response([...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join(''), { headers: { 'content-type': 'text/event-stream' } });
    const choice = { question: 'Which?', options: '[{"label":"A"}' };
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (!String(url).includes('chat/completions')) return new Response('{}');
        const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: unknown }[]; tool_choice?: unknown; stream?: boolean };
        // Naming the chat is a separate, non-streamed request.
        if (!body.stream) return new Response(JSON.stringify({ id: 't', choices: [{ index: 0, message: { role: 'assistant', content: 'Pomodoro' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
        sent.push(JSON.stringify(body.messages.filter((m) => m.role === 'user').at(-1)?.content));
        // A choice the card cannot show, then a forced last step that says nothing.
        if (body.tool_choice === 'none') return sse({ id: 'r', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        return sse(
          { id: 'r', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `c${sent.length}`, type: 'function', function: { name: 'ask_choice', arguments: JSON.stringify(choice) } }] }, finish_reason: null }] },
          { id: 'r', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        );
      }),
    );
    configureChat({ maxSteps: 2 });
    try {
      const chat = document.createElement('civitai-chat');
      chat.mcp = { orchestration: false, site: false };
      chat.app = fakeApp();
      document.body.append(chat);
      const root = chat.shadowRoot!;
      await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());

      await chat.send('build me a pomodoro timer');
      const button = () => [...root.querySelectorAll<HTMLElement>('civitai-chat-thread .cvt-ran-out civitai-button')].find((b) => b.textContent?.trim() === 'Continue');
      await vi.waitFor(() => expect(button()).toBeDefined());
      expect(sent).toHaveLength(2);

      button()!.click();
      await vi.waitFor(() => expect(sent).toHaveLength(4));
      expect(sent[2]).toContain('Continue where you left off.');
    } finally {
      delete chatConfig.maxSteps;
    }
  });

  it('reports a failed reply to the page as reply-error, with where it broke', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).includes('chat/completions') ? new Response(JSON.stringify({ error: { message: 'upstream exploded' } }), { status: 422, headers: { 'content-type': 'application/json', 'x-request-id': 'req-7' } }) : new Response('{}'),
      ),
    );
    const chat = document.createElement('civitai-chat');
    chat.mcp = { orchestration: false, site: false };
    chat.app = fakeApp();
    const reported: { kind: string; trace: Record<string, unknown> }[] = [];
    chat.addEventListener('reply-error', (event) => reported.push((event as CustomEvent).detail));
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());

    await chat.send('hello');
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    expect(reported[0]!.trace).toMatchObject({ stage: 'request', step: 1, statusCode: 422, requestId: 'req-7', name: 'AI_APICallError' });
  });

  it('still offers the default and a custom model id when neither model list can be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const chat = document.createElement('civitai-chat');
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-chip')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('.cvt-model-chip')!.click();
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-menu')).not.toBeNull());
    // Loading ends, and the picker does not keep saying it is loading.
    await vi.waitFor(() => expect(root.querySelector('.cvt-model-status')).toBeNull());
    const options = () => [...root.querySelectorAll('.cvt-model-options button')].map((button) => button.textContent!.replace(/\s+/g, ' ').trim());
    expect(options()).toEqual(["civitai/qwen3.8 · default The app's default model"]);
    const search = root.querySelector<HTMLInputElement>('.cvt-model-search')!;
    search.value = 'z-ai/glm-5.3-flash';
    search.dispatchEvent(new Event('input'));
    await chat.updateComplete;
    expect(options()).toEqual(['Use “z-ai/glm-5.3-flash” Any chat model id the Civitai orchestrator serves']);
  });

  it("runs the page's own slash commands, and lets it replace or remove the built-ins", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pinned: string[] = [];
    const chat = document.createElement('civitai-chat');
    chat.commands = {
      pin: { usage: '/pin <name>', help: 'Pin it to your board', run: (arg, { compose }) => (pinned.push(arg), compose(`Pinned ${arg}. Anything else?`)) },
      model: null,
    };
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());
    const composer = root.querySelector('civitai-chat-composer')!;
    const say = (text: string) => composer.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text } }));

    expect(Object.keys(composer.commands)).toEqual(['clear', 'help', 'pin']);
    say('/pin sunset');
    await vi.waitFor(() => expect(composer.draft).toBe('Pinned sunset. Anything else?'));
    expect(pinned).toEqual(['sunset']);

    say('/model smart');
    await chat.updateComplete;
    expect(JSON.parse(localStorage.getItem('cvt:settings') ?? '{}').assistantModel).toBeUndefined();
  });
});

/**
 * The viewer's name, on real `@civitai/sdk` clients rather than a hand-rolled fake, observed at
 * the fetch the client makes. `/api/v1/me` accepts an OAuth token and refuses the block-scoped
 * one, so a block must not ask it.
 */
describe("civitai-chat's viewer name", () => {
  const SITE = 'https://site.test/api/v1';
  const meCalls = (fetchSpy: ReturnType<typeof vi.fn>) =>
    fetchSpy.mock.calls.filter(([input]) => new URL(String(input instanceof Request ? input.url : input)).pathname.endsWith('/me'));

  function recordingFetch(username: string) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      // A block-scoped token gets 401 here in production; serving 200 keeps a stray call visible as a name.
      if (url.pathname.endsWith('/me')) return Response.json({ username });
      return new Response('{}', { status: 503 });
    });
  }

  async function mount(app: unknown) {
    const chat = document.createElement('civitai-chat');
    chat.app = app as never;
    document.body.append(chat);
    await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-welcome')).not.toBeNull());
    // The same settle in both tests, so the OAuth one is the positive control for this window.
    for (let i = 0; i < 5; i++) await flush();
    return chat;
  }

  it('sends no /me request from a block holding the block-scoped token, and names the viewer from the host', async () => {
    const fetchSpy = recordingFetch('from-me');
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { initialize } = await import('@civitai/sdk');
    const { createFakeTransport } = await import('@civitai/sdk/testing');
    const transport = createFakeTransport({
      viewer: { id: 7, username: 'host-viewer' },
      token: { raw: 'block-jwt', scopes: [], expiresAt: new Date(Date.now() + 600_000), kind: 'block' },
    });
    const app = await initialize({ transport, siteUrl: SITE, fetch: fetchSpy as typeof fetch });
    const chat = await mount(app);

    expect(meCalls(fetchSpy)).toHaveLength(0);
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-welcome')?.textContent).toContain('Hi host-viewer'));
  });

  it('still asks /me for the name with an OAuth token outside a block', async () => {
    const fetchSpy = recordingFetch('from-me');
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { initialize } = await import('@civitai/sdk');
    const app = await initialize({ token: async () => 'oauth-access-token', requestGrants: () => true, siteUrl: SITE, fetch: fetchSpy as typeof fetch });
    const chat = await mount(app);

    expect(meCalls(fetchSpy)).toHaveLength(1);
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-welcome')?.textContent).toContain('Hi from-me'));
    const [input, init] = meCalls(fetchSpy)[0]!;
    const headers = new Headers(input instanceof Request ? input.headers : (init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer oauth-access-token');
  });
});
