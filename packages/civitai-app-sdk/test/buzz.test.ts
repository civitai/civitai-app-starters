import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBuzzAccount, OAuthError } from '../src/oauth/token.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchBuzzAccount', () => {
  it('returns the unwrapped buzz accounts array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        result: {
          data: [
            { id: 42, balance: 1234, lifetimeBalance: 9999, accountType: 'yellow' },
          ],
        },
      }),
    );

    const accounts = await fetchBuzzAccount({ accessToken: 'tok' });

    expect(accounts).toEqual([
      { id: 42, balance: 1234, lifetimeBalance: 9999, accountType: 'yellow' },
    ]);
  });

  it('sends the bearer token to the tRPC procedure on the default base URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: { data: [] } }));

    await fetchBuzzAccount({ accessToken: 'tok' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://civitai.com/api/trpc/buzz.getUserAccount');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('honors a custom baseUrl', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: { data: [] } }));

    await fetchBuzzAccount({ accessToken: 'tok', baseUrl: 'https://staging.civitai.com' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://staging.civitai.com/api/trpc/buzz.getUserAccount');
  });

  it('returns [] when the tRPC response has no data', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: {} }));

    const accounts = await fetchBuzzAccount({ accessToken: 'tok' });

    expect(accounts).toEqual([]);
  });

  it('throws OAuthError on non-2xx response with status + body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('forbidden: missing BuzzRead scope', { status: 403 }),
    );

    await expect(fetchBuzzAccount({ accessToken: 'tok' })).rejects.toMatchObject({
      name: 'OAuthError',
      status: 403,
      body: 'forbidden: missing BuzzRead scope',
    });
  });

  it('OAuthError is the actual exported class', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));

    await expect(fetchBuzzAccount({ accessToken: 'tok' })).rejects.toBeInstanceOf(OAuthError);
  });
});
