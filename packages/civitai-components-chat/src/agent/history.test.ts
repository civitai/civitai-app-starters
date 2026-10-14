import { describe, expect, it } from 'vitest';

import type { ModelMessage } from 'ai';

import { chatConfig, configureChat, contextBudget } from '../config.js';
import type { Turn } from '../types.js';
import { buildModelMessages, RESULT_LEFT_OUT } from './history.js';

function toolTurn(seq: number, content: string, toolName: string, result: string): Turn {
  const id = `c${seq}`;
  return {
    seq,
    createdAt: '2026-09-23T00:00:00Z',
    user: { content, attachments: [] },
    assistant: {
      status: 'done',
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName, input: { path: `src/part${seq}.ts` } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName, output: { type: 'text', value: result } }] },
        { role: 'assistant', content: `read ${seq}` },
      ],
    },
  };
}

function choiceTurn(seq: number, content: string): Turn {
  const id = `ask${seq}`;
  return {
    seq,
    createdAt: '2026-09-23T00:00:00Z',
    user: { content, attachments: [] },
    assistant: {
      status: 'done',
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'ask_choice', input: { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'ask_choice', output: { type: 'json', value: { shown: true } } }] },
      ],
    },
  };
}

/** Each tool result in order: the left-out note, or how long the kept text is. */
function results(messages: ModelMessage[]): (string | number)[] {
  return messages.flatMap((m) =>
    m.role === 'tool' ? m.content.flatMap((p) => (p.type === 'tool-result' && p.output.type === 'text' ? [p.output.value === RESULT_LEFT_OUT ? RESULT_LEFT_OUT : p.output.value.length] : [])) : [],
  );
}

function turn(seq: number, content: string, extra: Partial<Turn['assistant']> = {}): Turn {
  return { seq, createdAt: '2026-09-23T00:00:00Z', user: { content, attachments: [] }, assistant: { messages: [{ role: 'assistant', content: `reply ${seq}` }], status: 'done', ...extra } };
}

