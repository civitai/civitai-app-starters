import type { ModelMessage, ToolModelMessage } from 'ai';

import { CONTEXT_BUDGET_TOKENS } from '../config.js';
import type { JobSummary } from '../orchestration/job.js';
import type { PostSummary } from '../posting/post.js';
import type { Turn } from '../types.js';

/** A job by its id, or a post by its tool call id. */
export type LiveLookup = (key: string) => { summary(): JobSummary | PostSummary } | undefined;

/**
 * The conversation as the model sees it. A generation's or post's tool result is replaced
 * by its current state, so the assistant learns how it ended.
 */
export function buildModelMessages(turns: Turn[], jobs: LiveLookup, { context, budget = CONTEXT_BUDGET_TOKENS }: { context?: string; budget?: number } = {}): ModelMessage[] {
  const perTurn = turns.map((turn, index) => turnMessages(turn, jobs, index === turns.length - 1 ? context : undefined));
  let total = perTurn.reduce((sum, messages) => sum + estimateTokens(messages), 0);
  let first = 0;
  while (total > budget && first < perTurn.length - 1) {
    total -= estimateTokens(perTurn[first]!);
    first++;
  }
  return perTurn.slice(first).flat();
}

// Only the latest message carries the context, so everything before it reads the same every reply.
function turnMessages(turn: Turn, jobs: LiveLookup, context?: string): ModelMessage[] {
  const files = turn.user.attachments.map((a) => `${a.id} (${a.kind})`).join(', ');
  const notes = [files ? `[Attached: ${files}]` : '', turn.user.refs?.length ? `[About: ${turn.user.refs.join(', ')}]` : ''].filter(Boolean);
  const content = notes.length ? `${turn.user.content}\n\n${notes.join('\n')}` : turn.user.content;
  const user: ModelMessage = { role: 'user', content: context ? `${context}\n\n${content}` : content };
  const assistant = turn.assistant.messages.map((message) => (message.role === 'tool' ? withLiveJobs(message, jobs) : message));
  if (turn.assistant.status === 'aborted') {
    assistant.push({ role: 'assistant', content: '(The user stopped this reply.)' });
  }
  return [user, ...assistant];
}

function withLiveJobs(message: ToolModelMessage, jobs: LiveLookup): ToolModelMessage {
  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== 'tool-result' || part.output.type !== 'json') return part;
      const value = part.output.value as { job?: unknown } | null;
      const job = jobs(typeof value?.job === 'string' ? value.job : part.toolCallId);
      return job ? { ...part, output: { type: 'json' as const, value: job.summary() as never } } : part;
    }),
  };
}

export function estimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 3.5);
}
