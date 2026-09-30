import { describe, expect, it } from 'vitest';

import type { Conversation, Turn } from '../types.js';
import { conversationSpend } from './spend.js';

const turn = (seq: number, steps: number): Turn => ({
  seq,
  createdAt: '2026-09-24T00:00:00Z',
  user: { content: 'hi', attachments: [] },
  assistant: { messages: Array.from({ length: steps }, () => ({ role: 'assistant' as const, content: 'ok' })), status: 'done' },
});

describe('conversationSpend', () => {
  it('adds what the generations cost to one Buzz per assistant call and per saved turn', () => {
    const conversation: Conversation = { id: 'c', title: 'Bikes', titleSource: 'llm', createdAt: '', updatedAt: '', turns: [turn(1, 2), turn(2, 1)] };
    expect(conversationSpend(conversation, [{ spent: 44 }, { spent: 0 }, { spent: 8.4 }])).toEqual({ total: 58, generations: 52, assistant: 6 });
    expect(conversationSpend(conversation, [], 0).assistant).toBe(4);
  });
});
