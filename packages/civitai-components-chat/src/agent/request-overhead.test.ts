import type { ModelMessage, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { CUSTOM_INSTRUCTIONS_MAX, REQUEST_OVERHEAD_TOKENS } from '../config.js';
import type { McpTool } from '../mcp/clients.js';
import orchestrationFixture from '../test-fixtures/orchestration-tools.json' with { type: 'json' };
import siteFixture from '../test-fixtures/site-tools.json' with { type: 'json' };
import { buildToolSet } from '../tools/build.js';
import { ALLOWED_SITE_TOOLS, DENIED_ORCHESTRATION_TOOLS } from '../tools/catalog.js';
import { estimateTokens } from './history.js';
import { buildSystemPrompt } from './system-prompt.js';

/**
 * What every reply sends besides the conversation: the system prompt (with the longest custom
 * instructions a viewer can save) and every built-in tool's definition, from the recorded catalogs,
 * estimated the way the history budget is.
 */
function measuredOverhead(): number {
  const catalog = {
    orchestration: (orchestrationFixture.tools as McpTool[]).filter((tool) => !DENIED_ORCHESTRATION_TOOLS.has(tool.name)),
    site: (siteFixture.tools as McpTool[]).filter((tool) => ALLOWED_SITE_TOOLS.has(tool.name)),
  };
  const tools: ToolSet = buildToolSet(catalog, {
    conversationId: 'C1',
    seq: 1,
    jobs: {} as never,
    orchestration: {} as never,
    site: {} as never,
    siteApi: {} as never,
    posts: { available: true } as never,
    panels: {} as never,
    findAttachment: () => undefined,
    resolveArgs: async (args) => args,
    onCaption: () => undefined,
  });
  const definitions = Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: { name, description: tool.description, parameters: (tool.inputSchema as { jsonSchema?: unknown }).jsonSchema },
  }));
  const system = buildSystemPrompt({
    now: new Date('2026-10-14T00:00:00Z'),
    customInstructions: 'x'.repeat(CUSTOM_INSTRUCTIONS_MAX),
    canPost: true,
    tools: Object.keys(tools),
  });
  // Every definition carries its JSON schema, or the measurement would leave out most of the weight.
  expect(definitions.every((definition) => typeof definition.function.parameters === 'object' && definition.function.parameters !== null)).toBe(true);
  return estimateTokens([{ role: 'system', content: system }] as ModelMessage[]) + estimateTokens([{ role: 'user', content: JSON.stringify(definitions) }] as ModelMessage[]);
}

describe('REQUEST_OVERHEAD_TOKENS', () => {
  it('covers the system prompt and built-in tool definitions every reply sends, with room to spare', () => {
    const measured = measuredOverhead();
    expect(measured).toBeGreaterThan(1_000);
    expect(REQUEST_OVERHEAD_TOKENS).toBeGreaterThanOrEqual(measured);
    console.info(`[request-overhead] measured ${measured} tokens; constant ${REQUEST_OVERHEAD_TOKENS}`);
  });
});
