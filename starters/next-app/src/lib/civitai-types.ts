/**
 * Client-safe types and constants. Importable from both server and client
 * components. The server-only counterpart is `src/lib/civitai.ts`.
 */

export interface GenerateInput {
  prompt: string;
  negativePrompt?: string;
  /** AIR URN, e.g. `urn:air:sdxl:checkpoint:civitai:101055@128078`. */
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  quantity?: number;
}

/**
 * Orchestrator workflow status. Lowercase — matches what the orchestrator
 * actually returns. Forward-compat: open-ended string union so unknown
 * statuses don't break typing.
 */
export type WorkflowStatus =
  | 'unassigned'
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'canceled'
  | (string & {});

export const TERMINAL_STATUSES = ['succeeded', 'failed', 'expired', 'canceled'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export interface WorkflowSnapshot {
  id: string;
  status: WorkflowStatus;
  cost?: { total?: number };
  steps?: Array<{
    output?: {
      /** Canonical image array. Each item has `url` + `available: boolean`. */
      images?: Array<{ url?: string; available?: boolean }>;
      /** Legacy/alternative — some workflow types still emit `blobs[]`. */
      blobs?: Array<{ url?: string; type?: string; mimeType?: string }>;
    };
  }>;
  [key: string]: unknown;
}

export function isTerminal(snap: WorkflowSnapshot | null | undefined): boolean {
  if (!snap?.status) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(String(snap.status));
}

/** Pull every image URL out of a finished workflow snapshot. */
export function extractImageUrls(snap: WorkflowSnapshot | null | undefined): string[] {
  if (!snap?.steps) return [];
  const out: string[] = [];
  for (const step of snap.steps) {
    for (const img of step.output?.images ?? []) {
      if (img.available && img.url) out.push(img.url);
    }
    for (const blob of step.output?.blobs ?? []) {
      if (blob.url && (blob.mimeType ?? blob.type ?? '').startsWith('image/')) {
        out.push(blob.url);
      }
    }
  }
  return out;
}

/** Default SDXL base model. Replace with whatever fits your app. */
export const DEFAULT_MODEL_AIR = 'urn:air:sdxl:checkpoint:civitai:101055@128078';
