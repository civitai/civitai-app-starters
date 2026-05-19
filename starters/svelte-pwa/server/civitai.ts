import { fetchMe } from '@civitai/app-sdk';
import { env } from './env.js';
import type { Session } from './session.js';

export interface MeResponse {
  id?: number;
  username?: string;
  balance?: number;
  [key: string]: unknown;
}

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

export interface WorkflowSnapshot {
  id: string;
  status: string;
  cost?: { total?: number };
  steps?: Array<{
    output?: {
      images?: Array<{ url?: string; available?: boolean }>;
      blobs?: Array<{ url?: string; type?: string; mimeType?: string }>;
    };
  }>;
  [key: string]: unknown;
}

/** Terminal orchestrator statuses (lowercase — matches what the API returns). */
export const TERMINAL_STATUSES = ['succeeded', 'failed', 'expired', 'canceled'] as const;

export function isTerminal(snap: WorkflowSnapshot | null | undefined): boolean {
  if (!snap?.status) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(String(snap.status));
}

export const DEFAULT_MODEL_AIR = 'urn:air:sdxl:checkpoint:civitai:101055@128078';

export async function getMe(session: Session): Promise<MeResponse> {
  return (await fetchMe({
    baseUrl: env.CIVITAI_BASE_URL,
    accessToken: session.tokens.access_token,
  })) as MeResponse;
}

function buildWorkflowBody(input: GenerateInput) {
  return {
    tags: ['civitai-app-starter', 'svelte-pwa'],
    steps: [
      {
        $type: 'textToImage' as const,
        name: 'step_0',
        timeout: '00:10:00',
        input: {
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          model: input.model ?? DEFAULT_MODEL_AIR,
          width: input.width ?? 1024,
          height: input.height ?? 1024,
          steps: input.steps ?? 25,
          cfgScale: input.cfgScale ?? 5,
          seed: input.seed,
          quantity: input.quantity ?? 1,
        },
      },
    ],
  };
}

export class OrchestratorError extends Error {
  override readonly name = 'OrchestratorError';
  constructor(
    message: string,
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(message);
  }
}

async function callOrchestrator(
  path: string,
  init: RequestInit & { token: string },
): Promise<unknown> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${env.ORCHESTRATOR_URL}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    console.error(
      `[orchestrator] ${init.method ?? 'GET'} ${path} -> ${res.status} ${res.statusText}\n` +
        `  raw body: ${text.length ? text.slice(0, 500) : '(empty)'}`,
    );
    throw new OrchestratorError(`HTTP ${res.status}`, res.status, body);
  }
  return body;
}

export async function estimateGenerationCost(
  session: Session,
  input: GenerateInput,
): Promise<WorkflowSnapshot> {
  return (await callOrchestrator('/v2/consumer/workflows?whatif=true', {
    token: session.tokens.access_token,
    method: 'POST',
    body: JSON.stringify(buildWorkflowBody(input)),
  })) as WorkflowSnapshot;
}

export async function submitGeneration(
  session: Session,
  input: GenerateInput,
): Promise<WorkflowSnapshot> {
  return (await callOrchestrator('/v2/consumer/workflows', {
    token: session.tokens.access_token,
    method: 'POST',
    body: JSON.stringify(buildWorkflowBody(input)),
  })) as WorkflowSnapshot;
}

export async function getWorkflowSnapshot(
  session: Session,
  workflowId: string,
): Promise<WorkflowSnapshot> {
  return (await callOrchestrator(
    `/v2/consumer/workflows/${encodeURIComponent(workflowId)}`,
    { token: session.tokens.access_token, method: 'GET' },
  )) as WorkflowSnapshot;
}
