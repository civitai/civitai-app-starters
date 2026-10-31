import type { McpConnection } from '../mcp/clients.js';

/** Tools whose reply is the same for the same input within one chat, and that cost the viewer per call. */
export const CACHED_TOOLS: ReadonlySet<string> = new Set(['fetch_page']);

export const CACHE_HIT_NOTE = '(Already fetched in this chat; same content.)';

/** Kept per chat; the oldest go first. */
const MAX_ENTRIES = 32;
/** Chats remembered per connection; switching back and forth between a few keeps theirs. */
const MAX_CONVERSATIONS = 4;

/**
 * Replies of {@link CACHED_TOOLS}, by connection, then chat, then input. Lives outside the tool set,
 * which is built again for every reply, and only in memory: a reload fetches again. A reply still on
 * its way is kept too, so two calls in one step share one fetch; a failed one is forgotten.
 */
const caches = new WeakMap<McpConnection, Map<string, Map<string, Promise<string>>>>();

/** The same page asked for twice reads as one key: scheme and host in lower case, no `#fragment`, keys in order. */
export function cacheKey(toolName: string, input: Record<string, unknown>): string {
  const entries = Object.keys(input)
    .sort()
    .map((key) => [key, normalise(input[key])]);
  return `${toolName}:${JSON.stringify(entries)}`;
}

function normalise(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    url.hash = '';
    return url.toString();
  } catch {
    return trimmed;
  }
}

export function cachedReply(connection: McpConnection, conversationId: string, key: string): Promise<string> | undefined {
  const chat = caches.get(connection)?.get(conversationId);
  const text = chat?.get(key);
  if (text === undefined || !chat) return undefined;
  chat.delete(key);
  chat.set(key, text);
  return text;
}

export function rememberReply(connection: McpConnection, conversationId: string, key: string, text: Promise<string>): void {
  let chats = caches.get(connection);
  if (!chats) caches.set(connection, (chats = new Map()));
  let chat = chats.get(conversationId);
  if (chat) chats.delete(conversationId);
  else chat = new Map();
  chats.set(conversationId, chat);
  while (chats.size > MAX_CONVERSATIONS) chats.delete(chats.keys().next().value!);
  chat.delete(key);
  chat.set(key, text);
  while (chat.size > MAX_ENTRIES) chat.delete(chat.keys().next().value!);
}

/** Only a reply that came back whole is kept: a failure is worth asking again. */
export function forgetReply(connection: McpConnection, conversationId: string, key: string, text: Promise<string>): void {
  const chat = caches.get(connection)?.get(conversationId);
  if (chat?.get(key) === text) chat.delete(key);
}
