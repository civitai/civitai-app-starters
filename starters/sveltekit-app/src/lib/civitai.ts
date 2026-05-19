import { fetchMe } from '@civitai/app-sdk';
import { config } from './env';
import {
  DEFAULT_MODEL_AIR,
  type GenerateInput,
  type WorkflowSnapshot,
} from './civitai-types';
import type { Session } from './session';

export interface MeResponse {
  id?: number;
  username?: string;
  balance?: number;
  [key: string]: unknown;
}

export async function getMe(session: Session): Promise<MeResponse> {
  return (await fetchMe({
    baseUrl: config.CIVITAI_BASE_URL,
    accessToken: session.tokens.access_token,
  })) as MeResponse;
}

function buildWorkflowBody(input: GenerateInput) {
  return {
    tags: ['civitai-app-starter', 'sveltekit-app'],
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
  const res = await fetch(`${config.ORCHESTRATOR_URL}${path}`, {
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

async function postWorkflow(
  session: Session,
  input: GenerateInput,
  path: string,
): Promise<WorkflowSnapshot> {
  return (await callOrchestrator(path, {
    token: session.tokens.access_token,
    method: 'POST',
    body: JSON.stringify(buildWorkflowBody(input)),
  })) as WorkflowSnapshot;
}

export function estimateGenerationCost(session: Session, input: GenerateInput) {
  return postWorkflow(session, input, '/v2/consumer/workflows?whatif=true');
}

export function submitGeneration(session: Session, input: GenerateInput) {
  return postWorkflow(session, input, '/v2/consumer/workflows');
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

export type { GenerateInput, WorkflowSnapshot } from './civitai-types';
export { DEFAULT_MODEL_AIR } from './civitai-types';
