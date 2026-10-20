/** One server-sent event: its `id:` (when it had one) and its `data:` lines joined. */
export interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Reads a `text/event-stream` body as it arrives, one message per blank-line-ended block, as the
 * EventSource spec parses it (comments and `retry:` are read and dropped), except that a message's
 * `id` is only the one it carries itself. Unlike `EventSource`, the
 * request that opened it can carry headers (the page's auth). `idleMs`: a body that sends nothing for
 * that long (not even a comment) is taken as dead, and reading it throws `SseIdleError`. `alive` is
 * called whenever anything arrives, a keep-alive comment included.
 */
export async function* readSse(body: ReadableStream<Uint8Array>, idleMs?: number, alive?: () => void): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  let sawData = false;
  try {
    for (;;) {
      const { value, done } = await readWithin(reader, idleMs);
      if (!done) alive?.();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A CR at the end of a chunk may be the first half of a CRLF: kept until the next chunk says.
      const lines = buffer.split(/\r\n|\n|\r(?!$)/);
      buffer = done ? '' : lines.pop()!;
      for (const raw of done ? [...lines, ''] : lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line === '') {
          if (sawData) yield { ...(id !== undefined ? { id } : {}), ...(event ? { event } : {}), data: data.join('\n') };
          // Unlike EventSource, an id is a message's own: one without `id:` carries none.
          data = [];
          id = undefined;
          event = undefined;
          sawData = false;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value_ = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') {
          data.push(value_);
          sawData = true;
        } else if (field === 'id' && !value_.includes('\0')) id = value_;
        else if (field === 'event') event = value_;
      }
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** Thrown when an event stream sent nothing for longer than it may. */
export class SseIdleError extends Error {
  override name = 'SseIdleError';
}

function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number | undefined): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (idleMs === undefined) return reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SseIdleError(`The event stream sent nothing for ${idleMs} ms.`)), idleMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
