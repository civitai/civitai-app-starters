import type { ChatConversation, ChatConversationStore } from '../store/conversation-store.js';

/** An OpenAI-compatible streamed reply, one `data:` frame per chunk. */
export function sse(...chunks: unknown[]): Response {
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const chunk = (id: string, delta: unknown, finish: string | null) => ({ id, object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });

/** A reply that streams `words` in two pieces. */
export function textReply(...words: string[]): Response {
  return sse(...words.map((piece, index) => chunk('r', index === 0 ? { role: 'assistant', content: piece } : { content: piece }, null)), chunk('r', {}, 'stop'));
}

/** A reply that calls one tool. */
export function toolCallReply(name: string, args: unknown, id = 'call_1'): Response {
  return sse(
    chunk('t', { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, null),
    chunk('t', {}, 'tool_calls'),
  );
}

/** A host's store kept in memory, recording every call. */
export function memoryStore(initial: ChatConversation[] = []): ChatConversationStore & { records: Map<string, ChatConversation>; calls: string[] } {
  const records = new Map(initial.map((record) => [record.id, structuredClone(record)]));
  const calls: string[] = [];
  return {
    records,
    calls,
    async list({ scope }) {
      calls.push('list');
      const items = [...records.values()]
        .filter((record) => record.scope === scope)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
      return { items };
    },
    async load(id) {
      calls.push(`load ${id}`);
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    async save(conversation) {
      calls.push(`save ${conversation.id}`);
      // As a real store would: through JSON, so nothing live is kept.
      records.set(conversation.id, JSON.parse(JSON.stringify(conversation)) as ChatConversation);
    },
    async delete(id) {
      calls.push(`delete ${id}`);
      records.delete(id);
    },
  };
}

/** Hosts a request could reach that belong to Civitai's services or OpenRouter. */
export const CIVITAI_HOSTS = /(^|\.)civitai\.com$|(^|\.)openrouter\.ai$/;

export function isCivitaiRequest(url: string): boolean {
  try {
    return CIVITAI_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The URL a fetch call was made with, whatever form it took. */
export function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** A whole (non-streamed) reply, as a chat is named with. */
export function completion(text: string): Response {
  return Response.json({ id: 'c', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
}
