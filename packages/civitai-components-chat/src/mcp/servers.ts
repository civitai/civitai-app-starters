import { createMcpConnection, type McpConnection, type McpTool } from './clients.js';

/** One more MCP server for the assistant, e.g. one made for this viewer whose address is known only at runtime. */
export interface ChatMcpServer {
  /** Stable, `[a-z0-9-]+`. Every tool of this server is offered as `${id}__${tool}`. */
  id: string;
  /** Its Streamable HTTP endpoint. */
  url: string;
  /**
   * Its bearer token, asked for on every request. Required: the chat never sends a server the viewer's
   * own Civitai token, and an entry without one is skipped.
   */
  token: () => string | Promise<string>;
  /** What the chat calls it while one of its tools runs, e.g. "Sandbox"; the id when omitted. */
  label?: string;
}

/** Which MCP servers the assistant may use. */
export interface ChatMcpOptions {
  /**
   * Civitai's generation tools; on unless `false`. `{ exclude }` keeps them on but leaves out the named
   * tools, e.g. `{ exclude: ['run_step', 'run_workflow'] }` for a page where the assistant should look
   * services up but never run (and pay for) one; the panels, which run through `run_step`, go with it.
   * Other tools that charge per call, such as `transcribe_audio`, stay unless they are named too.
   */
  orchestration?: boolean | { exclude?: ReadonlyArray<string> };
  /** Civitai model search; on unless `false`. */
  site?: boolean;
  /** More servers, whose tools are added to the assistant's. */
  mcpServers?: ReadonlyArray<ChatMcpServer>;
}

export const MCP_SERVER_ID = /^[a-z0-9-]+$/;
export const TOOL_SEPARATOR = '__';
/** What the chat model's API accepts as a tool name. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** A server that has not listed its tools by then is left out of this reply, so it cannot hold the chat up. */
export const LIST_TIMEOUT_MS = 15_000;

/** Every tool of an added server carries the server's id, so no name depends on what else is loaded. */
export function namespacedToolName(serverId: string, toolName: string): string {
  return `${serverId}${TOOL_SEPARATOR}${toolName}`;
}

export interface ServerTools {
  server: ChatMcpServer;
  connection: McpConnection;
  /** Each with the name the assistant sees. */
  tools: { name: string; tool: McpTool }[];
}

interface Entry {
  server: ChatMcpServer;
  connection: McpConnection | null;
  tools: Promise<McpTool[]> | null;
  /** Its tools as last listed, by the name the assistant sees. */
  named: { name: string; tool: McpTool }[];
  /** Reported once until it answers again, so a server that stays down is not announced every reply. */
  failing: boolean;
  /** Its tools are being listed right now; bounded by the listing timeout. */
  listing: boolean;
}

export interface McpServerPoolDeps {
  /** A server could not be reached or would not list its tools; its tools are left out. */
  onError(server: ChatMcpServer, error: unknown): void;
  /** A server listed its tools, or gave up listing them, so what the chat shows for them may change. */
  onListed?(): void;
  /** How long a server may take to list its tools; `LIST_TIMEOUT_MS` unless set. */
  listTimeoutMs?: number;
}

/**
 * The added servers' connections, kept while their `id` and `url` stay the same. A `token` or `label`
 * change applies without reconnecting; a new `url` or a removed entry closes its connection.
 */
export class McpServerPool {
  #entries = new Map<string, Entry>();
  #deps: McpServerPoolDeps;
  /** Closed with its session: nothing opens again, so a late sync cannot revive a discarded chat's servers. */
  #closed = false;

  constructor(deps: McpServerPoolDeps) {
    this.#deps = deps;
  }

