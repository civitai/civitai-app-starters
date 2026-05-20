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
import { config } from './env';
import type { Session } from './session';

const STARTER_TAG = 'sveltekit-app';

function getClient(session: Session): OrchestratorClient {
  return createOrchestratorClient({
    accessToken: session.tokens.access_token,
    baseUrl: config.ORCHESTRATOR_URL,
  });
}

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

export function estimateGenerationCost(
  session: Session,
  input: GenerateInput,
): Promise<WorkflowSnapshot> {
  return estimateWorkflow(
    getClient(session),
    buildTextToImageBody(input, { tags: ['civitai-app-starter', STARTER_TAG] }),
  );
}

export function submitGeneration(
  session: Session,
  input: GenerateInput,
): Promise<WorkflowSnapshot> {
  return submitWorkflow(
    getClient(session),
    buildTextToImageBody(input, { tags: ['civitai-app-starter', STARTER_TAG] }),
  );
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
