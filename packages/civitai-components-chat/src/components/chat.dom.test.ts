import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
});
