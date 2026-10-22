import type { ModelMessage, ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AgentCore, type AgentCoreOutcome } from '../agent/core.js';
import type { McpConnection } from '../mcp/clients.js';
import { extraToolSet } from './extra.js';

/**
 * An added server's tool that answers with an image (the sandbox's `preview_check` screenshot): the
 * model sees the image, as a user message right after the step's tool results (the OpenAI-compatible
 * chat API takes images only there), and the reply's saved messages hold only a text note in its place.
 */

type StreamPart = Record<string, unknown>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const says = (words: string): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: words },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
const calls = (...ids: [toolCallId: string, toolName: string][]): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  ...ids.map(([toolCallId, toolName]) => ({ type: 'tool-call', toolCallId, toolName, input: '{}' })),
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];

/** Tiny, distinct stand-ins: nothing here decodes them, only their bytes and types are read. */
const PNG = Buffer.from('png-fixture-one').toString('base64');
const JPEG = Buffer.from('jpeg-fixture-two').toString('base64');
const WEBP = Buffer.from('webp-fixture-three').toString('base64');
const AUDIO = Buffer.from('wav-fixture-four').toString('base64');
const BLOB = Buffer.from('blob-fixture-five').toString('base64');

const URL = 'https://sandbox.example/mcp';
const server = { id: 'sandbox', url: URL, label: 'your app', token: () => 'tok' };

/** The sandbox's tools over a fake connection: each call answers with the next of `replies`. */
function sandboxTools(replies: CallToolResult[], names = ['preview_check', 'read_file']): ToolSet {
  const queue = [...replies];
  const connection = { url: URL, listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => queue.shift() ?? { content: [{ type: 'text', text: 'ok' }] }) } as unknown as McpConnection;
  const tools = names.map((name) => ({ name: `sandbox__${name}`, tool: { name, inputSchema: { type: 'object' } } }));
  return extraToolSet([{ server, connection, tools }], { taken: {} });
}

/** One reply through `AgentCore`: every prompt the model was asked with, what each save would have held, and how it ended. */
async function reply(steps: StreamPart[][], tools: ToolSet, history: ModelMessage[] = [{ role: 'user', content: 'does my app look right?' }]) {
  const prompts: unknown[][] = [];
  const queue = [...steps];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt as unknown[]);
      return { stream: convertArrayToReadableStream(queue.shift() ?? says('…')) as never };
    },
  });
  const saves: ModelMessage[][] = [];
  const core = new AgentCore();
  const outcome = (await core.run({
    seq: 1,
    tools: async () => tools,
    request: () => ({ model, system: 'You build apps.', history, maxOutputTokens: 512, networkRetryDelaysMs: [] }),
    toolProgress: ({ messages }) => saves.push(structuredClone(messages)),
    stepFinished: ({ messages }) => saves.push(structuredClone(messages)),
  })) as AgentCoreOutcome;
  return { prompts, saves, outcome };
}

type PromptPart = { type: string; text?: string; data?: unknown; mediaType?: string; toolCallId?: string; output?: { type: string; value: unknown } };
type PromptMessage = { role: string; content: string | PromptPart[] };
const asBase64 = (data: unknown) => (typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('base64'));
/** A prompt's messages as `role` or `role:what` (an image as its type and bytes), to read their order at a glance. */
function shape(prompt: unknown[]): string[] {
  return (prompt as PromptMessage[]).map((message) => {
    if (typeof message.content === 'string') return message.role;
    const parts = message.content.map((part) =>
      part.type === 'file' ? `${part.mediaType}=${asBase64(part.data)}` : part.type === 'text' ? `text:${part.text}` : part.type === 'tool-result' ? `result:${part.toolCallId}` : part.type,
    );
    return `${message.role}[${parts.join(' | ')}]`;
  });
}
/** A tool result's text in a prompt, by call id. */
function resultText(prompt: unknown[], toolCallId: string): unknown {
  for (const message of prompt as PromptMessage[]) {
    if (typeof message.content === 'string') continue;
    for (const part of message.content) if (part.type === 'tool-result' && part.toolCallId === toolCallId) return part.output?.value;
  }
  return undefined;
}

const SHOWN = (type: string) => `[${type} image: shown to you after this step's tool results while this reply runs (the latest 4 at most); it is not saved]`;

