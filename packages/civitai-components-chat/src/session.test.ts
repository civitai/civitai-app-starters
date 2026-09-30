import { describe, expect, it, vi } from 'vitest';

import { ChatSession } from './session.js';

describe('ChatSession', () => {
  it('offers no tools from a server the embedding page switched off, without contacting it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const app = { getToken: async () => 'token', site: {}, orchestration: {} } as never;
    const session = new ChatSession(app, { mcp: () => ({ orchestration: false, site: false }) });
    expect(await session.catalog()).toEqual({ orchestration: [], site: [] });
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
