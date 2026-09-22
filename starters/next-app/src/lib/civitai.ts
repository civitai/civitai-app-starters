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

/**
 * The projection of `/api/v1/me` this app is allowed to hold — and therefore the
 * most it can ever leak.
 *
 * 🔴 CLOSED ON PURPOSE: NO `[key: string]: unknown` INDEX SIGNATURE. This object
 * is built in a Server Component; the moment any route, Server Action or client
 * component forwards it, every field on it crosses to the browser. With an index
 * signature that is invisible — neither a reader nor `tsc` can tell you what
 * ships, because the type admits everything upstream returns.
 *
 * `/api/v1/me` returns much more than this, including `email` and
 * `emailVerified` (every OAuth token carries the `UserRead` baseline scope). If
 * you need one, add the field HERE and pick it in {@link getMe} in the same
 * edit — widening this is a security decision, and the type is what makes it
 * reviewable.
 *
 * Enforced structurally by `tests/guards/starter-me-projection.test.mjs`.
 */
export interface MeResponse {
  username?: string;
  /** Buzz balance from /api/v1/me. Civitai returns it under `balance` (number). */
  balance?: number;
}

/**
 * Fetch the signed-in user's profile and PROJECT it down to the two fields this
 * starter renders (`username` in the header, `balance` in the Buzz preview).
 *
 * 🔴 THE PROJECTION IS THE POINT, AND IT LIVES HERE RATHER THAN AT THE CALL
 * SITE. Every future route and component in this app now structurally cannot
 * forward a field nobody asked for, because the unprojected upstream object does
 * not exist past this function. A `as MeResponse` CAST would not do this: a cast
 * renames the object, it does not rebuild it, so every upstream field would
 * still be there at runtime.
 */
export async function getMe(session: Session): Promise<MeResponse> {
  const raw = (await fetchMe({
    baseUrl: env.CIVITAI_BASE_URL,
    accessToken: session.tokens.access_token,
  })) as Record<string, unknown> | null;

  return {
    username: typeof raw?.username === 'string' ? raw.username : undefined,
    balance: typeof raw?.balance === 'number' ? raw.balance : undefined,
  };
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