describe('buildModelMessages', () => {
  it('tells the model which files came with a message', () => {
    const t = turn(1, 'make it a watercolor');
    t.user.attachments = [{ id: 'up1-1', kind: 'image', source: { type: 'upload', blobId: 'b' } }];
    expect(buildModelMessages([t], () => undefined)[0]).toEqual({ role: 'user', content: 'make it a watercolor\n\n[Attached: up1-1 (image)]' });
  });

  it('names the earlier results the user pointed at', () => {
    const t = turn(2, 'animate this');
    t.user.refs = ['gen1-1-1'];
    expect(buildModelMessages([t], () => undefined)[0]).toEqual({ role: 'user', content: 'animate this\n\n[About: gen1-1-1]' });
  });

  it("replaces a generation's tool result with the job's current state", () => {
    const t = turn(1, 'a bike', {
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'generate_image', input: { prompt: 'bike' } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'generate_image', output: { type: 'json', value: { job: 'gen1-1', status: 'running' } } }] },
      ],
    });
    const live = { summary: () => ({ job: 'gen1-1', status: 'succeeded' as const, results: [{ id: 'gen1-1-1', kind: 'image' }], note: 'done' }) };
    const messages = buildModelMessages([t], (id) => (id === 'gen1-1' ? live : undefined));
    expect(messages[2]).toMatchObject({ role: 'tool', content: [{ output: { type: 'json', value: { status: 'succeeded', results: [{ id: 'gen1-1-1' }] } } }] });
  });

  it("replaces a post's tool result with how the post ended", () => {
    const t = turn(1, 'post it', {
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'p1', toolName: 'post_to_civitai', input: { files: ['gen1-1-1'] } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'p1', toolName: 'post_to_civitai', output: { type: 'json', value: { status: 'awaiting_user' } } }] },
      ],
    });
    const live = { summary: () => ({ status: 'posted' as const, url: 'https://civitai.com/posts/1', note: 'live' }) };
    const messages = buildModelMessages([t], (key) => (key === 'p1' ? live : undefined));
    expect(messages[2]).toMatchObject({ role: 'tool', content: [{ output: { type: 'json', value: { status: 'posted', url: 'https://civitai.com/posts/1' } } }] });
  });

  it('drops the oldest whole turns to stay within budget, never the latest, and says how many', () => {
    const turns = [turn(1, 'first'), turn(2, 'x'.repeat(4_000)), turn(3, 'second'), turn(4, 'third')];
    expect(buildModelMessages(turns, () => undefined, { budget: 200 }).map((m) => m.content)).toEqual(['first', '(2 earlier turns omitted)', 'second', 'reply 3', 'third', 'reply 4']);
    // Too small to keep even the task: only the latest turn and the note are left.
    expect(buildModelMessages(turns, () => undefined, { budget: 1 }).map((m) => m.content)).toEqual(['(3 earlier turns omitted)', 'third', 'reply 4']);
  });

  it('keeps the task and drops the oldest long tool results before any words (the pomodoro chat)', () => {
    const task = 'Build a pomodoro timer: 25 minutes of work, 5 minute breaks, a long break every 4';
    const reads = [2, 3, 4, 5, 6, 7].map((seq) => toolTurn(seq, `read part ${seq}`, 'sandbox__read_file', 'r'.repeat(40_000)));
    const messages = buildModelMessages([turn(1, task), ...reads, turn(8, 'continue')], () => undefined);
    expect(messages[0]).toEqual({ role: 'user', content: task });
    expect(messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([task, 'read part 2', 'read part 3', 'read part 4', 'read part 5', 'read part 6', 'read part 7', 'continue']);
    // Every call is still there, so each result still has its call; the four oldest results gave way.
    expect(results(messages)).toEqual([RESULT_LEFT_OUT, RESULT_LEFT_OUT, RESULT_LEFT_OUT, RESULT_LEFT_OUT, 40_000, 40_000]);
    expect(messages.some((m) => typeof m.content === 'string' && /omitted/.test(m.content))).toBe(false);
  });

  it('keeps the task and every answer to a choice when whole turns must go', () => {
    const big = 'w'.repeat(20_000);
    const turns = [
      turn(1, 'make me a poster for a jazz night'),
      turn(2, big),
      choiceTurn(3, 'pick a style'),
      turn(4, 'Art deco'),
      turn(5, big),
      choiceTurn(6, 'pick a palette'),
      turn(7, 'Gold and black'),
      turn(8, big),
      turn(9, 'now make it'),
    ];
    const messages = buildModelMessages(turns, () => undefined, { budget: 2_000 });
    expect(messages.map((m) => (typeof m.content === 'string' ? m.content : m.role))).toEqual([
      'make me a poster for a jazz night',
      'Art deco',
      'Gold and black',
      '(8 earlier turns omitted)',
      'now make it',
      'reply 9',
    ]);
  });

  it('follows configureChat({ contextBudgetTokens }), and the default again when it is unset', () => {
    const turns = [turn(1, 'first'), turn(2, 'y'.repeat(100_000)), turn(3, 'last')];
    try {
      expect(buildModelMessages(turns, () => undefined).map((m) => m.content)).toEqual(['first', '(2 earlier turns omitted)', 'last', 'reply 3']);
      configureChat({ contextBudgetTokens: 40_000 });
      expect(buildModelMessages(turns, () => undefined).map((m) => (typeof m.content === 'string' ? m.content.length : 0))).toEqual([5, 7, 100_000, 7, 4, 7]);
      configureChat({ contextBudgetTokens: -5 });
      expect(contextBudget()).toBe(24_000);
    } finally {
      delete chatConfig.contextBudgetTokens;
    }
    expect(contextBudget()).toBe(24_000);
  });

  it('puts the context on the latest message only, so earlier messages read the same every reply', () => {
    const messages = buildModelMessages([turn(1, 'first'), turn(2, 'second', { messages: [], status: 'streaming' })], () => undefined, { context: '<context>files</context>' });
    expect(messages.map((m) => m.content)).toEqual(['first', 'reply 1', '<context>files</context>\n\nsecond']);
  });

  it('marks a reply the user stopped', () => {
    const messages = buildModelMessages([turn(1, 'hi', { status: 'aborted' })], () => undefined);
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: '(The user stopped this reply.)' });
  });
});
