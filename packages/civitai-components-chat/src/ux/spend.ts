import type { Conversation } from '../types.js';

/** The assistant's model is billed flat per call. */
export const ASSISTANT_CALL_BUZZ = 1;
/** What production charges for a turn's save until a save in this session says otherwise. */
export const TURN_SAVE_BUZZ = 1;

export interface Spend {
  total: number;
  generations: number;
  assistant: number;
}

/** An estimate of what a conversation has cost so far; model search and captions are not counted. */
export function conversationSpend(conversation: Conversation | null, jobs: { spent: number }[], saveCost = TURN_SAVE_BUZZ): Spend {
  if (!conversation) return { total: 0, generations: 0, assistant: 0 };
  const calls =
    conversation.turns.reduce((sum, turn) => sum + turn.assistant.messages.filter((message) => message.role === 'assistant').length, 0) +
    (conversation.titleSource === 'llm' ? 1 : 0);
  const assistant = calls * ASSISTANT_CALL_BUZZ + conversation.turns.length * saveCost;
  const generations = jobs.reduce((sum, job) => sum + job.spent, 0);
  return { total: Math.round(assistant + generations), generations: Math.round(generations), assistant };
}
