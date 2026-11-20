import type { Workflow } from '@civitai/sdk';

import type { MediaKind } from '../types.js';

export interface ResultMedia {
  stepName: string;
  path: string;
  kind: MediaKind;
  blobId: string;
  available: boolean;
  url?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  nsfwLevel?: string;
  blocked: boolean;
}

const MEDIA_KINDS = new Set<string>(['image', 'video', 'audio']);

/**
 * Every media blob a workflow produced, in step order. Found by shape rather than
 * by step type so a step the orchestrator adds later needs no change here.
 */
export function readOutputs(workflow: Workflow): ResultMedia[] {
  const found: ResultMedia[] = [];
  workflow.steps.forEach((step, index) => {
    const output = (step as { output?: unknown }).output;
    if (output) walk(output, 'output', step.name ?? `$${index}`, found);
  });
  return found;
}

function walk(value: unknown, path: string, stepName: string, found: ResultMedia[], key = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, stepName, found, key));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (isBlob(record)) {
    const kind = kindOf(record, key);
    if (kind) found.push(toMedia(record, kind, path, stepName));
    return;
  }
  for (const [child, next] of Object.entries(record)) walk(next, `${path}.${child}`, stepName, found, child);
}

function isBlob(record: Record<string, unknown>): boolean {
  return typeof record.id === 'string' && typeof record.available === 'boolean';
}

/**
 * The orchestrator writes a blob's `type` only where the field is declared as the
 * base Blob; `images[]` and `video` arrive without one, so the field name and the
 * blob's own measurements have to say what it is.
 */
function kindOf(record: Record<string, unknown>, key: string): MediaKind | null {
  if (typeof record.type === 'string') return MEDIA_KINDS.has(record.type) ? (record.type as MediaKind) : null;
  if (/video/i.test(key)) return 'video';
  if (/audio/i.test(key)) return 'audio';
  if (/image|frame|preview/i.test(key)) return 'image';
  const measured = typeof record.width === 'number';
  const timed = typeof record.duration === 'number';
  if (measured) return timed ? 'video' : 'image';
  return timed ? 'audio' : null;
}

function toMedia(blob: Record<string, unknown>, kind: MediaKind, path: string, stepName: string): ResultMedia {
  const number = (key: string) => (typeof blob[key] === 'number' ? (blob[key] as number) : undefined);
  const url = typeof blob.url === 'string' && blob.url !== '' ? blob.url : undefined;
  const blockedReason = typeof blob.blockedReason === 'string' && blob.blockedReason !== '' ? blob.blockedReason : undefined;
  return {
    stepName,
    path,
    kind,
    blobId: blob.id as string,
    available: blob.available as boolean,
    url,
    width: number('width'),
    height: number('height'),
    durationSec: number('duration'),
    nsfwLevel: typeof blob.nsfwLevel === 'string' ? blob.nsfwLevel : undefined,
    blocked: blockedReason !== undefined || (blob.available === true && url === undefined),
  };
}

/** Where a workflow is: the slowest running step's progress and the longest queue wait. */
export function progressOf(workflow: Workflow): { progress: number | null; queued: number | null } {
  const rates = workflow.steps
    .map((step) => step.estimatedProgressRate)
    .filter((rate): rate is number => typeof rate === 'number' && rate > 0);
  const waits = workflow.steps
    .map((step) => step.queuePosition?.precedingJobs)
    .filter((ahead): ahead is number => typeof ahead === 'number');
  return {
    progress: rates.length > 0 ? Math.min(...rates) : null,
    queued: waits.length > 0 ? Math.max(...waits) : null,
  };
}

/** The first error the orchestrator attached to a failed step, if it said one. */
export function failureOf(workflow: Workflow): string | undefined {
  for (const step of workflow.steps) {
    const error = (step as { metadata?: Record<string, unknown> | null }).metadata?.error;
    if (typeof error === 'string' && error !== '') return error;
    const errors = (step as { output?: { errors?: unknown } }).output?.errors;
    if (Array.isArray(errors) && typeof errors[0] === 'string') return errors[0];
  }
  return undefined;
}
