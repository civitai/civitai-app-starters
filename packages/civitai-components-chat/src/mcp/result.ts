import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MAX_TEXT = 4_000;

/** Capped for the assistant, whose context it fills; pass `Infinity` to read a reply the app parses itself. */
export function mcpResultToText(result: CallToolResult, max = MAX_TEXT): string {
  const text = result.content
    .map((block) => (block.type === 'text' ? block.text : block.type === 'resource_link' ? `[${block.name}]` : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

export function structuredOf(result: CallToolResult): Record<string, unknown> | undefined {
  const value = result.structuredContent;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

const WORKFLOW_ID = /\b\d+-\d{17}\b/;

/** Until every tool returns structured content, the id is also recoverable from the prose. */
export function workflowIdOf(result: CallToolResult): string | undefined {
  const structured = structuredOf(result)?.workflowId;
  if (typeof structured === 'string' && structured !== '') return structured;
  return WORKFLOW_ID.exec(mcpResultToText(result))?.[0];
}
