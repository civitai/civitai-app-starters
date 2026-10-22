import { dynamicTool, jsonSchema, type ToolSet } from 'ai';

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { McpStreamLostError, type McpCallOptions } from '../mcp/clients.js';
import { toolImagesIn, toolImagesOf } from '../mcp/images.js';
import { mcpResultToText } from '../mcp/result.js';
import type { ChatMcpResultLimit, ServerTools } from '../mcp/servers.js';

/**
 * By default an added server's reply is kept to its start and end: a build or test run puts its errors
 * last. A server's own `resultLimit` replaces these, or (`false`) passes its replies whole.
 */
export const RESULT_HEAD_CHARS = 2_000;
export const RESULT_TAIL_CHARS = 6_000;

/**
 * Without progress a call may go quiet this long; each progress notification starts the wait again.
 * A little over the ten minutes long-running tools (a command in a sandbox) may take.
 */
export const EXTRA_TOOL_TIMEOUT_MS = 610_000;

const FAILED_NOTE = 'This tool failed. Tell the user in plain words; do not call it again this turn unless they ask.';
export const LOST_NOTE = 'Check its effect (for example by listing or reading the files it would change) before running it again.';

/** The reply never came: the call timed out without progress, or its stream closed first. */
function replyLost(error: unknown): boolean {
  return error instanceof McpStreamLostError || (error instanceof McpError && error.code === ErrorCode.RequestTimeout);
}

export interface ExtraToolDeps {
  /** Tools already offered; an added server's tool never replaces one. */
  taken: ToolSet;
}

/**
 * The added servers' tools, each named `${serverId}__${tool}` and passed straight through. Arguments go
 * as the assistant wrote them: a chat file id is not swapped for its signed URL, which would hand a
 * third-party server a link to the viewer's file.
 */
export function extraToolSet(servers: ServerTools[], deps: ExtraToolDeps): ToolSet {
  const tools: ToolSet = {};
  for (const { server, connection, tools: serverTools } of servers) {
    for (const { name, tool } of serverTools) {
      if (name in deps.taken || name in tools) {
        console.warn(`[chat-cvt] tool "${name}" of MCP server "${server.id}" is skipped: another tool has that name`);
        continue;
      }
      tools[name] = dynamicTool({
        description: `[${server.label?.trim() || server.id}] ${tool.description ?? ''}`.trim(),
        inputSchema: jsonSchema(objectSchema(tool.inputSchema)),
        execute: async (input, { abortSignal, toolCallId, experimental_context }) => {
          const args = (input ?? {}) as Record<string, unknown>;
          const options: McpCallOptions = {
            signal: abortSignal,
            timeoutMs: EXTRA_TOOL_TIMEOUT_MS,
            // Asking for progress is what makes the server send it, and each one restarts the timeout.
            onProgress: () => undefined,
          };
          let result: Awaited<ReturnType<typeof connection.callTool>>;
          try {
            result = await connection.callTool(tool.name, args, options);
          } catch (error) {
            // A stopped call's abort comes back as a timeout error too; it is the viewer's stop, not a lost reply.
            if (abortSignal?.aborted || !replyLost(error)) throw error;
            // The call may well have done its work; only its answer is missing. "Do not call it again"
            // would be wrong, and so would running it blindly again.
            return { error: `No reply from ${server.label?.trim() || server.id}; the ${tool.name} call may have finished.`, retryable: true, note: LOST_NOTE };
          }
          // The server's `resultLimit` cuts the reply's text only. Images are read from the result itself,
          // never from that text, and their notes go after the cut, so a note is never cut and no image
          // data counts against the limit.
          let text = limitResult(mcpResultToText(result, Infinity), server.resultLimit);
          // An image goes to the model beside the result (see `ToolImages`), never in it: the output is
          // what the conversation saves and shows, so it keeps only a note in the image's place.
          const sink = toolImagesIn(experimental_context);
          const { images, notes } = toolImagesOf(result, sink !== undefined);
          sink?.add(toolCallId, name, images);
          if (notes.length > 0) text = [text, ...notes, ...images.map((image) => image.data)].filter(Boolean).join('\n');
          return result.isError ? { error: text, note: FAILED_NOTE } : text;
        },
      });
    }
  }
  return tools;
}

/** As the server defines it; unlike Civitai's own tools, no parameter is the app's to set. */
function objectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return { ...rest, type: 'object' };
}

/**
 * A reply as the assistant gets it under a server's `resultLimit`: whole for `false`, else its ends
 * (`RESULT_HEAD_CHARS` and `RESULT_TAIL_CHARS` unless set). A `head` or `tail` that is not a whole
 * number of characters, zero or more, takes the default, with a console warning.
 */
export function limitResult(text: string, limit: ChatMcpResultLimit | undefined): string {
  if (limit === false) return text;
  return keepEnds(text, chars(limit?.head, RESULT_HEAD_CHARS, 'head'), chars(limit?.tail, RESULT_TAIL_CHARS, 'tail'));
}

function chars(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  console.warn(`[chat-cvt] resultLimit.${name} ${String(value)} is not a whole number of characters; ${fallback} is used`);
  return fallback;
}

/** The first `head` and last `tail` characters, with how many were left out between them. */
export function keepEnds(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text;
  // `slice(-0)` is the whole text, so a zero tail keeps nothing from the end.
  return `${text.slice(0, head)}\n…(${text.length - head - tail} characters omitted)…\n${tail > 0 ? text.slice(-tail) : ''}`;
}
