import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { createMcpConnection, McpStreamLostError, type McpCallOptions, type McpConnection } from '../mcp/clients.js';
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

describe('a reply that never comes', () => {
  const server = { id: 'sandbox', url: URL, label: 'Sandbox', token: () => 'tok' };
  const tool = { name: 'run_command', inputSchema: { type: 'object' } };
  const LOST = {
    error: 'No reply from Sandbox; the run_command call may have finished.',
    retryable: true,
    note: 'Check its effect (for example by listing or reading the files it would change) before running it again.',
  };

  /** The fake server, except that a tool call's event stream sends `prefix` and then ends, or breaks, with no reply. */
  function dropping(how: 'end' | 'break', prefix = ''): { fetch: typeof fetch; calls: () => number } {
    const fake = fakeMcpServers({ [URL]: [{ name: 'run_command' }] });
    let calls = 0;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { method?: string }) : {};
      if (body.method !== 'tools/call') return fake.fetch(input, init);
      calls++;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (prefix) controller.enqueue(new TextEncoder().encode(prefix));
          if (how === 'end') controller.close();
          else controller.error(new TypeError('network error'));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    return { fetch: fetchFn, calls: () => calls };
  }

  const within = <T>(promise: Promise<T>, ms: number) =>
    Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms))]);

  it.each([
    ['ends', 'end' as const, ''],
    ['breaks', 'break' as const, ''],
    ['ends after a progress note', 'end' as const, 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":1,"progress":1}}\n\n'],
  ])('fails at once, as retryable, when the stream %s without it', async (_name, how, prefix) => {
    const fake = dropping(how, prefix);
    const connection = createMcpConnection({ url: URL, fetch: fake.fetch });
    const set = extraToolSet([{ server, connection, tools: [{ name: 'sandbox__run_command', tool }] }], { taken: {} });
    const started = Date.now();
    const result = await within(set.sandbox__run_command!.execute!({ command: 'npm install' }, { toolCallId: 'c', messages: [] }) as Promise<unknown>, 2_000);
    expect(result).toEqual(LOST);
    expect(fake.calls()).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fails the call with McpStreamLostError on the connection itself', async () => {
    const connection = createMcpConnection({ url: URL, fetch: dropping('end').fetch });
    await expect(within(connection.callTool('run_command', {}, { timeoutMs: EXTRA_TOOL_TIMEOUT_MS }), 2_000)).rejects.toBeInstanceOf(McpStreamLostError);
  });

  it('leaves a resumable stream (one with event ids) to the SDK, which reconnects for the reply', async () => {
    const connection = createMcpConnection({ url: URL, fetch: dropping('end', 'id: ev-1\ndata: \n\n').fetch });
    const error = await connection.callTool('run_command', {}, { timeoutMs: 300 }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(McpStreamLostError);
    expect(error).toMatchObject({ code: ErrorCode.RequestTimeout });
  });

  it.each([['id:'], ['id: ']])('does not count an empty event id (%j) as resumable: the call still fails at once', async (line) => {
    const connection = createMcpConnection({ url: URL, fetch: dropping('end', `${line}\ndata: \n\n`).fetch });
    await expect(within(connection.callTool('run_command', {}, { timeoutMs: EXTRA_TOOL_TIMEOUT_MS }), 2_000)).rejects.toBeInstanceOf(McpStreamLostError);
  });

  it('throws when the viewer stopped the call, rather than reporting a lost reply', async () => {
    // The SDK turns an abort into a RequestTimeout McpError, the same code a lost reply has.
    const connection = { url: URL, listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => Promise.reject(new McpError(ErrorCode.RequestTimeout, 'AbortError: stopped'))) } as McpConnection;
    const set = extraToolSet([{ server, connection, tools: [{ name: 'sandbox__run_command', tool }] }], { taken: {} });
    const stop = new AbortController();
    stop.abort();
    await expect(set.sandbox__run_command!.execute!({}, { toolCallId: 'c', messages: [], abortSignal: stop.signal })).rejects.toThrow('AbortError: stopped');
  });

  it('still answers normally when the reply does come', async () => {
    const fake = fakeMcpServers({ [URL]: [{ name: 'run_command' }] });
    const connection = createMcpConnection({ url: URL, fetch: fake.fetch });
    expect((await connection.callTool('run_command', {})).content).toEqual([{ type: 'text', text: 'run_command ran' }]);
  });

  it('turns a timeout without progress into the same retryable error, not a thrown failure', async () => {
    const connection = { url: URL, listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => Promise.reject(new McpError(ErrorCode.RequestTimeout, 'Request timed out'))) } as McpConnection;
    const set = extraToolSet([{ server, connection, tools: [{ name: 'sandbox__run_command', tool }] }], { taken: {} });
    expect(await set.sandbox__run_command!.execute!({}, { toolCallId: 'c', messages: [] })).toEqual(LOST);
  });

  it('still throws any other failure, which the assistant sees as a tool error', async () => {
    const connection = { url: URL, listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => Promise.reject(new McpError(ErrorCode.InternalError, 'boom'))) } as McpConnection;
    const set = extraToolSet([{ server, connection, tools: [{ name: 'sandbox__run_command', tool }] }], { taken: {} });
    await expect(set.sandbox__run_command!.execute!({}, { toolCallId: 'c', messages: [] })).rejects.toThrow('boom');
  });
});
