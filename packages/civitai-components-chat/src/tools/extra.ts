import { dynamicTool, jsonSchema, type ToolSet } from 'ai';

import type { McpCallOptions } from '../mcp/clients.js';
import { mcpResultToText } from '../mcp/result.js';
import type { ServerTools } from '../mcp/servers.js';

/**
 * Without progress a call may go quiet this long; each progress notification starts the wait again.
 * A little over the ten minutes long-running tools (a command in a sandbox) may take.
 */
export const EXTRA_TOOL_TIMEOUT_MS = 610_000;

const FAILED_NOTE = 'This tool failed. Tell the user in plain words; do not call it again this turn unless they ask.';

export interface ExtraToolDeps {
  /** Tools already offered; an added server's tool never replaces one. */
  taken: ToolSet;
  resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** The added servers' tools, each named `${serverId}__${tool}` and passed straight through. */
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
        execute: async (input, { abortSignal }) => {
          const args = await deps.resolveArgs((input ?? {}) as Record<string, unknown>);
          const options: McpCallOptions = {
            signal: abortSignal,
            timeoutMs: EXTRA_TOOL_TIMEOUT_MS,
            // Asking for progress is what makes the server send it, and each one restarts the timeout.
            onProgress: () => undefined,
          };
          const result = await connection.callTool(tool.name, args, options);
          const text = mcpResultToText(result);
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
