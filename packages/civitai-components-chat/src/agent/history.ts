import type { ModelMessage, ToolModelMessage } from 'ai';

import { contextBudget } from '../config.js';
import { DISPATCH_AGENT, subagentResultOf } from './subagent-result.js';
import { OPEN_PANEL, UPDATE_PANEL } from '../panels/tools.js';
import { POST_TOOL } from '../posting/post.js';
import { ASK_CHOICE } from '../tools/build.js';
import { isJobTool } from '../tools/catalog.js';
import type { JobSummary } from '../orchestration/job.js';
import type { PostSummary } from '../posting/post.js';
import type { Turn } from '../types.js';

/** A job by its id, or a post by its tool call id. */
export type LiveLookup = (key: string) => { summary(): JobSummary | PostSummary } | undefined;

/** A tool result longer than this (as JSON) is what goes first when the history is over budget. */
export const LONG_RESULT_CHARS = 400;
export const RESULT_LEFT_OUT = '(Left out to save room. If you still need it and the tool only reads, call it again.)';
/**
 * Results that report something the chat did (a generation, a post, a panel, a choice) are never
 * left out: calling one of these tools again would do it again, and some spend Buzz.
 */
function keepsResult(toolName: string): boolean {
  return isJobTool(toolName) || toolName === POST_TOOL || toolName === OPEN_PANEL || toolName === UPDATE_PANEL || toolName === ASK_CHOICE;
}
/** At most this share of the budget goes to messages kept from turns that are otherwise left out. */
export const PINNED_SHARE = 0.25;

/**
 * The conversation as the model sees it. A generation's or post's tool result is replaced
 * by its current state, so the assistant learns how it ended.
 *
 * Over `budget`, the earlier turns give way in this order, never the latest turn:
 * 1. their long tool results, oldest turn first (the call stays, its result becomes a note), except
 *    the results of tools that did something ({@link keepsResult});
 * 2. whole turns, oldest first, with one `(N earlier turns omitted)` note where they were. The
 *    first message (the task) and every answer to a shown `ask_choice` keep their user message,
 *    within {@link PINNED_SHARE} of the budget: the task first, cut to fit, then the latest answers.
 */
export function buildModelMessages(turns: Turn[], jobs: LiveLookup, { context, budget = contextBudget() }: { context?: string; budget?: number } = {}): ModelMessage[] {
  const last = turns.length - 1;
  const perTurn = turns.map((turn, index) => turnMessages(turn, jobs, index === last ? context : undefined));
  const sizes = perTurn.map(estimateTokens);
  let total = sizes.reduce((sum, size) => sum + size, 0);

  for (let index = 0; index < last && total > budget; index++) {
    const slim = perTurn[index]!.map(withoutLongResults);
    const size = estimateTokens(slim);
    total += size - sizes[index]!;
    perTurn[index] = slim;
    sizes[index] = size;
  }

  const pinned = pinnedMessages(turns, perTurn, budget);
  const kept: ModelMessage[] = [];
  let first = 0;
  while (total > budget && first < last) {
    total -= sizes[first]!;
    const pin = pinned.get(first);
    if (pin) {
      kept.push(pin);
      total += estimateTokens([pin]);
    }
    first++;
  }
  if (first === 0) return perTurn.flat();
  const marker: ModelMessage = { role: 'assistant', content: `(${first} earlier ${first === 1 ? 'turn' : 'turns'} omitted)` };
  return [...kept, marker, ...perTurn.slice(first).flat()];
}

/** The user messages kept when their turn is left out, by turn index, within {@link PINNED_SHARE} of `budget`. */
function pinnedMessages(turns: Turn[], perTurn: ModelMessage[][], budget: number): Map<number, ModelMessage> {
  const pins = new Map<number, ModelMessage>();
  let room = Math.floor(budget * PINNED_SHARE);
  const last = turns.length - 1;
  const task = last > 0 ? perTurn[0]![0] : undefined;
  if (task && typeof task.content === 'string') {
    // Cut to fit rather than lost: without its task a long chat no longer knows what it is for.
    const pin = estimateTokens([task]) <= room ? ({ role: 'user', content: task.content } as ModelMessage) : cutToFit(task.content, room);
    if (pin) {
      pins.set(0, pin);
      room -= estimateTokens([pin]);
    }
  }
  for (let index = last - 1; index > 0; index--) {
    if (!answersChoice(turns[index - 1]!)) continue;
    const message = perTurn[index]![0]!;
    const size = estimateTokens([message]);
    if (size > room) continue;
    pins.set(index, message);
    room -= size;
  }
  return pins;
}

/**
 * The task cut short enough that its estimate fits `room`, or `undefined` when nothing does. The
 * estimate counts the message as JSON, so quotes, backslashes and newlines cost more than one
 * character each; the cut shrinks until the escaped message fits.
 */
function cutToFit(content: string, room: number): ModelMessage | undefined {
  for (let chars = Math.floor(room * 3.5) - 40; chars > 0; chars = Math.floor(chars * 0.8) - 1) {
    const pin: ModelMessage = { role: 'user', content: `${content.slice(0, chars)}…(cut)` };
    if (estimateTokens([pin]) <= room) return pin;
  }
  return undefined;
}

/**
 * The turn's last tool call was an `ask_choice` whose result says the options were shown, so the
 * next user message is the pick. An `ask_choice` the card could not show reports no `shown: true`
 * and is not a choice the user answered.
 */
function answersChoice(turn: Turn): boolean {
  let lastCall: { toolName: string; toolCallId: string } | undefined;
  for (const message of turn.assistant.messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    for (const part of message.content) if (part.type === 'tool-call') lastCall = part;
  }
  if (lastCall?.toolName !== ASK_CHOICE) return false;
  for (const message of turn.assistant.messages) {
    if (message.role !== 'tool') continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolCallId !== lastCall.toolCallId || part.output.type !== 'json') continue;
      const value = part.output.value as { shown?: unknown } | null;
      if (value?.shown === true) return true;
    }
  }
  return false;
}

function withoutLongResults(message: ModelMessage): ModelMessage {
  if (message.role !== 'tool') return message;
  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== 'tool-result' || keepsResult(part.toolName) || JSON.stringify(part.output).length <= LONG_RESULT_CHARS) return part;
      // A subagent's conclusion stays (asking it again would pay for it again); only its activity log goes.
      const subagent = part.toolName === DISPATCH_AGENT && part.output.type === 'json' ? subagentResultOf(part.output.value) : undefined;
      if (subagent) {
        const { activity: _activity, ...kept } = subagent;
        return { ...part, output: { type: 'json' as const, value: kept } };
      }
      return { ...part, output: { type: 'text' as const, value: RESULT_LEFT_OUT } };
    }),
  };
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
