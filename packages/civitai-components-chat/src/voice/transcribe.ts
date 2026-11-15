import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { McpConnection } from '../mcp/clients.js';
import { mcpResultToText } from '../mcp/result.js';
import type { OrchestrationApi } from '../orchestration/api.js';
import { uploadFile } from '../uploads/upload.js';

export interface TranscribeDeps {
  api: Pick<OrchestrationApi, 'presignUpload' | 'uploadDirect'>;
  mcp: Pick<McpConnection, 'callTool'>;
}

/**
 * The orchestrator's speech-to-text step. `/mcp/v2` has no `transcribe_audio` tool (it went in the
 * discovery-first rewrite): transcription is a service like any other, and
 * `find_services(category: 'audio', takes: ['audio'])` returns it as this step type. It has one
 * service, so dictation names the step instead of looking it up on every phrase.
 */
export const TRANSCRIPTION_STEP = 'transcription';

const FAILED = 'The recording could not be turned into text.';

/** What someone said into the microphone, as text for the message box. */
export async function transcribe(deps: TranscribeDeps, recording: Blob, signal?: AbortSignal, language?: string): Promise<string> {
  const type = uploadType(recording.type);
  const file = new File([recording], type === 'audio/webm' ? 'voice.webm' : 'voice.mp4', { type });
  const uploaded = await uploadFile({ api: deps.api }, file, { signal });
  // `whatif` defaults to true on `run_step`, which only prices the step: false runs it (and spends).
  const input = { mediaUrl: uploaded.url, returnTimeStamps: false, ...(language ? { language } : {}) };
  const result = await deps.mcp.callTool('run_step', { stepType: TRANSCRIPTION_STEP, input, whatif: false }, { signal });
  const step = transcriptionStep(result);
  if (result.isError || !step) throw new Error(step?.error || mcpResultToText(result, Infinity) || FAILED);
  if (step.output?.hasAudio === false) throw new Error('The recording has no sound in it.');
  const text = step.output?.text;
  if (typeof text !== 'string') throw new Error(FAILED);
  return text.trim();
}

// Safari records MP4; uploads take MP4 as video, and transcription reads the audio of either.
export function uploadType(recorded: string): 'audio/webm' | 'video/mp4' {
  return recorded.startsWith('audio/webm') || recorded.startsWith('video/webm') ? 'audio/webm' : 'video/mp4';
}

interface StepSummary {
  stepType?: unknown;
  status?: unknown;
  error?: string;
  output?: { text?: unknown; hasAudio?: unknown };
}

/**
 * The transcription step in a `run_step` reply. Its text block is a `Workflow <id> <status>.` line and
 * then a JSON array with one `{ name, stepType, status, output?, error? }` per step; any resource
 * links to files a step made come as blocks of their own.
 */
export function transcriptionStep(result: CallToolResult): StepSummary | undefined {
  for (const block of result.content) {
    if (block.type !== 'text' || !block.text.startsWith('Workflow ')) continue;
    const newline = block.text.indexOf('\n');
    if (newline < 0) continue;
    let steps: unknown;
    try {
      steps = JSON.parse(block.text.slice(newline + 1));
    } catch {
      continue;
    }
    if (!Array.isArray(steps)) continue;
    const step = steps.find((entry): entry is StepSummary => Boolean(entry) && typeof entry === 'object' && (entry as StepSummary).stepType === TRANSCRIPTION_STEP);
    if (step) return { ...step, error: typeof step.error === 'string' ? step.error : undefined };
  }
  return undefined;
}
