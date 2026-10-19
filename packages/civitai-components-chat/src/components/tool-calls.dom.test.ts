import type { ModelMessage } from 'ai';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { partsFromMessages, type TurnPart } from '../agent/parts.js';
import type { ChatToolView } from '../tools/host.js';
import type { CivitaiChatTurn } from './civitai-chat-turn.js';
import { defineElements } from './define.js';

beforeAll(() => defineElements());
afterEach(() => document.body.replaceChildren());

// Three calls in a row (the second failed), words, a call with the page's own view, and one still running.
const PARTS: TurnPart[] = [
  { kind: 'text', text: 'Looking around.' },
  { kind: 'tool', toolCallId: 'c1', toolName: 'sandbox__list_files', input: { path: '/src' }, state: 'done', output: { files: ['a.ts', 'b.ts'] } },
  { kind: 'tool', toolCallId: 'c2', toolName: 'sandbox__read_file', input: { path: '/src/a.ts' }, state: 'error', error: 'No such file' },
  { kind: 'tool', toolCallId: 'c3', toolName: 'search_models', input: { query: 'cats' }, state: 'done', output: { items: [] } },
  { kind: 'text', text: 'Pinning it.' },
  { kind: 'tool', toolCallId: 'c4', toolName: 'pin_it', input: { id: 1 }, state: 'done', output: { ok: true } },
  { kind: 'tool', toolCallId: 'c5', toolName: 'sandbox__run_command', input: { command: 'ls' }, state: 'calling' },
];

const VIEWS: Record<string, ChatToolView> = {
  pin_it: { render: () => html`<div class="host-pin">Pinned</div>` },
};

