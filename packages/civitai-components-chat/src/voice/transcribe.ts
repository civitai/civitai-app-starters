import type { McpConnection } from '../mcp/clients.js';
import { mcpResultToText } from '../mcp/result.js';
import type { OrchestrationApi } from '../orchestration/api.js';
import { uploadFile } from '../uploads/upload.js';

export interface TranscribeDeps {
  api: Pick<OrchestrationApi, 'presignUpload' | 'uploadDirect'>;
  mcp: Pick<McpConnection, 'callTool'>;
}

/** What someone said into the microphone, as text for the message box. */
export async function transcribe(deps: TranscribeDeps, recording: Blob, signal?: AbortSignal, language?: string): Promise<string> {
  const type = uploadType(recording.type);
  const file = new File([recording], type === 'audio/webm' ? 'voice.webm' : 'voice.mp4', { type });
  const uploaded = await uploadFile({ api: deps.api }, file, { signal });
  const result = await deps.mcp.callTool('transcribe_audio', { mediaUrl: uploaded.url, returnTimestamps: false, whatif: false, ...(language ? { language } : {}) }, { signal });
  const text = mcpResultToText(result, Infinity);
  if (result.isError) throw new Error(text || 'The recording could not be turned into text.');
  return transcriptOf(text);
}

// Safari records MP4; uploads take MP4 as video, and transcription reads the audio of either.
export function uploadType(recorded: string): 'audio/webm' | 'video/mp4' {
  return recorded.startsWith('audio/webm') || recorded.startsWith('video/webm') ? 'audio/webm' : 'video/mp4';
}

/** The words, without the "Workflow:" and "Language:" lines or any timestamps the reply carries. */
export function transcriptOf(reply: string): string {
  const body = reply.split(/\n\s*\nTimestamps:/)[0] ?? '';
  return body
    .split('\n')
    .filter((line) => !/^(Workflow|Language):/.test(line))
    .join('\n')
    .trim();
}
