import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { defineElements } from './define.js';

/**
 * Real layout in Chromium: jsdom does none, so a jsdom version of this would pass whatever the CSS says.
 *
 * The bug: the main column was an implicit `auto` grid track, which sizes to its widest content
 * rather than to the chat. A long title made the topbar's min-content wider than a phone, the
 * column grew past the host (427.562px inside a 359px host on an iPhone 15), and the New chat
 * button, the Send button and the right edge of every message landed off-screen.
 */

// 59 characters (titles are capped at 60), and far wider than the host at the title's font size.
const LONG_TITLE = 'A cozy Pomodoro timer app with ambient lofi soundscapes too';

// The widths measured live: an iPhone 15 (393px viewport) with a long title, and an iPhone SE
// (375px viewport), where even a short title left the inner scrollWidth wider than the host.
const CASES = [
  { device: 'iPhone 15', viewport: [393, 852], host: 359, title: LONG_TITLE, truncates: true },
  { device: 'iPhone SE', viewport: [375, 667], host: 341, title: 'Pomodoro Timer App', truncates: false },
] as const;

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function head(title: string) {
  return {
    id: '7-1',
    status: 'succeeded',
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
    metadata: {
      v: 2,
      app: 'chat-cvt',
      conversationId: 'CONV1',
      title,
      // An `llm` title is one billed call, so the spend badge shows, as it does for a real chat.
      titleSource: 'llm',
      createdAt: '2026-10-05T00:00:00Z',
      updatedAt: '2026-10-05T00:00:00Z',
      turns: [
        {
          seq: 1,
          createdAt: '2026-10-05T00:00:00Z',
          user: { content: 'Build me a pomodoro timer with ambient sounds that I can leave running all afternoon' },
          assistant: {
            status: 'complete',
            messages: [
              {
                role: 'assistant',
                content: 'Here is a plan for the timer: a 25 minute focus block, a 5 minute break, and a soundscape that fades in.',
              },
            ],
          },
        },
      ],
    },
  };
}

async function mountNarrow(title: string, width: number): Promise<ShadowRoot> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
  const workflow = head(title);
  const app = {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: {
      queryWorkflows: async (query: { tags: string[] }) =>
        query.tags.includes('cvt:head') ? { items: [workflow], next: '' } : { items: [], next: '' },
      submitWorkflow: vi.fn(),
    },
  };

  const frame = document.createElement('div');
  frame.style.cssText = `width:${width}px;height:600px;`;
  const chat = document.createElement('civitai-chat');
  chat.app = app as never;
  frame.append(chat);
  document.body.append(frame);
  const root = chat.shadowRoot!;
  await vi.waitFor(() => expect(root.querySelector('civitai-chat-thread')).not.toBeNull(), { timeout: 15_000 });
  await vi.waitFor(() => expect(root.querySelector('.cvt-spend')).not.toBeNull());
  await vi.waitFor(() => expect(root.querySelector('.cvt-history-title')?.textContent).toBe(title));
  return root;
}

function within(inner: DOMRect, outer: DOMRect): boolean {
  return inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;
}

describe('civitai-chat at phone width', () => {
  it.each(CASES)('$device: keeps the New chat button, the Send button and the main column inside a $host px host ("$title")', async ({ viewport, host: width, title: chatTitle, truncates }) => {
    await page.viewport(viewport[0], viewport[1]);
    const root = await mountNarrow(chatTitle, width);
    const host = (root.host as HTMLElement).getBoundingClientRect();
    expect(Math.round(host.width)).toBe(width);

    const newChat = root.querySelector<HTMLElement>('.cvt-topbar button[aria-label="New chat"]')!;
    const send = root.querySelector<HTMLElement>('civitai-chat-composer .cvt-send')!;
    const main = root.querySelector<HTMLElement>('.cvt-main')!;
    const turn = root.querySelector<HTMLElement>('civitai-chat-thread')!;
    expect(newChat).not.toBeNull();
    expect(send).not.toBeNull();

    const report = {
      host: [host.left, host.right],
      main: [main.getBoundingClientRect().width, main.scrollWidth, main.clientWidth],
      newChat: [newChat.getBoundingClientRect().left, newChat.getBoundingClientRect().right],
      send: [send.getBoundingClientRect().left, send.getBoundingClientRect().right],
      thread: turn.getBoundingClientRect().width,
    };
    expect(within(newChat.getBoundingClientRect(), host), `New chat button outside the host: ${JSON.stringify(report)}`).toBe(true);
    expect(within(send.getBoundingClientRect(), host), `Send button outside the host: ${JSON.stringify(report)}`).toBe(true);
    expect(main.scrollWidth, `main column overflows: ${JSON.stringify(report)}`).toBeLessThanOrEqual(main.clientWidth);
    expect(main.getBoundingClientRect().width, `main column wider than the host: ${JSON.stringify(report)}`).toBeLessThanOrEqual(host.width + 0.5);
    expect(turn.getBoundingClientRect().width, `thread wider than the host: ${JSON.stringify(report)}`).toBeLessThanOrEqual(host.width + 0.5);

    // A long title gives way, by truncating, rather than pushing the buttons out; a short one shows whole.
    const title = root.querySelector<HTMLElement>('.cvt-history-title')!;
    expect(title.scrollWidth > title.clientWidth).toBe(truncates);
  });
});
