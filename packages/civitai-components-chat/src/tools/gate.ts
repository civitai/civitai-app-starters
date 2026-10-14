import type { ToolSet } from 'ai';

/** What the page decides about one tool call before it runs. */
export type ChatToolDecision = { allow: true } | { refuse: string } | void;

/**
 * Asked before every tool call the assistant makes (Civitai's, an added server's, the page's), with the
 * input as the assistant wrote it. `{ refuse }` stops the call: nothing runs, and the assistant gets
 * the reason as the tool's error; anything else lets it run. A hook that throws (or rejects) refuses,
 * so a broken gate never lets a call by.
 */
export type ChatToolGate = (name: string, input: unknown, context: { conversationId: string }) => ChatToolDecision | Promise<ChatToolDecision>;

/** One finished tool call, as the `tool-result` event reports it. */
export interface ChatToolResult {
  name: string;
  input: unknown;
  /** What the assistant got back: the tool's output, or `{ error, note }`. */
  output: unknown;
  /** Refused by the gate, thrown, or an output that carries an `error`. */
  isError: boolean;
  /** Set when the gate stopped the call. */
  refused?: string;
}

export interface GateDeps {
  conversationId: string;
  gate?: ChatToolGate;
  onResult(result: ChatToolResult): void;
}

export const REFUSED_BY_PAGE_NOTE =
  'The page did not allow this call, and nothing ran. Do not call it again with the same input; do what the error asks, or tell the user in plain words.';

/**
 * Every tool with its `execute` wrapped: the gate first, then the tool, then one report of the result.
 * The tool itself (its type, schema, description) is kept as it is.
 */
export function gateToolSet(tools: ToolSet, deps: GateDeps): ToolSet {
  const gated: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute;
    if (!execute) {
      gated[name] = tool;
      continue;
    }
    gated[name] = {
      ...tool,
      execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
        const refused = await decide(deps.gate, name, input, deps.conversationId);
        if (refused !== undefined) {
          const output = { error: refused, note: REFUSED_BY_PAGE_NOTE };
          deps.onResult({ name, input, output, isError: true, refused });
          return output;
        }
        let output: unknown;
        try {
          output = await (execute as (input: unknown, options: unknown) => unknown)(input, options);
        } catch (error) {
          deps.onResult({ name, input, output: { error: error instanceof Error ? error.message : String(error) }, isError: true });
          throw error;
        }
        deps.onResult({ name, input, output, isError: isErrorOutput(output) });
        return output;
      },
    } as typeof tool;
  }
  return gated;
}

/** The refusal, or `undefined` to let the call run. */
async function decide(gate: ChatToolGate | undefined, name: string, input: unknown, conversationId: string): Promise<string | undefined> {
  if (!gate) return undefined;
  try {
    const decision = await gate(name, input, { conversationId });
    if (decision && typeof decision === 'object' && 'refuse' in decision) return String(decision.refuse || 'Refused.');
    return undefined;
  } catch (error) {
    console.warn(`[chat-cvt] beforeToolCall threw for "${name}"; the call is refused`, error);
    return 'The page could not check this call.';
  }
}

function isErrorOutput(output: unknown): boolean {
  return output !== null && typeof output === 'object' && 'error' in output && (output as { error?: unknown }).error !== undefined;
}
