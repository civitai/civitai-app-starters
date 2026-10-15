import type { ToolSet } from 'ai';

/**
 * What the page decides about one tool call before it runs. A refusal with `stop: true` also ends the
 * reply (see {@link ChatToolGate}); `message` is what the viewer then reads under it.
 */
export type ChatToolDecision = { allow: true } | { refuse: string; stop?: false } | { refuse: string; stop: true; message?: string } | void;

/**
 * Asked before every tool call the assistant makes (Civitai's, an added server's, the page's), with the
 * input as the assistant wrote it. `{ refuse }` stops the call: nothing runs, and the assistant gets
 * the reason as the tool's error; anything else lets it run. `{ refuse, stop: true }` also ends the
 * reply: the assistant is not asked again in it, so a model that ignores the refusal cannot keep
 * calling (and paying for steps), and the reply ends as done with `message` (or a default) and
 * Continue. A call made alongside it whose gate had not answered yet, or that comes after it, does
 * not run either; one already running finishes. A hook that throws (or rejects) refuses, so a broken
 * gate never lets a call by. `signal` aborts when the viewer stops the reply; a call whose reply was
 * stopped while the gate decided does not run, whatever the gate answers. `reply` is the same number
 * for every call in one reply and a new one for the next (Continue and Retry included), so a page can
 * keep a per-reply count by it.
 */
export type ChatToolGate = (
  name: string,
  input: unknown,
  context: { conversationId: string; reply: number; signal?: AbortSignal },
) => ChatToolDecision | Promise<ChatToolDecision>;

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
  /** Set when this call ended the reply (`stop: true`), or did not run because another call ended it. */
  stopped?: true;
}

export interface GateDeps {
  conversationId: string;
  gate?: ChatToolGate;
  onResult(result: ChatToolResult): void;
}

const STOPPED = 'The reply was stopped before this call ran.';

export const REFUSED_BY_PAGE_NOTE =
  'The page did not allow this call, and nothing ran. Do not call it again with the same input; do what the error asks, or tell the user in plain words.';

/** What the viewer reads under a reply the page ended, when the page gives no words of its own. */
export const ENDED_BY_PAGE_MESSAGE = 'The page ended this reply before the assistant could do more.';
const ENDED = 'The page ended this reply before this call ran.';
const ENDED_NOTE = 'Nothing ran: the page ended the reply here. If the user asks you to carry on, pick up from here, making this call again if it is still needed.';

/**
 * The outputs of calls that ended their reply, with the words the viewer reads. Kept beside the output,
 * not in it, so no tool can end a reply by what it returns.
 */
const ENDING = new WeakMap<object, string>();

/** The viewer-facing words when `output` came from a call that ended its reply; `undefined` otherwise. */
export function endedReply(output: unknown): string | undefined {
  return output !== null && typeof output === 'object' ? ENDING.get(output) : undefined;
}

/** The last reply number handed out; each `gateToolSet` (one per reply) takes the next. */
let replies = 0;

/**
 * Every tool with its `execute` wrapped: the gate first, then the tool, then one report of the result.
 * The tool itself (its type, schema, description) is kept as it is. Built once per reply, so a stop
 * ends only the reply it came in.
 */
export function gateToolSet(tools: ToolSet, deps: GateDeps): ToolSet {
  const gated: ToolSet = {};
  const reply = ++replies;
  // The words the reply ends on, once a call ended it.
  let ended: string | undefined;
  const ending = (output: { error: string; note: string }, message: string) => (ENDING.set(output, message), output);
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute;
    if (!execute) {
      gated[name] = tool;
      continue;
    }
    gated[name] = {
      ...tool,
      execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
        const signal = (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
        // Ended already: the gate is not asked, and nothing runs.
        const decision = ended === undefined ? await decide(deps.gate, name, input, deps.conversationId, reply, signal) : undefined;
        if (signal?.aborted) {
          // Stopped while the gate decided: nothing runs, a confirmation that comes late included.
          deps.onResult({ name, input, output: { error: STOPPED }, isError: true });
          throw signal.reason ?? new Error(STOPPED);
        }
        if (ended !== undefined) {
          // Another call ended the reply, before this one or while its gate decided: whatever it said, this does not run.
          const output = ending({ error: ENDED, note: ENDED_NOTE }, ended);
          deps.onResult({ name, input, output, isError: true, stopped: true });
          return output;
        }
        if (decision?.stop !== undefined) {
          ended = decision.stop;
          const output = ending({ error: decision.refused, note: ENDED_NOTE }, ended);
          deps.onResult({ name, input, output, isError: true, refused: decision.refused, stopped: true });
          return output;
        }
        if (decision !== undefined) {
          const output = { error: decision.refused, note: REFUSED_BY_PAGE_NOTE };
          deps.onResult({ name, input, output, isError: true, refused: decision.refused });
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

/** The refusal (with the words to end the reply on, when it ends it), or `undefined` to let the call run. */
async function decide(gate: ChatToolGate | undefined, name: string, input: unknown, conversationId: string, reply: number, signal?: AbortSignal): Promise<{ refused: string; stop?: string } | undefined> {
  if (!gate) return undefined;
  try {
    // Stop ends the wait even when the page never answers: a pending gate does not hold the reply open.
    const decision = await untilAborted(gate(name, input, signal ? { conversationId, reply, signal } : { conversationId, reply }), signal);
    if (!decision || typeof decision !== 'object' || !('refuse' in decision)) return undefined;
    const refused = String(decision.refuse || 'Refused.');
    if (decision.stop !== true) return { refused };
    const message = typeof decision.message === 'string' && decision.message.trim() !== '' ? decision.message : ENDED_BY_PAGE_MESSAGE;
    return { refused, stop: message };
  } catch (error) {
    // A gate that rejects because the reply was stopped did what `signal` asks; that is not a broken gate.
    if (!signal?.aborted) console.warn(`[chat-cvt] beforeToolCall threw for "${name}"; the call is refused`, error);
    return { refused: 'The page could not check this call.' };
  }
}

/** `value`, or `undefined` as soon as `signal` aborts, whichever comes first. */
function untilAborted<T>(value: T | Promise<T>, signal: AbortSignal | undefined): Promise<T | undefined> {
  if (!signal) return Promise.resolve(value);
  if (signal.aborted) {
    // Stopped already: the gate's answer is not waited for, and a rejection it gives is not left unhandled.
    Promise.resolve(value).catch(() => undefined);
    return Promise.resolve(undefined);
  }
  return new Promise<T | undefined>((resolve, reject) => {
    const stop = () => resolve(undefined);
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(value).then(
      (result) => (signal.removeEventListener('abort', stop), resolve(result)),
      (error: unknown) => (signal.removeEventListener('abort', stop), reject(error)),
    );
  });
}

function isErrorOutput(output: unknown): boolean {
  return output !== null && typeof output === 'object' && 'error' in output && (output as { error?: unknown }).error !== undefined;
}
