import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpConnection, type McpCallOptions, type McpConnection } from '../mcp/clients.js';
import { fakeMcpServers, type FakeTool } from '../test-support/fake-mcp.js';
import { toolResult } from '../test-support/fakes.js';
import { EXTRA_TOOL_TIMEOUT_MS, extraToolSet, keepEnds } from './extra.js';

const URL = 'https://sandbox.example/mcp';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reports progress `beats` times, `every` ms apart, then answers. */
const slow = (beats: number, every: number): FakeTool => ({
  name: 'run_command',
  run: async (_args, progress) => {
    for (let beat = 1; beat <= beats; beat++) {
      await sleep(every);
      await progress(beat);
    }
    return { content: [{ type: 'text', text: 'done' }] };
  },
});

afterEach(() => vi.unstubAllGlobals());

describe('long-running MCP calls', () => {
  it('keep waiting while the server reports progress, for longer than the timeout', async () => {
    const fake = fakeMcpServers({ [URL]: [slow(6, 40)] });
    const connection = createMcpConnection({ url: URL, fetch: fake.fetch });
    const result = await connection.callTool('run_command', {}, { timeoutMs: 100, onProgress: () => undefined });
    expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
  });
});

describe('extraToolSet', () => {
  const server = { id: 'sandbox', url: URL, label: 'Sandbox', token: () => 'tok' };

  it('calls with progress on and a timeout each progress restarts', async () => {
    const seen: McpCallOptions[] = [];
    const connection = { url: URL, listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async (_name: string, _args: unknown, options: McpCallOptions = {}) => (seen.push(options), toolResult(undefined, 'ok'))) } as McpConnection;
    const tool = { name: 'run_command', description: 'Runs a shell command.', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } };
    const set = extraToolSet([{ server, connection, tools: [{ name: 'sandbox__run_command', tool }] }], { taken: {} });

    expect(set.sandbox__run_command!.description).toBe('[Sandbox] Runs a shell command.');
    await set.sandbox__run_command!.execute!({ command: 'npm test' }, { toolCallId: 'c', messages: [] });

    expect(connection.callTool).toHaveBeenCalledWith('run_command', { command: 'npm test' }, expect.anything());
    expect(seen[0]).toMatchObject({ timeoutMs: EXTRA_TOOL_TIMEOUT_MS });
    expect(seen[0]!.onProgress).toBeTypeOf('function');
    expect(EXTRA_TOOL_TIMEOUT_MS).toBe(610_000);
  });

  it("keeps the start and the end of a long reply, where a build's errors are", async () => {
    const output = `$ npm test\n${'ok\n'.repeat(4_000)}FAIL src/app.test.ts: expected 2, got 3`;
    const connection = { url: URL, listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => toolResult(undefined, output)) } as McpConnection;
    const tool = { name: 'run_command', inputSchema: { type: 'object' } };
    const set = extraToolSet([{ server, connection, tools: [{ name: 'sandbox__run_command', tool }] }], { taken: {} });

    const text = (await set.sandbox__run_command!.execute!({}, { toolCallId: 'c', messages: [] })) as string;

    expect(text.startsWith('$ npm test')).toBe(true);
    expect(text.endsWith('FAIL src/app.test.ts: expected 2, got 3')).toBe(true);
    expect(text).toContain(`…(${output.length - 8_000} characters omitted)…`);
    expect(text.length).toBeLessThan(8_100);
  });

  it("returns a reply that fits whole", () => {
    expect(keepEnds('short', 2, 3)).toBe('short');
    expect(keepEnds('abcdefgh', 2, 3)).toBe('ab\n…(3 characters omitted)…\nfgh');
  });

  it("turns a tool's error into one the assistant reports, and never takes a name already in use", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const connection = { url: URL, listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => toolResult(undefined, 'exit 1', true)) } as McpConnection;
    const tool = { name: 'run_command', inputSchema: { type: 'object' } };
    const taken = { sandbox__taken: {} as never };
    const set = extraToolSet([{ server, connection, tools: [{ name: 'sandbox__run_command', tool }, { name: 'sandbox__taken', tool }] }], { taken });

    expect(Object.keys(set)).toEqual(['sandbox__run_command']);
    expect(await set.sandbox__run_command!.execute!({}, { toolCallId: 'c', messages: [] })).toMatchObject({ error: 'exit 1' });
  });
});
