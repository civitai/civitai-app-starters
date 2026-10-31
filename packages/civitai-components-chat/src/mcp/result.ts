import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const MAX_TEXT = 4_000;

/**
 * Tools whose replies the assistant needs whole get a larger cap. A page read cut at 4,000
 * characters showed the assistant less than half of a docs page, and it fetched again hoping for
 * the rest.
 *
 * `fetch_page`'s server already cuts a page at 16,000 characters, and its reply adds a `# title`
 * line in front and a `[Page truncated]` marker after. The cap here sits above that, so the
 * server's own cut (and its marker) reaches the assistant unchanged; the 1,000 characters of
 * headroom cover the title, blank lines and marker. It stays a bound for a server that does not
 * cut. 17,000 characters is about 4,900 tokens by the package's 3.5-characters-a-token estimate.
 */
export const TOOL_TEXT_CAP: Readonly<Record<string, number>> = { fetch_page: 17_000 };

/** The cap for one tool's reply to the assistant. */
export function textCapFor(toolName: string): number {
  return Object.hasOwn(TOOL_TEXT_CAP, toolName) ? TOOL_TEXT_CAP[toolName]! : MAX_TEXT;
}

/**
 * Capped for the assistant, whose context it fills; pass `Infinity` to read a reply the app parses itself.
 * A cut reply says how much was left out, so the assistant does not ask again hoping for more.
 */
export function mcpResultToText(result: CallToolResult, max = MAX_TEXT): string {
  const text = result.content
    .map((block) => (block.type === 'text' ? block.text : block.type === 'resource_link' ? `[${block.name}]` : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  return text.length > max ? `${text.slice(0, max)}\n…(${text.length - max} more characters not shown)` : text;
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
