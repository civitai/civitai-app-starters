import { describe, expect, it } from 'vitest';

import { readSse, SseIdleError, type SseMessage } from './sse.js';

const body = (chunks: string[], close = true) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
  });

async function read(stream: ReadableStream<Uint8Array>, idleMs?: number, alive?: () => void): Promise<SseMessage[]> {
  const messages: SseMessage[] = [];
  for await (const message of readSse(stream, idleMs, alive)) messages.push(message);
  return messages;
}

describe('readSse', () => {
  it('reads each blank-line-ended event, across chunks and CRLF line ends, skipping comments', async () => {
    expect(await read(body(['id: 1\r', '\ndata: a\r\n\r\n', ': keep-alive\n\nid: 2\ndata: b\nda', 'ta: c\n\n']))).toEqual([
      { id: '1', data: 'a' },
      { id: '2', data: 'b\nc' },
    ]);
  });

  it('drops a last event the stream ended before finishing, as EventSource does', async () => {
    expect(await read(body(['id: 1\ndata: a\n\nid: 2\ndata: b\n']))).toEqual([{ id: '1', data: 'a' }]);
    expect(await read(body(['id: 1\ndata: a\n\nid: 2\ndata: b']))).toEqual([{ id: '1', data: 'a' }]);
  });

  it('reads a last event ended by a bare CR blank line (CR CR) at the end of the stream', async () => {
    expect(await read(body(['id: 1\rdata: a\r\r']))).toEqual([{ id: '1', data: 'a' }]);
  });

  it('calls alive for a keep-alive comment, and gives up on a stream that sends nothing for too long', async () => {
    let alive = 0;
    await expect(read(body([': keep-alive\n\n'], false), 30, () => alive++)).rejects.toBeInstanceOf(SseIdleError);
    expect(alive).toBe(1);
  });
});
