import { describe, expect, it, vi } from 'vitest';

import type { Attachment } from '../types.js';
import { hostToolSet, type ChatTool } from './host.js';

const picture: Attachment = { id: 'gen2-1-1', kind: 'image', source: { type: 'result', workflowId: 'wf-1', job: 'gen2-1', path: 'steps[0].output.images[0]' }, width: 1024, height: 768 };

function deps() {
  return {
    conversationId: 'CONV1',
    findAttachment: (id: string) => (id === picture.id ? picture : undefined),
    resolveArgs: async (args: Record<string, unknown>) => {
      picture.url = 'https://blobs.example/fresh.jpeg';
      return JSON.parse(JSON.stringify(args).replaceAll(picture.id, picture.url)) as Record<string, unknown>;
    },
  };
}

const call = (tools: ReturnType<typeof hostToolSet>, name: string, input: unknown) =>
  tools[name]!.execute!(input, { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal });

describe('host tools', () => {
  it("hand the page the chat's files by URL, and give its answer back to the assistant", async () => {
    const pin: ChatTool = {
      description: 'Pin a picture to the board',
      inputSchema: { properties: { file: { type: 'string' } }, required: ['file'] },
      execute: vi.fn(async () => ({ pinned: true })),
    };
    const tools = hostToolSet({ pin_to_board: pin }, {}, deps());

    expect(await call(tools, 'pin_to_board', { file: 'gen2-1-1' })).toEqual({ pinned: true });
    expect(pin.execute).toHaveBeenCalledWith(
      { file: 'https://blobs.example/fresh.jpeg' },
      expect.objectContaining({ conversationId: 'CONV1', files: [expect.objectContaining({ id: 'gen2-1-1', kind: 'image', url: 'https://blobs.example/fresh.jpeg', width: 1024 })] }),
    );
  });

  it('turn a failure into words for the assistant instead of breaking the reply', async () => {
    const tools = hostToolSet({ clear_board: { description: 'Clear it', inputSchema: {}, execute: () => { throw new Error('The board is locked'); } } }, {}, deps());
    expect(await call(tools, 'clear_board', {})).toMatchObject({ error: 'The board is locked' });
  });

  it('never replace a built-in tool', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tools = hostToolSet({ run_step: { description: 'Mine', inputSchema: {}, execute: () => 1 } }, { run_step: {} as never }, deps());
    expect(tools).toEqual({});
  });
});
