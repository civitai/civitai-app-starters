import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeMcpServers } from '../test-support/fake-mcp.js';
import { createMcpConnection, signedInOrAnonymous } from './clients.js';

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

describe('signedInOrAnonymous', () => {
  const search = { name: 'search_images', run: async () => ({ content: [{ type: 'text' as const, text: 'found' }] }) };

  it('calls as the viewer', async () => {
    const fake = fakeMcpServers({ [URL]: [search] });
    const site = signedInOrAnonymous(createMcpConnection({ url: URL, token: () => 'viewer-token', fetch: fake.fetch }), createMcpConnection({ url: URL, fetch: fake.fetch }));

    expect((await site.callTool('search_images', {})).content).toEqual([{ type: 'text', text: 'found' }]);
    expect(fake.servers[URL]!.authorizations.every((value) => value === 'Bearer viewer-token')).toBe(true);
  });

  it('still finds things when the server refuses the token, and stops sending it', async () => {
    const fake = fakeMcpServers({ [URL]: [search] });
    let refused = 0;
    const refusing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      new Headers(init?.headers).has('authorization') ? (refused++, new Response('{"error":"block token not accepted"}', { status: 401 })) : fake.fetch(input, init)) as typeof fetch;
    const site = signedInOrAnonymous(createMcpConnection({ url: URL, token: () => 'block-token', fetch: refusing }), createMcpConnection({ url: URL, fetch: refusing }));

    expect((await site.callTool('search_images', {})).content).toEqual([{ type: 'text', text: 'found' }]);
    expect((await site.callTool('search_images', {})).content).toEqual([{ type: 'text', text: 'found' }]);
    expect(refused).toBe(1);
  });
});
