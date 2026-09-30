import type { ModelMessage } from 'ai';

export type TurnPart =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool';
      toolCallId: string;
      toolName: string;
      input: unknown;
      state: 'calling' | 'done' | 'error';
      output?: unknown;
      error?: string;
    };

/** A finished turn's messages as the pieces the thread renders, tool calls paired with results. */
export function partsFromMessages(messages: ModelMessage[]): TurnPart[] {
  const parts: TurnPart[] = [];
  const tools = new Map<string, Extract<TurnPart, { kind: 'tool' }>>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      const content = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
      for (const part of content) {
        if (part.type === 'text' && part.text.trim() !== '') parts.push({ kind: 'text', text: part.text });
        if (part.type === 'tool-call') {
          const tool = { kind: 'tool' as const, toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, state: 'calling' as const };
          tools.set(part.toolCallId, tool);
          parts.push(tool);
        }
      }
    } else if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue;
        const tool = tools.get(part.toolCallId);
        if (!tool) continue;
        const failed = part.output.type === 'error-text' || part.output.type === 'error-json';
        Object.assign(tool, {
          state: failed ? 'error' : 'done',
          output: 'value' in part.output ? part.output.value : undefined,
          error: failed ? String('value' in part.output ? JSON.stringify(part.output.value) : '') : undefined,
        });
      }
    }
  }
  return parts;
}
