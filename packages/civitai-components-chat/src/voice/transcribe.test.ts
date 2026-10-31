import { describe, expect, it, vi } from 'vitest';

import { toolResult } from '../test-support/fakes.js';
import { transcribe, transcriptOf, uploadType } from './transcribe.js';

function deps(reply = toolResult(undefined, 'Workflow: 6-1\nLanguage: en\n\nMake me a cozy cabin in the snow.')) {
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
    mcp: { callTool: vi.fn(async () => reply) },
  };
}

describe('transcribe', () => {
  it('uploads the recording and returns only the words said', async () => {
    const d = deps();
    const words = await transcribe(d, new Blob(['voice'], { type: 'audio/webm;codecs=opus' }));

    expect(words).toBe('Make me a cozy cabin in the snow.');
    expect(d.uploaded[0]?.type).toBe('audio/webm');
    expect(d.mcp.callTool).toHaveBeenCalledWith('transcribe_audio', { mediaUrl: 'https://blobs/b1', returnTimestamps: false, whatif: false }, expect.anything());
  });

  it('tells the transcriber which language was spoken', async () => {
    const d = deps();
    await transcribe(d, new Blob(['voice'], { type: 'audio/webm' }), undefined, 'nl');
    expect(d.mcp.callTool).toHaveBeenCalledWith('transcribe_audio', expect.objectContaining({ language: 'nl' }), expect.anything());
  });

  it('says so when the service could not transcribe it', async () => {
    await expect(transcribe(deps(toolResult(undefined, 'Transcription failed: no speech', true)), new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow('no speech');
  });

  it("uploads Safari's MP4 recordings as MP4, which the service takes", () => {
    expect(uploadType('audio/mp4')).toBe('video/mp4');
    expect(uploadType('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('leaves out timestamps when the reply carries them', () => {
    expect(transcriptOf('Workflow: 6-1\nLanguage: en\n\nHello there.\n\nTimestamps:\n[0.00-1.00] Hello there.')).toBe('Hello there.');
  });
});
