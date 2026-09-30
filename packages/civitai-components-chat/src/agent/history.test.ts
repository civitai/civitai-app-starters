import { describe, expect, it } from 'vitest';

import type { Turn } from '../types.js';
import { buildModelMessages } from './history.js';

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

  it('drops the oldest whole turns to stay within budget, never the latest', () => {
    const turns = [turn(1, 'x'.repeat(4_000)), turn(2, 'second'), turn(3, 'third')];
    expect(buildModelMessages(turns, () => undefined, 200).map((m) => m.content)).toEqual(['second', 'reply 2', 'third', 'reply 3']);
    expect(buildModelMessages(turns, () => undefined, 1).map((m) => m.content)).toEqual(['third', 'reply 3']);
  });

  it('marks a reply the user stopped', () => {
    const messages = buildModelMessages([turn(1, 'hi', { status: 'aborted' })], () => undefined);
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: '(The user stopped this reply.)' });
  });
});
