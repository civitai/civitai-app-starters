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
  await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-sidebar')).not.toBeNull());
  expect(customElements.get('civitai-chat-thread')).toBeDefined();
});
