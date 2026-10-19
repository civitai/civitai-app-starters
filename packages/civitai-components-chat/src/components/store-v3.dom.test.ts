import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CivitaiChatTurn } from './civitai-chat-turn.js';
import type { CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * A chat whose latest reply was saved while it ran (a v3 head, `running`): it shows the steps that
 * finished, then the cut-off note the chat already has for a reply saved before it ended. It is not
 * asked for again by itself or offered Retry: whoever saved it may still be running it.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const running = {
  seq: 1,
  createdAt: '2026-10-19T00:00:00Z',
  user: { content: 'build me a pomodoro timer', attachments: [] },
  assistant: {
    status: 'running',
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'Setting up the timer screen first.' }, { type: 'tool-call', toolCallId: 'c1', toolName: 'note', input: { text: 'layout' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'note', output: { type: 'json', value: { ok: true } } }] },
    ],
  },
};

const headOf = (v: number) => ({
  id: `${v}-1`,
  status: 'succeeded',
  tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
  metadata: { v, app: 'chat-cvt', conversationId: 'CONV1', title: 'Pomodoro', titleSource: 'llm', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', turns: [running] },
});

/** Opens the chat on a stored head of version `v`; returns every reply request the model got. */
async function openOn(v: number) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('chat/completions')) asked.push(String(init?.body ?? ''));
      return new Response('{}');
    }),
  );
  localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
  const head = headOf(v);
  const queryWorkflows = vi.fn(async (_query: { tags?: string[] }) => ({ items: [head], next: '' }));
  const app = {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows, submitWorkflow: vi.fn() },
  };
  const chat = document.createElement('civitai-chat');
  chat.mcp = { orchestration: false, site: false };
  chat.app = app as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  return { chat, asked, queryWorkflows };
}

const root = (chat: CivitaiChat) => chat.shadowRoot!;
const turns = (chat: CivitaiChat) => [...root(chat).querySelectorAll<CivitaiChatTurn>('civitai-chat-turn')];

describe('a chat saved while its reply ran (v3 head)', () => {
  it('shows the steps that finished and the cut-off note, without Retry and without asking again', async () => {
    const { chat, asked } = await openOn(3);
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-turn .cvt-md')?.textContent).toContain('Setting up the timer screen first.'));
    const [turn] = turns(chat);
    expect(turn!.querySelector('.cvt-note')?.textContent).toBe('This reply was cut off. Ask again?');
    expect(turn!.querySelector('.cvt-retry')).toBeNull();
    expect(turn!.querySelector('civitai-alert[color="error"]')).toBeNull();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(await chat.retryReply()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).toHaveLength(0);
  });

  it('opens a head of a version it does not know as no chat at all', async () => {
    const { chat, queryWorkflows } = await openOn(4);
    // The chat did ask for this conversation's head (as it does for the v3 one above), and found none it reads.
    await vi.waitFor(() => expect(queryWorkflows.mock.calls.some(([query]) => query.tags?.includes('cvt:conv:CONV1'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(turns(chat)).toHaveLength(0);
    expect(root(chat).textContent).not.toContain('Setting up the timer screen first.');
  });
});
