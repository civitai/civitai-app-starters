import { APICallError } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';

/** A model that answers each request with the next scripted stream, as the reply tests script one. */

export type StreamPart = Record<string, unknown>;
export type Scripted = StreamPart[] | ((signal?: AbortSignal) => ReadableStream<StreamPart>) | Error;

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

export const text = (...deltas: string[]): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })),
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];

export const toolCall = (toolName: string, input: unknown, toolCallId = 'call_1'): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];

/** A 200 answer that streams `parts`, then dies with `error`; each part is handed over only when read. */
export const cutAfter =
  (parts: StreamPart[], error: () => unknown) =>
  (): ReadableStream<StreamPart> => {
    const queue = [...parts];
    return new ReadableStream<StreamPart>(
      {
        pull(controller) {
          const next = queue.shift();
          if (next) controller.enqueue(next);
          else controller.error(error());
        },
      },
      { highWaterMark: 0 },
    );
  };

/** Chromium's shape for a 2xx body the network cut mid-read: a dropped connection the reply recovers from. */
export const bodyCut = () =>
  new APICallError({
    message: 'Failed to process successful response',
    url: 'https://orchestration.example/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 200,
    cause: new TypeError('network error'),
    isRetryable: false,
  });

export function scriptedModel(responses: Scripted[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return { stream: next(options.abortSignal) as never };
      return { stream: convertArrayToReadableStream(next ?? text('…')) as never };
    },
    doGenerate: async () => ({ content: [{ type: 'text', text: 'Title' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
  });
}
