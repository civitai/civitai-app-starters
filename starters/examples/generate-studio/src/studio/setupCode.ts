import type { BlockResourceInfo } from '@civitai/app-sdk/blocks';

import { clamp, LORA_STRENGTH_MAX, LORA_STRENGTH_MIN, MAX_LORAS, type LoraChoice } from './setup.js';

/**
 * A SETUP CODE — a short, shareable string naming a checkpoint and its LoRAs by
 * version id, e.g. `128078 + 666002@0.8, 777003@1`. Pasting one back rehydrates
 * the resources with `useGenerationResources().fetch(ids)` — names, family and
 * recommended weights — WITHOUT reopening the picker.
 *
 * It carries ids and weights only. Everything else comes back from the server,
 * and a rehydrated id is a HINT exactly like a picked one: the server
 * re-validates and re-prices it at estimate/submit.
 */
export function encodeSetupCode(checkpointVersionId: number, loras: LoraChoice[]): string {
  const tail = loras.map((l) => `${l.resource.versionId}@${round2(l.strength)}`).join(', ');
  return tail ? `${checkpointVersionId} + ${tail}` : String(checkpointVersionId);
}

export interface ParsedSetupCode {
  checkpointVersionId: number;
  loras: Array<{ versionId: number; strength: number }>;
}

/** `null` when the string is not a setup code. Never throws. */
export function parseSetupCode(code: string): ParsedSetupCode | null {
  const [head, tail = ''] = code.split('+', 2);
  const checkpointVersionId = positiveInt(head);
  if (checkpointVersionId === null) return null;
  const loras: ParsedSetupCode['loras'] = [];
  for (const part of tail.split(',')) {
    if (!part.trim()) continue;
    const [id, weight] = part.split('@');
    const versionId = positiveInt(id);
    const strength = weight === undefined ? 1 : Number(weight);
    if (versionId === null || !Number.isFinite(strength)) return null;
    loras.push({ versionId, strength: clamp(strength, LORA_STRENGTH_MIN, LORA_STRENGTH_MAX) });
  }
  return loras.length > MAX_LORAS ? null : { checkpointVersionId, loras };
}

/**
 * Match the rehydrated rows back to the code. The endpoint OMITS what this viewer
 * cannot use (unpublished, private, or mature on a SFW surface), and returns rows
 * in its own order — so match by id, and report what went missing.
 */
export function resolveSetupCode(parsed: ParsedSetupCode, rows: BlockResourceInfo[]) {
  const byId = new Map(rows.map((r) => [r.versionId, r]));
  const checkpoint = byId.get(parsed.checkpointVersionId);
  const loras: Array<{ resource: BlockResourceInfo; strength: number }> = [];
  let missing = checkpoint && checkpoint.modelType === 'Checkpoint' ? 0 : 1;
  for (const l of parsed.loras) {
    const r = byId.get(l.versionId);
    if (r && r.modelType !== 'Checkpoint') loras.push({ resource: r, strength: l.strength });
    else missing++;
  }
  return { checkpoint: checkpoint?.modelType === 'Checkpoint' ? checkpoint : null, loras, missing };
}

function positiveInt(s: string | undefined): number | null {
  const n = Number((s ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
