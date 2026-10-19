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

  it('adds each subagent’s steps, from its saved dispatch_agent result, and says how many', () => {
    // 2 calls of the reply itself, and two subagents of 13 and 4 steps; a refusal (no steps) adds nothing.
    const withChildren: Turn = {
      seq: 1,
      createdAt: '2026-10-19T00:00:00Z',
      user: { content: 'research', attachments: [] },
      assistant: {
        status: 'done',
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'd1', toolName: 'dispatch_agent', input: {} }, { type: 'tool-call', toolCallId: 'd2', toolName: 'dispatch_agent', input: {} }, { type: 'tool-call', toolCallId: 'd3', toolName: 'dispatch_agent', input: {} }] },
          {
            role: 'tool',
            content: [
              { type: 'tool-result', toolCallId: 'd1', toolName: 'dispatch_agent', output: { type: 'json', value: { status: 'done', summary: 's', steps: 13, toolCalls: 20, activity: [] } } },
              { type: 'tool-result', toolCallId: 'd2', toolName: 'dispatch_agent', output: { type: 'json', value: { status: 'ran_out', summary: '', steps: 4, toolCalls: 3, activity: [] } } },
              { type: 'tool-result', toolCallId: 'd3', toolName: 'dispatch_agent', output: { type: 'json', value: { error: 'write subagents are not available yet' } } },
            ],
          },
          { role: 'assistant', content: 'Here is what they found.' },
        ],
      },
    };
    const conversation: Conversation = { id: 'c', title: 't', titleSource: 'first-message', createdAt: '', updatedAt: '', turns: [withChildren] };
    // (2 + 13 + 4) calls and one saved turn.
    expect(conversationSpend(conversation, [], 1)).toEqual({ total: 20, generations: 0, assistant: 20, subagentSteps: 17 });
  });
});
