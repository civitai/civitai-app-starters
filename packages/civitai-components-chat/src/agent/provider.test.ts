import { describe, expect, it, vi } from 'vitest';

import { authedFetch } from './provider.js';

describe('authedFetch', () => {
  it('sends the current token and retries once with a fresh one when it is refused', async () => {
    const getToken = vi.fn(async ({ fresh }: { fresh?: boolean } = {}) => (fresh ? 'new' : 'old'));
    const doFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(null, { status: new Headers(init?.headers).get('Authorization') === 'Bearer old' ? 401 : 200 }),
    );
    const response = await authedFetch({ getToken }, doFetch as typeof fetch)('https://x/v1/chat/completions', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(doFetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'))).toEqual(['Bearer old', 'Bearer new']);
  });
});
