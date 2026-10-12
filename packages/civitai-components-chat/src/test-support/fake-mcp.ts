import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface FakeTool {
  name: string;
  description?: string;
  /** Gets the arguments and a way to send progress for this call. */
  run?(args: Record<string, unknown>, progress: (value: number) => Promise<void>): Promise<CallToolResult> | CallToolResult;
}

/** What one fake server saw, so a test can count sessions, closes and tokens. */
export interface FakeMcpServer {
  readonly url: string;
  /** The `Authorization` header of every POST. */
  readonly authorizations: (string | null)[];
  /** `initialize` requests: one per new session. */
  initializes: number;
  /** DELETEs: sessions the client ended. */
  deletes: number;
  tools: FakeTool[];
}

/**
 * A real MCP server (the SDK's own, stateless, Streamable HTTP) behind a `fetch` that routes by URL,
 * so the chat's real MCP client machinery runs end to end without a network.
 */
export function fakeMcpServers(servers: Record<string, FakeTool[] | 'down'>): { fetch: typeof fetch; servers: Record<string, FakeMcpServer> } {
  const seen: Record<string, FakeMcpServer> = {};
  let sessions = 0;
  for (const [url, tools] of Object.entries(servers)) {
    seen[url] = { url, authorizations: [], initializes: 0, deletes: 0, tools: tools === 'down' ? [] : tools };
  }

  const handle = async (request: Request): Promise<Response> => {
    const url = request.url;
    const server = seen[url];
    if (!server) return new Response('no route', { status: 599 });
    if (servers[url] === 'down') throw new TypeError('fetch failed');
    if (request.method === 'GET') return new Response(null, { status: 405 });
    if (request.method === 'DELETE') {
      server.deletes++;
      return new Response(null, { status: 200 });
    }
    server.authorizations.push(request.headers.get('authorization'));
    const body = (await request.clone().json()) as { method?: string };
    const initializing = body.method === 'initialize';
    if (initializing) server.initializes++;

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
    const response = await transport.handleRequest(request);
    if (!initializing) return response;
    // Stateless servers name no session; this one does, so a client that ends its session is seen to.
    const headers = new Headers(response.headers);
    headers.set('mcp-session-id', `s-${++sessions}`);
    return new Response(response.body, { status: response.status, headers });
  };

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof globalThis.fetch;
  return { fetch, servers: seen };
}
