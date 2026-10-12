import { expect, it, vi } from 'vitest';

import { defineCivitaiChat } from './civitai-chat.js';

it('registers only the chat up front and the rest of it once the chat has a signed-in app', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  defineCivitaiChat();
  expect(customElements.get('civitai-chat')).toBeDefined();
  expect(customElements.get('civitai-chat-thread')).toBeUndefined();

  const chat = document.createElement('civitai-chat');
  chat.app = {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
  document.body.append(chat);
  // The first import of the whole runtime, cold and beside every other test file: past 1 s under load.
  await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-sidebar')).not.toBeNull(), { timeout: 10_000 });
  expect(customElements.get('civitai-chat-thread')).toBeDefined();
});

it("shows the chat's toasts as toasts, not as unknown tags", async () => {
  defineCivitaiChat();
  const region = document.createElement('civitai-toast-region');
  document.body.append(region);
  region.show({ message: 'Link copied to clipboard.', color: 'success' });
  const toast = region.querySelector('civitai-toast') ?? region.shadowRoot?.querySelector('civitai-toast');
  expect(toast?.textContent).toBe('Link copied to clipboard.');
  expect(toast?.matches(':defined')).toBe(true);
});
