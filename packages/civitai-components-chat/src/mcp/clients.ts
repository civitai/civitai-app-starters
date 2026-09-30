import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpProgress {
  progress: number;
  total?: number;
  message?: string;
}

export interface McpCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: McpProgress) => void;
}

export interface McpConnection {
  readonly url: string;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, opts?: McpCallOptions): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface McpConnectionOptions {
  url: string;
  /** Omitted for servers whose browse tools are anonymous. */
  token?: () => Promise<string>;
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createMcpConnection({ url, token, fetch: doFetch = fetch.bind(globalThis) }: McpConnectionOptions): McpConnection {
  const endpoint = new URL(url, typeof location === 'undefined' ? 'http://localhost/' : location.href);
  let pending: Promise<Client> | null = null;

  const authedFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${await token()}`);
    return doFetch(input, { ...init, headers });
  };

  const connect = (): Promise<Client> => {
    pending ??= (async () => {
      const client = new Client({ name: 'chat-cvt', version: '0.1.0' });
      await client.connect(new StreamableHTTPClientTransport(endpoint, { fetch: authedFetch }));
      return client;
    })().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };

  const reset = async () => {
    const stale = pending;
    pending = null;
    await stale?.then((client) => client.close()).catch(() => undefined);
  };

  // A server restart forgets the session; the next call starts a new one.
  const withClient = async <T>(fn: (client: Client) => Promise<T>): Promise<T> => {
    try {
      return await fn(await connect());
    } catch (error) {
      if (!(error instanceof StreamableHTTPError) || (error.code !== 404 && error.code !== 400)) throw error;
      await reset();
      return fn(await connect());
    }
  };

  return {
    url: endpoint.toString(),
    listTools: () =>
      withClient(async (client) => {
        const tools: McpTool[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          tools.push(...(page.tools as McpTool[]));
          cursor = page.nextCursor;
        } while (cursor);
        return tools;
      }),
    callTool: (name, args, opts = {}) =>
      withClient(
        async (client) =>
          (await client.callTool({ name, arguments: args }, undefined, {
            signal: opts.signal,
            timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            resetTimeoutOnProgress: opts.onProgress !== undefined,
            onprogress: opts.onProgress,
          })) as CallToolResult,
      ),
    close: reset,
  };
}