describe('an added server’s tool that answers with an image', () => {
  it('a text-only reply reaches the model exactly as before: same words, same order, no message added', async () => {
    const tools = sandboxTools([
      {
        content: [
          { type: 'text', text: 'Checked http://localhost:3000' },
          { type: 'resource_link', uri: 'file:///app/src/App.tsx', name: 'App.tsx' },
          { type: 'text', text: 'No console errors.' },
        ],
      } as CallToolResult,
    ]);
    const { prompts, outcome } = await reply([calls(['call_1', 'sandbox__preview_check']), says('Looks fine.')], tools);

    expect(resultText(prompts[1]!, 'call_1')).toBe('Checked http://localhost:3000\n[App.tsx]\nNo console errors.');
    expect(shape(prompts[1]!)).toEqual(['system', 'user[text:does my app look right?]', 'assistant[tool-call]', 'tool[result:call_1]']);
    expect(outcome.messages[1]).toEqual({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'sandbox__preview_check', output: { type: 'text', value: 'Checked http://localhost:3000\n[App.tsx]\nNo console errors.' } }],
    });
  });

  it('shows the image to the model as a user message right after the step’s tool results, and keeps a note in the result', async () => {
    const tools = sandboxTools([{ content: [{ type: 'text', text: 'Page loaded.' }, { type: 'image', data: PNG, mimeType: 'image/png' }] } as CallToolResult]);
    const { prompts } = await reply([calls(['call_1', 'sandbox__preview_check']), says('The header overlaps the menu.')], tools);

    expect(shape(prompts[1]!)).toEqual([
      'system',
      'user[text:does my app look right?]',
      'assistant[tool-call]',
      'tool[result:call_1]',
      `user[text:Returned by sandbox__preview_check (call_1): | image/png=${PNG}]`,
    ]);
    expect(resultText(prompts[1]!, 'call_1')).toBe(`Page loaded.\n${SHOWN('image/png')}`);
  });

  it('keeps showing it for the rest of the reply, after the results of the step that returned it', async () => {
    const tools = sandboxTools([
      { content: [{ type: 'image', data: JPEG, mimeType: 'image/jpeg' }] } as CallToolResult,
      { content: [{ type: 'text', text: 'export default App;' }] } as CallToolResult,
    ]);
    const { prompts } = await reply([calls(['call_1', 'sandbox__preview_check']), calls(['call_2', 'sandbox__read_file']), says('Fixed.')], tools);

    expect(shape(prompts[2]!)).toEqual([
      'system',
      'user[text:does my app look right?]',
      'assistant[tool-call]',
      'tool[result:call_1]',
      `user[text:Returned by sandbox__preview_check (call_1): | image/jpeg=${JPEG}]`,
      'assistant[tool-call]',
      'tool[result:call_2]',
    ]);
    expect(resultText(prompts[2]!, 'call_2')).toBe('export default App;');
  });

  it('puts the images of several calls in one step after all of that step’s results, in call order', async () => {
    const tools = sandboxTools(
      [
        { content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] } as CallToolResult,
        { content: [{ type: 'image', data: WEBP, mimeType: 'image/webp' }] } as CallToolResult,
      ],
      ['preview_check', 'preview_mobile'],
    );
    const { prompts } = await reply([calls(['call_1', 'sandbox__preview_check'], ['call_2', 'sandbox__preview_mobile']), says('Both fine.')], tools);

    expect(shape(prompts[1]!).slice(3)).toEqual([
      'tool[result:call_1 | result:call_2]',
      `user[text:Returned by sandbox__preview_check (call_1): | image/png=${PNG} | text:Returned by sandbox__preview_mobile (call_2): | image/webp=${WEBP}]`,
    ]);
  });

  it('never puts an image after an earlier reply’s result that has the same call id', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'check it' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'sandbox__preview_check', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'sandbox__preview_check', output: { type: 'text', value: 'earlier' } }] },
      { role: 'assistant', content: 'It looked fine.' },
      { role: 'user', content: 'check again' },
    ];
    const tools = sandboxTools([{ content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] } as CallToolResult]);
    const { prompts } = await reply([calls(['call_1', 'sandbox__preview_check']), says('Still fine.')], tools, history);

    const images = shape(prompts[1]!).filter((line) => line.includes(`image/png=${PNG}`));
    expect(images).toHaveLength(1);
    expect(shape(prompts[1]!).slice(-2)).toEqual(['tool[result:call_1]', `user[text:Returned by sandbox__preview_check (call_1): | image/png=${PNG}]`]);
  });

  it('shows the latest 4 images of a reply at most', async () => {
    const images = [1, 2, 3, 4, 5].map((n) => Buffer.from(`png-${n}`).toString('base64'));
    const tools = sandboxTools(images.map((data) => ({ content: [{ type: 'image', data, mimeType: 'image/png' }] }) as CallToolResult));
    const { prompts } = await reply([...[1, 2, 3, 4, 5].map((n) => calls([`call_${n}`, 'sandbox__preview_check'])), says('Done.')], tools);

    const last = JSON.stringify(shape(prompts[5]!));
    expect(images.map((data) => last.includes(`image/png=${data}`))).toEqual([false, true, true, true, true]);
  });

  it('leaves out other binary content, and images of other types, with a note saying so', async () => {
    const tools = sandboxTools([
      {
        content: [
          { type: 'text', text: 'Recorded.' },
          { type: 'audio', data: AUDIO, mimeType: 'audio/wav' },
          { type: 'resource', resource: { uri: 'file:///app/out.bin', blob: BLOB, mimeType: 'application/octet-stream' } },
          { type: 'image', data: PNG, mimeType: 'image/svg+xml' },
        ],
      } as CallToolResult,
    ]);
    const { prompts, outcome } = await reply([calls(['call_1', 'sandbox__preview_check']), says('Ok.')], tools);

    expect(resultText(prompts[1]!, 'call_1')).toBe(
      [
        'Recorded.',
        '[audio/wav content left out: only JPEG, PNG, WebP and GIF images are shown]',
        '[application/octet-stream content left out: only JPEG, PNG, WebP and GIF images are shown]',
        '[image/svg+xml content left out: only JPEG, PNG, WebP and GIF images are shown]',
      ].join('\n'),
    );
    expect(shape(prompts[1]!).at(-1)).toBe('tool[result:call_1]');
    const sent = JSON.stringify(prompts) + JSON.stringify(outcome.messages);
    for (const data of [AUDIO, BLOB, PNG]) expect(sent).not.toContain(data);
  });

  it('replaces an image over 512 KiB, and any past the second in one result, with a note', async () => {
    const big = Buffer.alloc(600 * 1024, 7).toString('base64');
    const tools = sandboxTools([
      {
        content: [
          { type: 'image', data: big, mimeType: 'image/png' },
          { type: 'image', data: PNG, mimeType: 'image/png' },
          { type: 'image', data: JPEG, mimeType: 'image/jpeg' },
          { type: 'image', data: WEBP, mimeType: 'image/webp' },
        ],
      } as CallToolResult,
    ]);
    const { prompts } = await reply([calls(['call_1', 'sandbox__preview_check']), says('Ok.')], tools);

    expect(resultText(prompts[1]!, 'call_1')).toBe(
      [
        '[image/png image left out: 600 KiB is over the 512 KiB a tool result may show]',
        SHOWN('image/png'),
        SHOWN('image/jpeg'),
        '[image/webp image left out: a tool result shows at most 2 images]',
      ].join('\n'),
    );
    expect(shape(prompts[1]!).at(-1)).toBe(`user[text:Returned by sandbox__preview_check (call_1): | image/png=${PNG} | image/jpeg=${JPEG}]`);
    expect(JSON.stringify(prompts)).not.toContain(big.slice(0, 64));
    expect(JSON.stringify(prompts)).not.toContain(WEBP);
  });

  it('saves only the note: no save of the reply as it runs, nor how it ended, holds the image', async () => {
    const tools = sandboxTools([{ content: [{ type: 'text', text: 'Page loaded.' }, { type: 'image', data: PNG, mimeType: 'image/png' }] } as CallToolResult]);
    const { prompts, saves, outcome } = await reply([calls(['call_1', 'sandbox__preview_check']), says('Looks right.')], tools);

    // Positive control: the image did reach the model in this reply.
    expect(JSON.stringify(prompts[1])).toContain(PNG);
    expect(saves.length).toBeGreaterThanOrEqual(2);
    for (const saved of [...saves, outcome.messages]) expect(JSON.stringify(saved)).not.toContain(PNG);
    expect(JSON.stringify(outcome.messages)).toContain(SHOWN('image/png'));
  });

  it('called outside a reply that can show it, says the image was not shown', async () => {
    const tools = sandboxTools([{ content: [{ type: 'text', text: 'Page loaded.' }, { type: 'image', data: PNG, mimeType: 'image/png' }] } as CallToolResult]);
    const text = await tools.sandbox__preview_check!.execute!({}, { toolCallId: 'c', messages: [] });
    expect(text).toBe('Page loaded.\n[image/png image not shown: this caller cannot show images to the assistant]');
  });
});
