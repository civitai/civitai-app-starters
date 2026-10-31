import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineElements } from './define.js';

/**
 * `tool-calls="details"` in real Chromium, on a chat reopened from storage: the rows' layout (they must
 * never widen the thread at phone width) and real clicks, which jsdom has neither of.
 */

// No spaces to wrap at: the widest an input or result can be.
const LONG_PATH = `/workspace/${'very-long-directory-name-'.repeat(12)}file.ts`;
const LONG_RESULT = { url: `https://example.com/${'x'.repeat(400)}`, lines: ['first', 'second'] };

const CALLS = [
  { id: 'c1', name: 'sandbox__list_files', input: { path: '/workspace' }, output: { files: ['a.ts', 'b.ts', 'c.ts'] } },
  { id: 'c2', name: 'sandbox__read_file', input: { path: LONG_PATH }, output: LONG_RESULT },
  { id: 'c3', name: 'sandbox__run_command', input: { command: 'pnpm test' }, output: { exitCode: 0 } },
];

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function head() {
  return {
    id: '7-1',
    status: 'succeeded',
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
    metadata: {
      v: 2,
      app: 'chat-cvt',
      conversationId: 'CONV1',
      title: 'Run the tests',
      titleSource: 'llm',
      createdAt: '2026-10-05T00:00:00Z',
      updatedAt: '2026-10-05T00:00:00Z',
      turns: [
        {
          seq: 1,
          createdAt: '2026-10-05T00:00:00Z',
          user: { content: 'Run the tests in my sandbox' },
          assistant: {
            status: 'complete',
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'text', text: 'Let me look.' },
                  ...CALLS.map((c) => ({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: c.input })),
                ],
              },
              {
                role: 'tool',
                content: CALLS.map((c) => ({ type: 'tool-result', toolCallId: c.id, toolName: c.name, output: { type: 'json', value: c.output } })),
              },
              { role: 'assistant', content: 'All tests pass.' },
            ],
          },
        },
      ],
    },
  };
}

async function mount(width: number, toolCalls?: string, mcpServers?: unknown[]): Promise<ShadowRoot> {
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
  if (toolCalls) chat.setAttribute('tool-calls', toolCalls);
  chat.app = app as never;
  if (mcpServers) chat.mcpServers = mcpServers as never;
  frame.append(chat);
  document.body.append(frame);
  const root = chat.shadowRoot!;
  await vi.waitFor(() => expect(root.querySelector('civitai-chat-thread')).not.toBeNull(), { timeout: 15_000 });
  await vi.waitFor(() => expect([...root.querySelectorAll('civitai-chat-turn .cvt-md')].map((m) => m.textContent).join(' '), root.querySelector('civitai-chat-thread')?.innerHTML.slice(0, 3000)).toContain('All tests pass.'));
  return root;
}

const visible = (el: Element) => el.getBoundingClientRect().height > 0;
// Only on request (`VITE_CVT_SCREENSHOTS=1`), for a reviewer: lands in `__screenshots__/` beside this file.
const shoot = async (name: string) => {
  if ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_CVT_SCREENSHOTS) await page.screenshot({ path: `__screenshots__/${name}.png` });
};

describe('tool-calls="details" at phone width', () => {
  it('shows three calls in a row as one group that opens to three rows, each opening to its input and result, inside the thread', async () => {
    await page.viewport(360, 740);
    const root = await mount(360, 'details');
    const groups = root.querySelectorAll<HTMLElement>('.cvt-tool-group');
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.dataset.count).toBe('3');
    expect(group.querySelector('.cvt-tool-group-label')!.textContent).toMatch(/\b3\b/);
    const headButton = group.querySelector<HTMLButtonElement>('.cvt-tool-group-head')!;
    expect(headButton.getAttribute('aria-expanded')).toBe('false');
    // Closed, the group's body is there but takes no height: the rows are clipped away.
    const list = group.querySelector<HTMLElement>(':scope > .cvt-call-body > .cvt-call-inner')!;
    expect(visible(list)).toBe(false);
    await shoot('tool-calls-360-collapsed');

    await userEvent.click(headButton);
    expect(headButton.getAttribute('aria-expanded')).toBe('true');
    const rows = group.querySelectorAll<HTMLElement>('.cvt-call');
    expect(rows).toHaveLength(3);
    await vi.waitFor(() => expect(visible(list)).toBe(true));

    const second = rows[1]!;
    await userEvent.click(second.querySelector<HTMLButtonElement>('.cvt-call-head')!);
    const pres = () => [...second.querySelectorAll<HTMLElement>('.cvt-call-pre')];
    await vi.waitFor(() => expect(pres().length).toBe(2));
    // Opened by animating its height: wait for it to settle at full height.
    await vi.waitFor(() => expect(second.querySelector<HTMLElement>('.cvt-call-inner')!.getBoundingClientRect().height).toBeGreaterThan(100));
    expect(pres()[0]!.textContent).toContain(LONG_PATH);
    expect(pres()[1]!.textContent).toContain(LONG_RESULT.url);
    for (const pre of pres()) expect(visible(pre)).toBe(true);

    const thread = root.querySelector<HTMLElement>('civitai-chat-thread')!.getBoundingClientRect();
    const report = () =>
      JSON.stringify({
        thread: [thread.left, thread.right],
        group: group.getBoundingClientRect().right,
        pres: pres().map((p) => [p.getBoundingClientRect().right, p.scrollWidth, p.clientWidth]),
      });
    expect(group.getBoundingClientRect().right, report()).toBeLessThanOrEqual(thread.right + 0.5);
    for (const pre of pres()) {
      expect(pre.getBoundingClientRect().right, report()).toBeLessThanOrEqual(thread.right + 0.5);
      expect(pre.scrollWidth, report()).toBeLessThanOrEqual(pre.clientWidth);
    }
    const scroller = root.querySelector<HTMLElement>('.cvt-thread-scroll')!;
    expect(scroller.scrollWidth, report()).toBeLessThanOrEqual(scroller.clientWidth);
    await shoot('tool-calls-360-expanded');
  });

  it("shows each call's server when the chat added that server", async () => {
    await page.viewport(360, 740);
    const root = await mount(360, 'details', [{ id: 'sandbox', url: 'https://example.com/mcp', token: async () => 'token' }]);
    await userEvent.click(root.querySelector<HTMLButtonElement>('.cvt-tool-group-head')!);
    const rows = [...root.querySelectorAll('.cvt-call')].map((row) => [row.querySelector('.cvt-call-name')?.textContent, row.querySelector('.cvt-call-server')?.textContent ?? null]);
    expect(rows).toEqual([
      ['list_files', 'sandbox'],
      ['read_file', 'sandbox'],
      ['run_command', 'sandbox'],
    ]);
  });

  it('opens a group from the keyboard', async () => {
    await page.viewport(360, 740);
    const root = await mount(360, 'details');
    const headButton = root.querySelector<HTMLButtonElement>('.cvt-tool-group-head')!;
    headButton.focus();
    await userEvent.keyboard('{Enter}');
    expect(headButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('without the option, the same chat shows no group and no call rows', async () => {
    await page.viewport(360, 740);
    const root = await mount(360);
    expect(root.querySelector('.cvt-tool-group, .cvt-call')).toBeNull();
    expect([...root.querySelectorAll('civitai-chat-turn .cvt-assistant > *')].map((c) => c.className)).toEqual(['cvt-md', 'cvt-md']);
  });
});
