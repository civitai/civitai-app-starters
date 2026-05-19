export interface GenerateInput {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  quantity?: number;
}

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
      images?: Array<{ url?: string; available?: boolean }>;
      blobs?: Array<{ url?: string; type?: string; mimeType?: string }>;
    };
  }>;
  [key: string]: unknown;
}

export function isTerminal(snap: WorkflowSnapshot | null | undefined): boolean {
  if (!snap?.status) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(String(snap.status));
}

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

export const DEFAULT_MODEL_AIR = 'urn:air:sdxl:checkpoint:civitai:101055@128078';
