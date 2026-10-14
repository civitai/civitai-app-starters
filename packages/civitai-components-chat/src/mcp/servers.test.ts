import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeMcpServers, type FakeTool } from '../test-support/fake-mcp.js';
import { McpServerPool, type ChatMcpServer } from './servers.js';

const A = 'https://a.example/mcp';
const B = 'https://b.example/mcp';
const tools = (...names: string[]): FakeTool[] => names.map((name) => ({ name }));
const names = (loaded: Awaited<ReturnType<McpServerPool['tools']>>) => loaded.flatMap(({ tools: list }) => list.map(({ name }) => name));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(routes: Record<string, FakeTool[] | 'down'>, listTimeoutMs?: number) {
  const fake = fakeMcpServers(routes);
  vi.stubGlobal('fetch', fake.fetch);
  const errors: string[] = [];
  const pool = new McpServerPool({ onError: (server) => errors.push(server.id), ...(listTimeoutMs ? { listTimeoutMs } : {}) });
  return { pool, servers: fake.servers, errors };
}

const server = (id: string, url: string): ChatMcpServer => ({ id, url, token: () => `tok-${id}` });

describe('McpServerPool', () => {
  it('gives up on a server that hangs, ends that request, and starts afresh at the next reply', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Long enough that a real listing never misses it under load; the hung one always does.
    const { pool, servers, errors } = setup({ [A]: tools('run_command') }, 400);
    servers[A]!.hang = 1;
    pool.sync([server('a', A)]);

    expect(await pool.tools()).toEqual([]);
    expect(errors).toEqual(['a']);
    await vi.waitFor(() => expect(servers[A]!.aborted).toBe(1));

    // Still waiting on the hung connect, this would time out again and offer nothing.
    expect(names(await pool.tools())).toEqual(['a__run_command']);
    expect(servers[A]!.initializes).toBe(2);
  });

  it('asks a server that was down again at the next reply', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { pool, servers, errors } = setup({ [A]: 'down' });
    servers[A]!.tools = tools('run_command');
    pool.sync([server('a', A)]);
    expect(await pool.tools()).toEqual([]);

    servers[A]!.down = false;
    expect(names(await pool.tools())).toEqual(['a__run_command']);
    expect(errors).toEqual(['a']);
  });

  it('uses the first of two entries with the same id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { pool, servers } = setup({ [A]: tools('one'), [B]: tools('two') });
    pool.sync([server('dup', A), server('dup', B)]);

    expect(names(await pool.tools())).toEqual(['dup__one']);
    expect(servers[B]!.initializes).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"dup" is listed twice'));
  });

  it('leaves out a tool whose full name a chat model would refuse', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { pool } = setup({ [A]: tools('read.file', 'x'.repeat(62), 'x'.repeat(61), 'ok') });
    pool.sync([server('a', A)]);
    // `a__` + 61 is the longest name allowed: 64 characters.
    expect(names(await pool.tools())).toEqual([`a__${'x'.repeat(61)}`, 'a__ok']);
  });

  it('offers nothing from a server dropped while a reply was gathering tools', async () => {
    const { pool } = setup({ [A]: tools('run_command') });
    pool.sync([server('a', A)]);
    expect(names(await pool.tools())).toEqual(['a__run_command']);

    const gathering = pool.tools();
    pool.sync([]);
    expect(await gathering).toEqual([]);
  });

  it('does not report a server dropped while it was still listing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { pool, servers, errors } = setup({ [A]: tools('run_command') }, 5_000);
    servers[A]!.hang = 1;
    pool.sync([server('a', A)]);
    const gathering = pool.tools();
    await vi.waitFor(() => expect(servers[A]!.initializes).toBe(1));

    pool.sync([]);
    expect(await gathering).toEqual([]);
    expect(servers[A]!.aborted).toBe(1);
    expect(errors).toEqual([]);
  });

  it('opens nothing once closed, so a late change cannot revive a discarded chat', async () => {
    const { pool, servers } = setup({ [A]: tools('run_command') });
    pool.close();
    pool.sync([server('a', A)]);
    expect(await pool.tools()).toEqual([]);
    expect(servers[A]!.initializes).toBe(0);
  });

  it('names the servers still listing their tools, and tells its listener only once each is done, listed or not', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeMcpServers({ [A]: tools('run_command'), [B]: tools('ping') });
    vi.stubGlobal('fetch', fake.fetch);
    fake.servers[B]!.hang = 1;
    const seen: string[][] = [];
    const pool = new McpServerPool({ onError: () => undefined, onListed: () => seen.push(pool.listing.map((s) => s.id)), listTimeoutMs: 400 });
    pool.sync([server('a', A), server('b', B)]);
    expect(pool.listing).toEqual([]);

    const loading = pool.tools();
    expect(pool.listing.map((s) => s.id)).toEqual(['a', 'b']);
    expect(names(await loading)).toEqual(['a__run_command']);
    expect(pool.listing).toEqual([]);
    // a listed while b still hung; then b gave up.
    expect(seen).toEqual([['b'], []]);
  });
});
