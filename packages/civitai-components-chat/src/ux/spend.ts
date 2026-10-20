import { DISPATCH_AGENT, subagentResultOf } from '../agent/subagent-result.js';
import type { Conversation, Turn } from '../types.js';

/** The assistant's model is billed flat per call. */
export const ASSISTANT_CALL_BUZZ = 1;
/** What production charges for a turn's save until a save in this session says otherwise. */
export const TURN_SAVE_BUZZ = 1;

export interface Spend {
  total: number;
  generations: number;
  assistant: number;
  /** Of the assistant's calls, those its subagents made; set only when there were any. */
  subagentSteps?: number;
}

/**
 * The steps a turn's subagents took, from each finished `dispatch_agent` result as saved: each is a paid
 * model call that is not one of the turn's own messages.
 */
export function subagentSteps(turn: Turn): number {
  let steps = 0;
  for (const message of turn.assistant.messages) {
    if (message.role !== 'tool') continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== DISPATCH_AGENT || part.output.type !== 'json') continue;
      const result = subagentResultOf(part.output.value);
      if (result && Number.isFinite(result.steps) && result.steps > 0) steps += Math.round(result.steps);
    }
  }
  return steps;
}

/** An estimate of what a conversation has cost so far; model search and captions are not counted. */
export function conversationSpend(conversation: Conversation | null, jobs: { spent: number }[], saveCost = TURN_SAVE_BUZZ): Spend {
  if (!conversation) return { total: 0, generations: 0, assistant: 0 };
  const calls =
    conversation.turns.reduce((sum, turn) => sum + turn.assistant.messages.filter((message) => message.role === 'assistant').length, 0) +
    (conversation.titleSource === 'llm' ? 1 : 0);
  const children = conversation.turns.reduce((sum, turn) => sum + subagentSteps(turn), 0);
  const assistant = (calls + children) * ASSISTANT_CALL_BUZZ + conversation.turns.length * saveCost;
  const generations = jobs.reduce((sum, job) => sum + job.spent, 0);
  return { total: Math.round(assistant + generations), generations: Math.round(generations), assistant, ...(children > 0 ? { subagentSteps: children } : {}) };
}
