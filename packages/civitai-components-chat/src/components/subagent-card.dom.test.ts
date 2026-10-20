import type { ModelMessage } from 'ai';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { partsFromMessages, type TurnPart } from '../agent/parts.js';
import { SubagentTracker } from '../agent/subagents.js';
import type { CivitaiChatSpend } from './civitai-chat-spend.js';
import type { CivitaiChatTurn } from './civitai-chat-turn.js';
import { defineElements } from './define.js';

beforeAll(() => defineElements());
afterEach(() => document.body.replaceChildren());

/** A turn whose reply dispatched one subagent, as saved: rendered after a reload from these messages alone. */
const SAVED: ModelMessage[] = [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'd1', toolName: 'dispatch_agent', input: { task: 'Find where auth lives\nand how tokens refresh', mode: 'read' } }] },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'd1',
        toolName: 'dispatch_agent',
        output: {
          type: 'json',
          value: {
            kind: 'subagent',
            status: 'done',
            summary: 'Auth lives in src/auth; tokens refresh in refresh.ts.',
            steps: 4,
            toolCalls: 6,
            activity: [
              { tool: 'sandbox__list_dir', arg: 'src' },
              { tool: 'sandbox__read_file', arg: 'src/auth/refresh.ts' },
            ],
          },
        },
      },
    ],
  },
  { role: 'assistant', content: 'Auth is in src/auth.' },
];

async function turnWith(parts: TurnPart[], props: Record<string, unknown> = {}): Promise<CivitaiChatTurn> {
  const el = document.createElement('civitai-chat-turn') as CivitaiChatTurn;
  el.turn = { seq: 1, createdAt: '', user: { content: 'hi', attachments: [] }, assistant: { messages: [], status: 'done' } };
  el.parts = parts;
  el.resolve = () => undefined;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('the subagent card', () => {
  it.each(['activity', 'details'] as const)('renders from the saved result alone (tool calls as %s): task, counts, status; opened, the summary and what it looked at', async (toolCalls) => {
    const el = await turnWith(partsFromMessages(SAVED), { toolCalls });
    const card = el.querySelector('.cvt-subagent')!;
    expect(card.getAttribute('data-status')).toBe('done');
    expect(text(card.querySelector('.cvt-subagent-task'))).toBe('Find where auth lives');
    expect(text(card.querySelector('[data-subagent="counts"]'))).toBe('4 steps · 6 tool calls');
    expect(text(card.querySelector('[data-subagent="status"]'))).toBe('Done');
    const head = card.querySelector<HTMLButtonElement>('button.cvt-subagent-head')!;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(card.querySelector('[data-subagent="summary"]')).toBeNull();
    expect(document.getElementById(head.getAttribute('aria-controls')!)?.hasAttribute('inert')).toBe(true);

    head.click();
    await el.updateComplete;
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(head.getAttribute('aria-controls')!)?.hasAttribute('inert')).toBe(false);
    expect(text(card.querySelector('[data-subagent="summary"]'))).toBe('Auth lives in src/auth; tokens refresh in refresh.ts.');
    expect([...card.querySelectorAll('.cvt-subagent-activity li')].map(text)).toEqual(['sandbox__list_dir src', 'sandbox__read_file src/auth/refresh.ts']);
    // Not the generic "didn't work" note or a call row: the card is the call's own view.
    expect(el.querySelector('.cvt-step-failed, .cvt-call')).toBeNull();
  });

  it('shows live progress from the session while the call runs', async () => {
    const tracker = new SubagentTracker();
    tracker.set('d1', { task: 'Find where auth lives', steps: 3, toolCalls: 5, lastTool: 'sandbox__read_file' });
    const running: TurnPart = { kind: 'tool', toolCallId: 'd1', toolName: 'dispatch_agent', input: { task: 'Find where auth lives', mode: 'read' }, state: 'calling' };
    const el = await turnWith([running], { subagents: tracker, live: true });
    const card = el.querySelector('.cvt-subagent')!;
    expect(card.getAttribute('data-status')).toBe('calling');
    expect(text(card.querySelector('[data-subagent="status"]'))).toBe('Working…');
    expect(text(card.querySelector('[data-subagent="counts"]'))).toBe('3 steps · 5 tool calls');
  });

  it('shows a refused dispatch and a failed subagent with why, in the card', async () => {
    const refused: TurnPart = { kind: 'tool', toolCallId: 'd2', toolName: 'dispatch_agent', input: { task: 'Edit it', mode: 'write' }, state: 'done', output: { kind: 'subagent', error: 'write subagents are not available yet', note: 'Nothing ran.' } };
    const failed: TurnPart = { kind: 'tool', toolCallId: 'd3', toolName: 'dispatch_agent', input: { task: 'Read it', mode: 'read' }, state: 'done', output: { kind: 'subagent', status: 'error', summary: '', steps: 1, toolCalls: 0, activity: [], error: 'The model is down.' } };
    const el = await turnWith([refused, failed]);
    const [first, second] = [...el.querySelectorAll('.cvt-subagent')];
    expect(first!.getAttribute('data-status')).toBe('refused');
    expect(text(first!.querySelector('[data-subagent="status"]'))).toBe('Not started');
    expect(second!.getAttribute('data-status')).toBe('error');
    expect(text(second!.querySelector('[data-subagent="counts"]'))).toBe('1 step · 0 tool calls');
    first!.querySelector<HTMLButtonElement>('button')!.click();
    await el.updateComplete;
    expect(text(first!.querySelector('[data-subagent="error"]'))).toBe('write subagents are not available yet');
  });
});

describe('a page tool of its own named dispatch_agent', () => {
  it('is not drawn as a subagent card: it shows as any other call', async () => {
    const own: TurnPart = { kind: 'tool', toolCallId: 'p1', toolName: 'dispatch_agent', input: { task: 'Ship it' }, state: 'done', output: { status: 'done', steps: 3, summary: 'shipped', toolCalls: 0, activity: [] } };
    const failed: TurnPart = { kind: 'tool', toolCallId: 'p2', toolName: 'dispatch_agent', input: {}, state: 'done', output: { error: 'no truck' } };
    const running: TurnPart = { kind: 'tool', toolCallId: 'p3', toolName: 'dispatch_agent', input: {}, state: 'calling' };
    const el = await turnWith([own, failed, running], { subagents: new SubagentTracker(), live: true });
    expect(el.querySelector('.cvt-subagent')).toBeNull();
    expect(text(el.querySelector('.cvt-step-failed summary'))).toBe("A step didn't work");
    expect(text(el.querySelector('.cvt-activity'))).toBe('Working on it…');
  });
});

describe('the Buzz badge', () => {
  it('says how many subagent steps its total includes, and nothing about them when there were none', async () => {
    const badge = document.createElement('civitai-chat-spend') as CivitaiChatSpend;
    badge.spend = { total: 21, generations: 0, assistant: 21, subagentSteps: 17 };
    document.body.append(badge);
    await badge.updateComplete;
    expect(text(badge.querySelector('[data-spend="subagents"]'))).toBe('Including 17 subagent steps.');
    badge.spend = { total: 4, generations: 0, assistant: 4 };
    await badge.updateComplete;
    expect(badge.querySelector('[data-spend="subagents"]')).toBeNull();
  });
});
