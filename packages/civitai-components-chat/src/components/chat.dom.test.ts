import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
    await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-composer')).not.toBeNull());

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
    expect(app.requestGrants).toHaveBeenCalledWith(['ai:write:budgeted']);
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

  it('runs slash commands itself: switches the model and starts a new chat without asking the assistant', async () => {
    const fetch = vi.fn(async (_url: unknown) => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chat = document.createElement('civitai-chat');
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer')).not.toBeNull());
    const composer = root.querySelector('civitai-chat-composer')!;
    const say = (text: string) => composer.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text } }));

    say('/model z-ai/glm-5.3-flash');
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('cvt:settings') ?? '{}').assistantModel).toBe('z-ai/glm-5.3-flash'));
    say('/model default');
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('cvt:settings') ?? '{}').assistantModel).toBeUndefined());
    say('/clear');
    await chat.updateComplete;
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('chat/completions'))).toEqual([]);
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