  get servers(): ChatMcpServer[] {
    return [...this.#entries.values()].map((entry) => entry.server);
  }

  /** The servers whose tools are being listed right now, so a reply sent now would go without them. */
  get listing(): ChatMcpServer[] {
    return [...this.#entries.values()].filter((entry) => entry.listing).map((entry) => entry.server);
  }

  sync(servers: ReadonlyArray<ChatMcpServer> | undefined = []): void {
    if (this.#closed) return;
    const next = new Map<string, ChatMcpServer>();
    for (const server of servers) {
      if (typeof server?.id !== 'string' || !MCP_SERVER_ID.test(server.id)) {
        console.warn(`[chat-cvt] MCP server "${String(server?.id)}" is skipped: ids are lowercase letters, digits and - only`);
      } else if (typeof server.token !== 'function') {
        console.warn(`[chat-cvt] MCP server "${server.id}" is skipped: it has no token, and the chat does not send it the viewer's`);
      } else if (next.has(server.id)) {
        console.warn(`[chat-cvt] MCP server "${server.id}" is listed twice; the first one is used`);
      } else next.set(server.id, server);
    }
    for (const [id, entry] of this.#entries) {
      if (next.get(id)?.url === entry.server.url) continue;
      this.#entries.delete(id);
      void entry.connection?.close();
    }
    for (const [id, server] of next) {
      const entry = this.#entries.get(id);
      if (entry) entry.server = server;
      else this.#entries.set(id, this.#open(server));
    }
  }

  #open(server: ChatMcpServer): Entry {
    const entry: Entry = { server, connection: null, tools: null, named: [], failing: false, listing: false };
    try {
      entry.connection = this.#connect(entry);
    } catch (error) {
      // An unusable URL: reported when its tools are first asked for, like any other failure.
      entry.tools = Promise.reject(error);
      entry.tools.catch(() => undefined);
    }
    return entry;
  }

  #connect(entry: Entry): McpConnection {
    return createMcpConnection({ url: entry.server.url, token: () => entry.server.token() });
  }

  /** Every reachable server's tools; a failing one adds none and is reported through `onError`. */
  async tools(): Promise<ServerTools[]> {
    const loaded = await Promise.all([...this.#entries.values()].map((entry) => this.#load(entry)));
    return loaded.flatMap((result) => result ?? []);
  }

  async #load(entry: Entry): Promise<ServerTools | null> {
    const { connection } = entry;
    try {
      // Named once per listing, so a skipped tool is warned about once, not at every reply.
      if (!entry.tools) {
        entry.listing = true;
        entry.tools = withTimeout(connection!.listTools(), this.#deps.listTimeoutMs ?? LIST_TIMEOUT_MS, 'the server did not list its tools in time')
          .then((tools) => {
            entry.named = this.#named(entry.server, tools);
            return tools;
          })
          .finally(() => {
            entry.listing = false;
          });
        // Told after `listing` is clear, so a listener reading it sees the server as done, either way.
        const told = () => this.#deps.onListed?.();
        entry.tools.then(told, told);
      }
      await entry.tools;
      // Dropped or replaced while it listed: its connection is closed.
      if (this.#entries.get(entry.server.id) !== entry) return null;
      entry.failing = false;
      return { server: entry.server, connection: connection!, tools: entry.named };
    } catch (error) {
      if (this.#entries.get(entry.server.id) !== entry) return null;
      // Asked again next reply, as the built-in servers are, on a new connection: the old one may still
      // be waiting on a request that hung, and every later reply would wait on it too.
      if (connection && entry.connection === connection) {
        void connection.close();
        entry.connection = this.#connect(entry);
        entry.tools = null;
      }
      if (!entry.failing) {
        entry.failing = true;
        console.warn(`[chat-cvt] MCP server "${entry.server.id}" is unreachable; its tools are left out`, error);
        this.#deps.onError(entry.server, error);
      }
      return null;
    }
  }

  #named(server: ChatMcpServer, tools: McpTool[]): { name: string; tool: McpTool }[] {
    return tools.flatMap((tool) => {
      const name = namespacedToolName(server.id, tool.name);
      if (TOOL_NAME.test(name)) return [{ name, tool }];
      console.warn(`[chat-cvt] tool "${tool.name}" of MCP server "${server.id}" is skipped: "${name}" is not a usable tool name`);
      return [];
    });
  }

  /** What the servers listed last time they were asked, without asking again. */
  loaded(): { server: ChatMcpServer; tools: { name: string; tool: McpTool }[] }[] {
    return [...this.#entries.values()].map(({ server, named }) => ({ server, tools: named }));
  }

  close(): void {
    this.#closed = true;
    for (const entry of this.#entries.values()) void entry.connection?.close();
    this.#entries.clear();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
