import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { defineElements } from './define.js';

/**
 * Real layout in Chromium: jsdom does none, so a jsdom version of this would pass whatever the CSS says.
 *
 * The bug: on a phone a long reply made the whole thread scroll sideways. The thread list, each turn
 * and the assistant's column were implicit `auto` grid tracks, which size to their widest content, so
 * one wide child (a code block, a 300-character token, a long URL, a failed step's error) widened the
 * column past the chat and every message's right edge went off-screen. A code block should scroll
 * inside itself instead, and everything else should wrap.
 */

const TOKEN = 'x'.repeat(300);
const URL_TEXT = `https://example.com/a/very/long/path/${'segment-'.repeat(30)}end?query=${'v'.repeat(80)}`;
const CODE_LINE = `const wide = ${JSON.stringify('w'.repeat(240))};`;
const TOOL_ERROR = `E_TOO_WIDE:${'e'.repeat(400)}`;
const VIEWPORTS = [320, 375, 768] as const;
// A failed step is a summary line in the default `activity` mode, and a row per call in `details` mode.
const CASES = VIEWPORTS.flatMap((width) => (['activity', 'details'] as const).map((toolCalls) => ({ width, toolCalls })));
const TOOL_ROW = { activity: '.cvt-step-failed', details: '.cvt-call' } as const;

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
      title: 'Wide things',
      createdAt: at,
      updatedAt: at,
      turns: [
        {
          seq: 1,
          createdAt: at,
          user: { content: `Here is a long one: ${TOKEN}` },
          assistant: {
            status: 'complete',
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'text', text: `A token: ${TOKEN}\n\nA link: ${URL_TEXT}\n\n\`\`\`js\n${CODE_LINE}\n\`\`\`` },
                  { type: 'tool-call', toolCallId: 'call-1', toolName: 'search_models', input: { query: TOKEN } },
                ],
              },
              {
                role: 'tool',
                content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'search_models', output: { type: 'error-text', value: TOOL_ERROR } }],
              },
              { role: 'assistant', content: 'That search failed; here is what I found anyway.' },
            ],
          },
        },
      ],
    },
  };
}

async function mount(width: number, toolCalls: 'activity' | 'details' = 'activity'): Promise<ShadowRoot> {
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
  frame.style.cssText = `width:${width}px;height:700px;`;
  const chat = document.createElement('civitai-chat');
  chat.app = app as never;
  chat.toolCalls = toolCalls;
  frame.append(chat);
  document.body.append(frame);
  const root = chat.shadowRoot!;
  await vi.waitFor(() => expect(root.querySelector('civitai-chat-turn .cvt-md pre')).not.toBeNull(), { timeout: 15_000 });
  await vi.waitFor(() => expect(root.querySelector(`civitai-chat-turn ${TOOL_ROW[toolCalls]}`)).not.toBeNull());
  return root;
}

describe('a thread of wide content at phone width', () => {
  it.each(CASES)('scrolls nothing sideways but the code block itself at $width px, tool calls as $toolCalls', async ({ width, toolCalls }) => {
    await page.viewport(width, 800);
    const root = await mount(width, toolCalls);
    const host = (root.host as HTMLElement).getBoundingClientRect();
    const main = root.querySelector<HTMLElement>('.cvt-main')!;
    const scroller = root.querySelector<HTMLElement>('.cvt-thread-scroll')!;
    const list = root.querySelector<HTMLElement>('.cvt-thread-list')!;
    const pre = root.querySelector<HTMLElement>('civitai-chat-turn .cvt-md pre')!;
    const link = [...root.querySelectorAll<HTMLElement>('civitai-chat-turn .cvt-md p')].find((p) => p.textContent?.includes('example.com'))!;
    const failed = root.querySelector<HTMLElement>(`civitai-chat-turn ${TOOL_ROW[toolCalls]}`)!;
    const pieces = { pre, link, failed, bubble: root.querySelector<HTMLElement>('.cvt-user .cvt-bubble')! };

    const report = JSON.stringify({
      host: [host.left, host.right],
      document: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      main: [main.scrollWidth, main.clientWidth],
      scroller: [scroller.scrollWidth, scroller.clientWidth],
      list: [list.scrollWidth, list.clientWidth, list.getBoundingClientRect().width],
      pre: [pre.scrollWidth, pre.clientWidth],
      pieces: Object.fromEntries(Object.entries(pieces).map(([name, el]) => [name, [Math.round(el.getBoundingClientRect().left), Math.round(el.getBoundingClientRect().right)]])),
    });

    // Nothing at page level, in the chat, or in the thread scrolls sideways.
    expect(document.documentElement.scrollWidth, `page scrolls sideways: ${report}`).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(main.scrollWidth, `chat scrolls sideways: ${report}`).toBeLessThanOrEqual(main.clientWidth);
    expect(scroller.scrollWidth, `thread scrolls sideways: ${report}`).toBeLessThanOrEqual(scroller.clientWidth);
    expect(list.getBoundingClientRect().width, `thread wider than the chat: ${report}`).toBeLessThanOrEqual(host.width + 0.5);
    for (const [name, el] of Object.entries(pieces)) {
      expect(el.getBoundingClientRect().right, `${name} runs past the chat's right edge: ${report}`).toBeLessThanOrEqual(host.right + 0.5);
    }
    // The code block keeps its own lines and scrolls inside itself.
    expect(pre.scrollWidth, `code block does not scroll internally: ${report}`).toBeGreaterThan(pre.clientWidth);
    expect(getComputedStyle(pre).overflowX).toBe('auto');
  });
});

