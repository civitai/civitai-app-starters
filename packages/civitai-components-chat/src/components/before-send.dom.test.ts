import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import type { BeforeSendDetail, CivitaiChat } from './civitai-chat.js';
import type { CivitaiChatComposer } from './civitai-chat-composer.js';
import { defineElements } from './define.js';

/**
 * `before-send`: the page sees each message just before it goes as the viewer's, and may cancel it
 * (say, to wake something the reply needs first, then send it itself).
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every model call the chat makes, by the last user message it carries. */
function spyOnReplies(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!urlOf(input).includes('/v1/chat/completions')) return new Response('not here', { status: 404 });
      const body = JSON.parse(String(init?.body)) as { stream?: boolean; messages: { role: string; content: unknown }[] };
      if (body.stream) asked.push(JSON.stringify(body.messages.filter((message) => message.role === 'user').at(-1)?.content));
      return textReply('Hello ', 'there.');
    }),
  );
  return asked;
}

async function mount(set: (chat: CivitaiChat) => void = () => undefined) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const store = memoryStore();
  const chat = document.createElement('civitai-chat');
  chat.backend = { url: '/api/llm', model: 'host/default-model', store };
  const seen: string[] = [];
  chat.addEventListener('before-send', (event) => seen.push((event as CustomEvent<BeforeSendDetail>).detail.text));
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  const composer = chat.shadowRoot!.querySelector<CivitaiChatComposer>('civitai-chat-composer')!;
  return { chat, composer, seen, store };
}

const threadText = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-thread')?.textContent ?? '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Types into the message box and presses Enter, as the viewer does. */
async function typeAndEnter(composer: CivitaiChatComposer, text: string): Promise<void> {
  const area = composer.querySelector('textarea')!;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  await composer.updateComplete;
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('<civitai-chat> before-send', () => {
  it('fires once with the typed text, and the message goes as before when nobody cancels it', async () => {
    const asked = spyOnReplies();
    const { chat, composer, seen } = await mount();
    await typeAndEnter(composer, 'make me a timer');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    expect(seen).toEqual(['make me a timer']);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('make me a timer');
    expect(threadText(chat)).toContain('make me a timer');
    expect(composer.draft).toBe('');
  });

  it('fires for send(text), once', async () => {
    const asked = spyOnReplies();
    const { chat, seen } = await mount();
    await chat.send('and a clock');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    expect(seen).toEqual(['and a clock']);
    expect(asked).toHaveLength(1);
  });

  it('a cancelled message is not sent, not in the chat and not saved; the box is cleared; the page can send it later', async () => {
    const asked = spyOnReplies();
    let release = false;
    const { chat, composer, seen, store } = await mount((c) =>
      c.addEventListener('before-send', (event) => {
        if (!release) event.preventDefault();
      }),
    );
    await typeAndEnter(composer, 'hold this one');
    await settle();
    expect(seen).toEqual(['hold this one']);
    expect(asked).toHaveLength(0);
    expect(threadText(chat)).not.toContain('hold this one');
    expect(store.records.size).toBe(0);
    expect(composer.draft).toBe('');

    release = true;
    await chat.send('hold this one');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    expect(seen).toEqual(['hold this one', 'hold this one']);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('hold this one');
  });

  it('does not fire for a slash command the chat handles itself, nor while the chat holds messages', async () => {
    spyOnReplies();
    const { chat, composer, seen } = await mount();
    await typeAndEnter(composer, '/help');
    await settle();
    expect(seen).toEqual([]);

    chat.holdReason = 'Starting…';
    await chat.updateComplete;
    await chat.send('not yet');
    await settle();
    expect(seen).toEqual([]);
  });
});
