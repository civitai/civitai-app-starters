import 'server-only';
import { fetchMe } from '@civitai/app-sdk';
import {
  buildTextToImageBody,
  createOrchestratorClient,
  estimateWorkflow,
  getWorkflow,
  submitWorkflow,
  type GenerateInput,
  type OrchestratorClient,
  type WorkflowSnapshot,
} from '@civitai/app-sdk/orchestrator';
import { env } from './env';
import type { Session } from './session';

const STARTER_TAG = 'next-app';

function getClient(session: Session): OrchestratorClient {
  return createOrchestratorClient({
    accessToken: session.tokens.access_token,
    baseUrl: env.ORCHESTRATOR_URL,
  });
}

export interface MeResponse {
  id?: number;
  username?: string;
  /** Buzz balance from /api/v1/me. Civitai returns it under `balance` (number). */
  balance?: number;
  // The endpoint returns many more fields; widen as you use them.
  [key: string]: unknown;
}

export async function getMe(session: Session): Promise<MeResponse> {
  const data = await fetchMe({
    baseUrl: env.CIVITAI_BASE_URL,
    accessToken: session.tokens.access_token,
  });
  return data as MeResponse;
}

/** Preview Buzz cost without spending any (whatif=true). */
export function estimateGenerationCost(
  session: Session,
  input: GenerateInput,
): Promise<WorkflowSnapshot> {
  return estimateWorkflow(getClient(session), buildTextToImageBody(input, {
    tags: ['civitai-app-starter', STARTER_TAG],
  }));
}

/** Submit the workflow for real. Debits the user's Buzz. */
export function submitGeneration(
  session: Session,
  input: GenerateInput,
): Promise<WorkflowSnapshot> {
  return submitWorkflow(getClient(session), buildTextToImageBody(input, {
    tags: ['civitai-app-starter', STARTER_TAG],
  }));
}

export function getWorkflowSnapshot(
  session: Session,
  workflowId: string,
): Promise<WorkflowSnapshot> {
  return getWorkflow(getClient(session), workflowId);
}

export {
  DEFAULT_MODEL_AIR,
  extractImageUrls,
  isTerminal,
  OrchestratorError,
  type GenerateInput,
  type WorkflowSnapshot,
} from '@civitai/app-sdk/orchestrator';
