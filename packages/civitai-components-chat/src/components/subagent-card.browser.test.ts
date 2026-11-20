import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineElements } from './define.js';

/**
 * A subagent's card in real Chromium, on a chat reopened from storage: at phone width it never widens
 * the thread, whatever its task, summary and paths hold, and its header is a 44px tap target.
 */

// No spaces to wrap at: the widest a task, summary or path can be.
const LONG_TASK = `Find ${'where-the-auth-flow-lives-'.repeat(10)}and report back`;
const LONG_PATH = `/workspace/${'very-long-directory-name-'.repeat(12)}file.ts`;
const LONG_SUMMARY = `See ${'x'.repeat(500)} for the answer.`;
const WIDTHS = [320, 375] as const;

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function head() {
  const at = '2026-10-19T00:00:00Z';
  return {
    id: '7-1',
    status: 'succeeded',
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
    metadata: {
      v: 2,
      app: 'chat-cvt',
      conversationId: 'CONV1',
      title: 'Research',
      titleSource: 'llm',
      createdAt: at,
      updatedAt: at,
      turns: [
        {
          seq: 1,
          createdAt: at,
          user: { content: 'Where is auth?' },
          assistant: {
            status: 'complete',
            messages: [
              { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'd1', toolName: 'dispatch_agent', input: { task: LONG_TASK, mode: 'read' } }] },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'd1',
                    toolName: 'dispatch_agent',
                    output: { type: 'json', value: { kind: 'subagent', status: 'done', summary: LONG_SUMMARY, steps: 12, toolCalls: 31, activity: [{ tool: 'sandbox__read_file', arg: LONG_PATH }] } },
                  },
                ],
              },
              { role: 'assistant', content: 'Auth lives in the app.' },
            ],
          },
        },
      ],
    },
  };
}

async function mount(width: number): Promise<ShadowRoot> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
  const workflow = head();
  const app = {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: {
      queryWorkflows: async (query: { tags: string[] }) => (query.tags.includes('cvt:head') ? { items: [workflow], next: '' } : { items: [], next: '' }),
      submitWorkflow: vi.fn(),
    },
  };
  const frame = document.createElement('div');
  frame.style.cssText = `width:${width}px;height:640px;`;
  const chat = document.createElement('civitai-chat');
  chat.app = app as never;
  frame.append(chat);
  document.body.append(frame);
  const root = chat.shadowRoot!;
  await vi.waitFor(() => expect(root.querySelector('civitai-chat-turn .cvt-subagent')).not.toBeNull(), { timeout: 15_000 });
  return root;
}

describe('the subagent card at phone width', () => {
  it.each(WIDTHS)('stays inside the thread at %ipx, closed and opened, with a 44px header', async (width) => {
    await page.viewport(width, 740);
    const root = await mount(width);
    const card = root.querySelector<HTMLElement>('.cvt-subagent')!;
    const button = card.querySelector<HTMLButtonElement>('.cvt-subagent-head')!;
    const scroller = root.querySelector<HTMLElement>('.cvt-thread-scroll')!;
    const thread = () => root.querySelector<HTMLElement>('civitai-chat-thread')!.getBoundingClientRect();
    const report = () => JSON.stringify({ thread: thread().right, card: card.getBoundingClientRect().right, scroll: [scroller.scrollWidth, scroller.clientWidth] });

    // A long task wraps the header to two lines, which is taller anyway: the floor is what holds for a short one.
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(parseFloat(getComputedStyle(button).minHeight)).toBeGreaterThanOrEqual(44);
    expect(card.getBoundingClientRect().right, report()).toBeLessThanOrEqual(thread().right + 0.5);
    expect(scroller.scrollWidth, report()).toBeLessThanOrEqual(scroller.clientWidth);

    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await vi.waitFor(() => expect(card.querySelector<HTMLElement>('.cvt-call-inner')!.getBoundingClientRect().height).toBeGreaterThan(100));
    expect(card.textContent).toContain(LONG_PATH);
    expect(card.getBoundingClientRect().right, report()).toBeLessThanOrEqual(thread().right + 0.5);
    for (const text of card.querySelectorAll<HTMLElement>('.cvt-subagent-text, .cvt-subagent-activity li')) {
      expect(text.getBoundingClientRect().right, report()).toBeLessThanOrEqual(thread().right + 0.5);
    }
    expect(scroller.scrollWidth, report()).toBeLessThanOrEqual(scroller.clientWidth);
  });

  it('opens from the keyboard', async () => {
    await page.viewport(360, 740);
    const root = await mount(360);
    const button = root.querySelector<HTMLButtonElement>('.cvt-subagent-head')!;
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
