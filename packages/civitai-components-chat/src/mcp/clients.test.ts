import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeMcpServers } from '../test-support/fake-mcp.js';
import { createMcpConnection } from './clients.js';

const URL = 'https://a.example/mcp';

describe('createMcpConnection without AbortSignal.any', () => {
  // Safari before 17.4, Chrome before 116 and Firefox before 124 have no AbortSignal.any.
  const any = AbortSignal.any;
  beforeEach(() => {
    delete (AbortSignal as { any?: unknown }).any;
  });
  afterEach(() => {
    AbortSignal.any = any;
    vi.restoreAllMocks();
  });

  it('still lists tools and calls them', async () => {
    const fake = fakeMcpServers({ [URL]: [{ name: 'run_command' }] });
    const connection = createMcpConnection({ url: URL, token: () => 'tok', fetch: fake.fetch });

    expect((await connection.listTools()).map((tool) => tool.name)).toEqual(['run_command']);
    expect((await connection.callTool('run_command', {})).content).toEqual([{ type: 'text', text: 'run_command ran' }]);
  });

  it('still ends a request in flight when the connection closes', async () => {
    const fake = fakeMcpServers({ [URL]: [{ name: 'run_command' }] });
    fake.servers[URL]!.hang = 1;
    const connection = createMcpConnection({ url: URL, token: () => 'tok', fetch: fake.fetch });

    const listing = connection.listTools();
    await vi.waitFor(() => expect(fake.servers[URL]!.initializes).toBe(1));
    void connection.close();

    await expect(listing).rejects.toThrow();
    expect(fake.servers[URL]!.aborted).toBe(1);
  });
});