async function turnWith(parts: TurnPart[], props: Record<string, unknown> = {}): Promise<CivitaiChatTurn> {
  const el = document.createElement('civitai-chat-turn') as CivitaiChatTurn;
  el.turn = { seq: 1, createdAt: '', user: { content: 'hi', attachments: [] }, assistant: { messages: [], status: 'done' } };
  el.parts = parts;
  el.views = VIEWS;
  el.resolve = () => undefined;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** The markup without lit's marker comments, which carry nothing a viewer sees. */
function markup(el: Element): string {
  return el.innerHTML.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ').trim();
}

describe('tool calls with the option off', () => {
  // Captured from the turn before `tool-calls` existed: the thread a page that never sets it gets is unchanged.
  const TODAY =
    '<div class="cvt-user"> <div class="cvt-bubble">hi</div> </div> <div class="cvt-assistant"> <div class="cvt-md"><p>Looking around.</p> </div><details class="cvt-step-failed"><summary>A step didn\'t work</summary><code>No such file</code></details><div class="cvt-md"><p>Pinning it.</p> </div><div class="host-pin">Pinned</div><div class="cvt-activity">Working on it…</div> </div>';

  it('renders exactly what it did before the option existed, with no group or call rows', async () => {
    const el = await turnWith(PARTS);
    expect(markup(el)).toBe(TODAY);
    expect(el.querySelector('.cvt-tool-group, .cvt-call')).toBeNull();
  });
});

describe('tool calls with tool-calls="details"', () => {
  const click = async (el: CivitaiChatTurn, target: Element | null) => {
    (target as HTMLElement).click();
    await el.updateComplete;
  };

  it('folds the three calls in a row into one closed group, and leaves the page view and the lone call outside it', async () => {
    const el = await turnWith(PARTS, { toolCalls: 'details' });
    const groups = el.querySelectorAll('.cvt-tool-group');
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.getAttribute('data-count')).toBe('3');
    expect(group.querySelector('.cvt-tool-group-label')?.textContent).toContain('3');
    // The failed call stays in the group, and the group says one failed.
    expect(group.getAttribute('data-state')).toBe('error');
    expect([...group.querySelectorAll('.cvt-call')].map((c) => c.getAttribute('data-state'))).toEqual(['done', 'error', 'done']);
    const head = group.querySelector('.cvt-tool-group-head')!;
    expect(head.tagName).toBe('BUTTON');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(group.querySelector('.cvt-call-body')!.hasAttribute('inert')).toBe(true);

    // The page's own view renders as before, between the group and the call still running.
    const assistant = el.querySelector('.cvt-assistant')!;
    expect([...assistant.children].map((c) => c.className)).toEqual(['cvt-md', 'cvt-tool-group', 'cvt-md', 'host-pin', 'cvt-call']);
    const lone = assistant.querySelector(':scope > .cvt-call')!;
    expect(lone.getAttribute('data-state')).toBe('calling');
    expect(lone.querySelector('.cvt-call-name')?.textContent).toBe('run_command');
    expect(lone.querySelector('.cvt-call-server')?.textContent).toBe('sandbox');
    expect(lone.querySelector('.cvt-call-summary')?.textContent).toBe('command: ls');
    // Nothing the option-off view drew for these calls.
    expect(el.querySelector('.cvt-step-failed, .cvt-activity')).toBeNull();
  });

  it('opens the group, then a call, to its whole input and result; a failed call shows its error', async () => {
    const el = await turnWith(PARTS, { toolCalls: 'details' });
    const group = el.querySelector('.cvt-tool-group')!;
    await click(el, group.querySelector('.cvt-tool-group-head'));
    expect(group.querySelector('.cvt-tool-group-head')!.getAttribute('aria-expanded')).toBe('true');
    expect(group.querySelector(':scope > .cvt-call-body')!.hasAttribute('inert')).toBe(false);

    const [first, second] = group.querySelectorAll('.cvt-call');
    await click(el, first!.querySelector('.cvt-call-head'));
    expect(first!.querySelector('.cvt-call-head')!.getAttribute('aria-expanded')).toBe('true');
    const shown = [...first!.querySelectorAll('.cvt-call-pre')].map((pre) => pre.textContent);
    expect(shown).toEqual([JSON.stringify({ path: '/src' }, null, 2), JSON.stringify({ files: ['a.ts', 'b.ts'] }, null, 2)]);

    await click(el, second!.querySelector('.cvt-call-head'));
    expect([...second!.querySelectorAll('.cvt-call-label')].map((l) => l.textContent)).toEqual(['Input', 'Error']);
    expect(second!.querySelectorAll('.cvt-call-pre')[1]!.textContent).toBe('No such file');

    // Closing again keeps the other rows as they were.
    await click(el, group.querySelector('.cvt-tool-group-head'));
    expect(group.querySelector('.cvt-tool-group-head')!.getAttribute('aria-expanded')).toBe('false');
    expect(first!.querySelector('.cvt-call-head')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('caps a long result with Show more', async () => {
    const big = { kind: 'tool' as const, toolCallId: 'b1', toolName: 'dump', input: {}, state: 'done' as const, output: 'x'.repeat(5_000) };
    const el = await turnWith([big], { toolCalls: 'details' });
    await click(el, el.querySelector('.cvt-call-head'));
    const result = () => el.querySelectorAll('.cvt-call-pre')[1]!.textContent!;
    expect(result().length).toBeLessThan(1_600);
    await click(el, el.querySelector('.cvt-call-more'));
    expect(result()).toBe('x'.repeat(5_000));
    expect(el.querySelector('.cvt-call-more')).toBeNull();
  });

  it('shows a run still going as working', async () => {
    const running: TurnPart[] = ['r1', 'r2'].map((id) => ({ kind: 'tool', toolCallId: id, toolName: `t_${id}`, input: {}, state: 'calling' }));
    const el = await turnWith(running, { toolCalls: 'details' });
    const group = el.querySelector('.cvt-tool-group')!;
    expect(group.getAttribute('data-state')).toBe('calling');
    expect(group.querySelector('.cvt-tool-group-label')?.textContent).toMatch(/…$/);
  });

  it('draws a reply reloaded from storage the same as it was live', async () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking around.' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'sandbox__list_files', input: { path: '/src' } },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'sandbox__read_file', input: { path: '/src/a.ts' } },
          { type: 'tool-call', toolCallId: 'c3', toolName: 'search_models', input: { query: 'cats' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'sandbox__list_files', output: { type: 'json', value: { files: ['a.ts', 'b.ts'] } } },
          { type: 'tool-result', toolCallId: 'c2', toolName: 'sandbox__read_file', output: { type: 'error-text', value: 'No such file' } },
          { type: 'tool-result', toolCallId: 'c3', toolName: 'search_models', output: { type: 'json', value: { items: [] } } },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Pinning it.' }, { type: 'tool-call', toolCallId: 'c4', toolName: 'pin_it', input: { id: 1 } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c4', toolName: 'pin_it', output: { type: 'json', value: { ok: true } } }] },
    ];
    // The live reply, as streamed: a blank line between two calls, which storage does not keep.
    const live: TurnPart[] = [...PARTS.slice(0, 2), { kind: 'text', text: '\n\n' }, ...PARTS.slice(2, 6)];
    const rows = (el: Element) =>
      [...el.querySelectorAll('.cvt-assistant > *')].map((c) =>
        c.classList.contains('cvt-tool-group') ? `group:${[...c.querySelectorAll('.cvt-call-name')].map((n) => n.textContent).join(',')}` : c.className,
      );
    const reloaded = rows(await turnWith(partsFromMessages(messages), { toolCalls: 'details' }));
    document.body.replaceChildren();
    expect(reloaded).toEqual(rows(await turnWith(live, { toolCalls: 'details' })));
    expect(reloaded).toEqual(['cvt-md', 'group:list_files,read_file,search_models', 'cvt-md', 'host-pin']);
  });
});
