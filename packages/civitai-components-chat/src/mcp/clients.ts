import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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
  /** Ends every request in flight; after it, every call is refused rather than opening a new session. */
  close(): Promise<void>;
}

export interface McpConnectionOptions {
  url: string;
  /** Omitted for servers whose browse tools are anonymous. */
  token?: () => string | Promise<string>;
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** A call on a connection the chat closed, e.g. to a server the page removed. */
export class McpConnectionClosedError extends Error {
  constructor(url: string) {
    super(`The MCP server at ${url} was removed from the chat.`);
    this.name = 'McpConnectionClosedError';
  }
}

/**
 * The server closed the stream a tool call's reply comes on without sending the reply, so it never
 * will. The tool may still have run: only the answer was lost.
 */
export class McpStreamLostError extends Error {
  readonly tool: string;
  constructor(url: string, tool: string) {
    super(`The MCP server at ${url} closed the connection before it answered ${tool}.`);
    this.name = 'McpStreamLostError';
    this.tool = tool;
  }
}

/** Ours, inside JSON-RPC's server-error range; `data` carries a marker so a server's own -32098 is not read as one. */
const STREAM_LOST_CODE = -32098;
const STREAM_LOST_MARK = 'cvt-stream-lost';

function isStreamLost(error: unknown): boolean {
  return error instanceof McpError && error.code === STREAM_LOST_CODE && (error.data as { mark?: unknown } | undefined)?.mark === STREAM_LOST_MARK;
}

/** The JSON-RPC id of a `tools/call` request body, the only kind whose lost reply is turned into an error. */
function toolCallId(init: RequestInit | undefined): string | number | undefined {
  if (init?.method !== 'POST' || typeof init.body !== 'string') return undefined;
  try {
    const message = JSON.parse(init.body) as { method?: unknown; id?: unknown };
    if (message?.method !== 'tools/call') return undefined;
    return typeof message.id === 'string' || typeof message.id === 'number' ? message.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A tool call's reply may come on an event stream. Should that stream end, or break, before the reply
 * for `id` is on it, the SDK waits out the whole timeout (610 s for an added server's tools) for a reply
 * that cannot come any more. This passes the stream through unchanged and, at its end, adds an error
 * reply for `id` in its place, so the call fails at once. Not when the connection closed or its
 * transport was stopped (the request's signal is the transport's own, not the tool call's; either is
 * already an error), and not when the server sent a non-empty event id: such a stream can be resumed,
 * and the SDK reconnects for the reply itself. An empty `id:` resets the last event id, which leaves
 * nothing to resume from, so it does not count.
 */
function guardReplyStream(response: Response, id: string | number, signal: AbortSignal | undefined, isClosed: () => boolean): Response {
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !response.body || !/^text\/event-stream\b/i.test(type.trim())) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let answered = false;
  let resumable = false;

  const scan = (chunk: string) => {
    buffered += chunk;
    const events = buffered.split(/\r?\n\r?\n/);
    buffered = events.pop() ?? '';
    for (const event of events) {
      const data: string[] = [];
      for (const line of event.split(/\r?\n/)) {
        if (/^id:[ \t]*\S/.test(line)) resumable = true;
        else if (/^data:/.test(line)) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length === 0) continue;
      try {
        const message = JSON.parse(data.join('\n')) as { id?: unknown; result?: unknown; error?: unknown };
        if (message?.id === id && ('result' in message || 'error' in message)) answered = true;
      } catch {
        // Not ours to judge; the SDK reports it.
      }
    }
  };

  const end = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    scan(decoder.decode());
    if (buffered.trim() !== '') scan('\n\n');
    if (!answered && !resumable && !signal?.aborted && !isClosed()) {
      const error = { code: STREAM_LOST_CODE, message: 'The server closed the stream before it replied.', data: { mark: STREAM_LOST_MARK } };
      controller.enqueue(new TextEncoder().encode(`\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, error })}\n\n`));
    }
    controller.close();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        // A dropped connection: answer for it, unless the call was stopped, which the SDK already handles.
        if (signal?.aborted || isClosed()) controller.error(error);
        else end(controller);
        return;
      }
      if (chunk.done) return end(controller);
      scan(decoder.decode(chunk.value, { stream: true }));
      controller.enqueue(chunk.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function createMcpConnection({ url, token, fetch: doFetch = fetch.bind(globalThis) }: McpConnectionOptions): McpConnection {
  const endpoint = new URL(url, typeof location === 'undefined' ? 'http://localhost/' : location.href);
  let pending: Promise<Client> | null = null;
  let closed = false;
  // Kept from before the connect finishes, so close() can end a connect that hangs: closing the transport
  // aborts every request it has in flight (each carries its signal) and rejects what waits on them.
  let transport: StreamableHTTPClientTransport | null = null;

  // Every request passes here, so this one check refuses all of them once the connection is closed.
  const authedFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    if (closed) throw new McpConnectionClosedError(endpoint.toString());
    const headers = new Headers(init?.headers);
    // No token (an added server signed in by the page's own fetch) means no Authorization header at all.
    const value = token ? await token() : '';
    if (value) headers.set('Authorization', `Bearer ${value}`);
    const response = await doFetch(input, { ...init, headers });
    const id = toolCallId(init);
    return id === undefined ? response : guardReplyStream(response, id, init?.signal ?? undefined, () => closed);
  };

  const connect = (): Promise<Client> => {
    pending ??= (async () => {
      const client = new Client({ name: 'chat-cvt', version: '0.1.0' });
      transport = new StreamableHTTPClientTransport(endpoint, { fetch: authedFetch });
      await client.connect(transport);
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
      withClient(async (client) => {
        try {
          return (await client.callTool({ name, arguments: args }, undefined, {
            signal: opts.signal,
            timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            resetTimeoutOnProgress: opts.onProgress !== undefined,
            onprogress: opts.onProgress,
          })) as CallToolResult;
        } catch (error) {
          if (isStreamLost(error)) throw new McpStreamLostError(endpoint.toString(), name);
          throw error;
        }
      }),
    close: async () => {
      closed = true;
      pending = null;
      const current = transport;
      transport = null;
      await current?.close().catch(() => undefined);
    },
  };
}
