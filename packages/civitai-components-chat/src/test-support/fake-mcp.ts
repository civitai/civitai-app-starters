import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface FakeTool {
  name: string;
  description?: string;
  /** Gets the arguments and a way to send progress for this call. */
  run?(args: Record<string, unknown>, progress: (value: number) => Promise<void>): Promise<CallToolResult> | CallToolResult;
}

/** What one fake server saw, so a test can count sessions and tokens. */
export interface FakeMcpServer {
  readonly url: string;
  /** The `Authorization` header of every POST. */
  readonly authorizations: (string | null)[];
  /** `initialize` requests: one per new session. */
  initializes: number;
  tools: FakeTool[];
  /** Unreachable while set: every request fails as a network error would. */
  down: boolean;
  /** The next this many POSTs hang until the client aborts them. */
  hang: number;
  /** Hung requests the client aborted. */
  aborted: number;
}

/**
 * A real MCP server (the SDK's own, stateless, Streamable HTTP) behind a `fetch` that routes by URL,
 * so the chat's real MCP client machinery runs end to end without a network.
 */
export function fakeMcpServers(servers: Record<string, FakeTool[] | 'down'>): { fetch: typeof fetch; servers: Record<string, FakeMcpServer> } {
  const seen: Record<string, FakeMcpServer> = {};
  for (const [url, tools] of Object.entries(servers)) {
    seen[url] = { url, authorizations: [], initializes: 0, tools: tools === 'down' ? [] : tools, down: tools === 'down', hang: 0, aborted: 0 };
  }

  const handle = async (request: Request): Promise<Response> => {
    const url = request.url;
    const server = seen[url];
    if (!server) return new Response('no route', { status: 599 });
    if (server.down) throw new TypeError('fetch failed');
    if (request.method === 'GET') return new Response(null, { status: 405 });
    server.authorizations.push(request.headers.get('authorization'));
    const body = (await request.clone().json()) as { method?: string };
    if (body.method === 'initialize') server.initializes++;
    if (server.hang > 0) {
      server.hang--;
      return new Promise<Response>((_, reject) => {
        const abort = () => {
          server.aborted++;
          reject(new DOMException('aborted', 'AbortError'));
        };
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
      });
    }

    const mcp = new Server({ name: 'fake', version: '1.0.0' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: server.tools.map((tool) => ({ name: tool.name, description: tool.description ?? tool.name, inputSchema: { type: 'object' as const, properties: {} } })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      const tool = server.tools.find((candidate) => candidate.name === call.params.name);
      if (!tool) return { content: [{ type: 'text', text: `no tool ${call.params.name}` }], isError: true };
      const token = call.params._meta?.progressToken;
      const progress = async (value: number) => {
        if (token !== undefined) await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: value } });
      };
      return (await tool.run?.(call.params.arguments ?? {}, progress)) ?? { content: [{ type: 'text', text: `${tool.name} ran` }] };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    return transport.handleRequest(request);
  };

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof globalThis.fetch;
  return { fetch, servers: seen };
}