/**
 * The bubble contract: each piece of the assistant's text is a `.cvt-md` directly in `.cvt-assistant`,
 * and that element is the bubble (left, on the surface colour); tool calls are siblings, outside it.
 * The viewer's message stays `.cvt-user > .cvt-bubble`, right, on primary-light.
 */
describe('message bubbles', () => {
  const TRANSPARENT = ['rgba(0, 0, 0, 0)', 'transparent'];

  it.each(['activity', 'details'] as const)('puts the assistant text in a left bubble of its own and leaves the user bubble as it was (tool calls as %s)', async (toolCalls) => {
    // Wide enough that the short reply fits on one line, so whether its bubble hugs its text shows.
    await page.viewport(768, 800);
    const root = await mount(768, toolCalls);
    const list = root.querySelector<HTMLElement>('.cvt-thread-list')!.getBoundingClientRect();
    const replies = [...root.querySelectorAll<HTMLElement>('civitai-chat-turn .cvt-assistant > .cvt-md')];
    // Both pieces of text, each in its own bubble.
    expect(replies.map((reply) => reply.textContent!.includes(TOKEN) || reply.textContent!.includes('That search failed'))).toEqual([true, true]);
    expect(replies[1]!.textContent!.trim()).toBe('That search failed; here is what I found anyway.');

    const user = root.querySelector<HTMLElement>('civitai-chat-turn .cvt-user > .cvt-bubble')!;
    expect(user.textContent).toContain('Here is a long one');
    const userStyle = getComputedStyle(user);
    for (const reply of replies) {
      const style = getComputedStyle(reply);
      expect(TRANSPARENT, 'the assistant bubble has a surface of its own').not.toContain(style.backgroundColor);
      expect(style.backgroundColor, 'the assistant bubble looks different from the user one').not.toBe(userStyle.backgroundColor);
      expect(parseFloat(style.paddingLeft)).toBeGreaterThan(0);
      expect(style.borderBottomLeftRadius).toBe('4px');
      // Left-aligned: it starts at the thread's left edge, inside the gutter.
      expect(Math.abs(reply.getBoundingClientRect().left - (list.left + 16))).toBeLessThanOrEqual(1);
    }
    // The short reply hugs its text rather than spanning the thread.
    expect(replies[1]!.getBoundingClientRect().width).toBeLessThan(list.width - 32);

    // Tool calls sit outside the text bubbles.
    const row = root.querySelector<HTMLElement>(`civitai-chat-turn ${TOOL_ROW[toolCalls]}`)!;
    expect(row.closest('.cvt-md')).toBeNull();
    expect(row.parentElement?.classList.contains('cvt-assistant')).toBe(true);

    // The viewer's bubble: unchanged shape, right-aligned, on primary-light.
    expect(TRANSPARENT).not.toContain(userStyle.backgroundColor);
    expect([userStyle.borderTopLeftRadius, userStyle.borderTopRightRadius, userStyle.borderBottomRightRadius, userStyle.borderBottomLeftRadius]).toEqual(['18px', '18px', '4px', '18px']);
    expect(Math.abs(user.getBoundingClientRect().right - (list.right - 16))).toBeLessThanOrEqual(1);
  });
});
