import { describe, expect, it } from 'vitest';

import { chargeFetch } from './charge.js';

describe('chargeFetch', () => {
  it('reads what a call was charged from its closing usage, split however the network splits it, and passes the stream through as sent', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":900,"completion_tokens":40,"total_tokens":940,"cost":37}}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(body);
    const inner = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )) as typeof fetch;
    const charges: number[] = [];

    const response = await chargeFetch(inner, (buzz) => charges.push(buzz))('https://orch/v1/chat/completions');

    expect(await response.text()).toBe(body);
    expect(charges).toEqual([37]);
  });
});
