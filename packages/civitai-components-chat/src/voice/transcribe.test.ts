import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import { createMcpConnection } from '../mcp/clients.js';
import { fakeMcpServers } from '../test-support/fake-mcp.js';
import { toolResult } from '../test-support/fakes.js';
import { TRANSCRIPTION_STEP, transcribe, transcriptionStep, uploadType } from './transcribe.js';

/** A `/mcp/v2` `run_step` reply, in the shape the orchestrator renders it. */
function runStepReply(step: Record<string, unknown>, status = 'succeeded'): CallToolResult {
  const summary = [{ name: '$0', stepType: TRANSCRIPTION_STEP, status, ...step }];
  return toolResult(undefined, `Workflow 6-20261114 ${status}.\n${JSON.stringify(summary)}`, status !== 'succeeded');
}

const SAID = 'Make me a cozy cabin in the snow.';

function deps(reply = runStepReply({ output: { text: ` ${SAID} `, language: 'en', timeStamps: [], elapsedSeconds: 1.2 } })) {
  const uploaded: File[] = [];
  return {
    uploaded,
    api: {
      presignUpload: vi.fn(async () => {
        throw new Error('no presign here');
      }),
      uploadDirect: vi.fn(async (file: File) => {
        uploaded.push(file);
        return { id: 'b1', url: 'https://blobs/b1' };
      }),
    },
    mcp: { callTool: vi.fn(async (_name: string, _args: Record<string, unknown>, _opts?: unknown) => reply) },
  };
}

describe('transcribe', () => {
  it('uploads the recording, runs the v2 transcription step for real, and returns only the words said', async () => {
    const d = deps();
    const words = await transcribe(d, new Blob(['voice'], { type: 'audio/webm;codecs=opus' }));

    expect(words).toBe(SAID);
    expect(d.uploaded[0]?.type).toBe('audio/webm');
    // whatif must be false: on run_step it defaults to true, which only prices the step.
    expect(d.mcp.callTool).toHaveBeenCalledWith(
      'run_step',
      { stepType: 'transcription', input: { mediaUrl: 'https://blobs/b1', returnTimeStamps: false }, whatif: false },
      expect.anything(),
    );
  });

  it('never calls the v1-only transcribe_audio tool', async () => {
    const d = deps();
    await transcribe(d, new Blob(['voice'], { type: 'audio/webm' }));
    expect(d.mcp.callTool.mock.calls.map(([name]) => name)).toEqual(['run_step']);
  });

  it('tells the transcriber which language was spoken, inside the step input', async () => {
    const d = deps();
    await transcribe(d, new Blob(['voice'], { type: 'audio/webm' }), undefined, 'nl');
    expect(d.mcp.callTool).toHaveBeenCalledWith('run_step', expect.objectContaining({ input: expect.objectContaining({ language: 'nl' }) }), expect.anything());
  });

  it("says so with the step's own error when it failed", async () => {
    const failed = runStepReply({ error: 'Transcription failed: no speech' }, 'failed');
    await expect(transcribe(deps(failed), new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow('Transcription failed: no speech');
  });

  it('passes on a refusal that carries no step at all', async () => {
    const refused = toolResult(undefined, "Unknown input property 'returnTimestamps'.", true);
    await expect(transcribe(deps(refused), new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow("Unknown input property 'returnTimestamps'.");
  });

  it('says the recording had no sound when the step found no audio track', async () => {
    const silent = runStepReply({ output: { text: '', language: 'en', timeStamps: [], elapsedSeconds: 0.1, hasAudio: false } });
    await expect(transcribe(deps(silent), new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow('no sound');
  });

  it('refuses a reply that only priced the step (whatif) instead of running it', async () => {
    const priced = toolResult({ cost: { total: 1 } }, '{"cost":{"total":1}}');
    await expect(transcribe(deps(priced), new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow();
  });

  it("uploads Safari's MP4 recordings as MP4, which the service takes", () => {
    expect(uploadType('audio/mp4')).toBe('video/mp4');
    expect(uploadType('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('over a real MCP client, sends run_step to the v2 server and reads the words from its reply', async () => {
    const url = 'https://orch.example/mcp/v2';
    const seen: Record<string, unknown>[] = [];
    const fake = fakeMcpServers({
      [url]: [
        {
          name: 'run_step',
          run: (args) => {
            seen.push(args);
            return runStepReply({ output: { text: 'Hello there.', language: 'en', timeStamps: [], elapsedSeconds: 0.4 } });
          },
        },
      ],
    });
    const mcp = createMcpConnection({ url, token: () => 'tok', fetch: fake.fetch });

    const words = await transcribe({ api: deps().api, mcp }, new Blob(['voice'], { type: 'audio/webm' }), undefined, 'en');

    expect(words).toBe('Hello there.');
    expect(seen).toEqual([{ stepType: 'transcription', input: { mediaUrl: 'https://blobs/b1', returnTimeStamps: false, language: 'en' }, whatif: false }]);
    expect(fake.servers[url]!.authorizations.every((header) => header === 'Bearer tok')).toBe(true);
  });

  it('over a real MCP client, a server without run_step fails the phrase instead of returning nothing', async () => {
    const url = 'https://orch.example/mcp/v2';
    const fake = fakeMcpServers({ [url]: [{ name: 'transcribe_audio' }] });
    const mcp = createMcpConnection({ url, token: () => 'tok', fetch: fake.fetch });

    await expect(transcribe({ api: deps().api, mcp }, new Blob(['voice'], { type: 'audio/webm' }))).rejects.toThrow('no tool run_step');
  });
});

describe('transcriptionStep', () => {
  it('finds the step in the text block, past any resource links before it', () => {
    const reply = runStepReply({ output: { text: 'hi' } });
    const withLink = { ...reply, content: [{ type: 'resource_link', uri: 'spine://blobs/x', name: 'x' }, ...reply.content] } as CallToolResult;
    expect(transcriptionStep(withLink)?.output?.text).toBe('hi');
  });

  it('is undefined for a reply that is not a workflow summary', () => {
    expect(transcriptionStep(toolResult(undefined, 'Workflow: 6-1\nLanguage: en\n\nHello there.'))).toBeUndefined();
  });
});
