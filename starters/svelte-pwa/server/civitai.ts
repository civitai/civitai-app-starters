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
import { env } from './env.js';
import type { Session } from './session.js';

const STARTER_TAG = 'svelte-pwa';

function getClient(session: Session): OrchestratorClient {
  return createOrchestratorClient({
    accessToken: session.tokens.access_token,
    baseUrl: env.ORCHESTRATOR_URL,
  });
}

/**
 * The projection of `/api/v1/me` this BFF is allowed to hold — and therefore the
 * most it can ever hand to the SPA.
 *
 * 🔴 CLOSED ON PURPOSE: NO `[key: string]: unknown` INDEX SIGNATURE. `GET
 * /api/me` in `server/app.ts` picks two fields off this today, but an index
 * signature makes the object's real contents invisible to both a reader and
 * `tsc` — so the day a route returns `me` wholesale, nothing says what crossed
 * to the browser. `/api/v1/me` returns much more than this, including `email`
 * (every OAuth token carries the `UserRead` baseline scope).
 *
 * Widening this is a SECURITY DECISION, not a typing convenience: add a field
 * only when the SPA renders it, and pick it in {@link getMe} in the same edit.
 *
 * Enforced structurally by `tests/guards/starter-me-projection.test.mjs`.
 */
export interface MeResponse {
  username?: string;
  balance?: number;
}

/**
 * Fetch the signed-in user's profile and PROJECT it down to the two fields this
 * starter renders (`username` in the header, `balance` in the Buzz preview).
 *
 * 🔴 THE PROJECTION IS THE POINT, AND IT LIVES HERE RATHER THAN IN THE ROUTE.
 * `server/app.ts` already picks `username`/`balance` out for `GET /api/me`, but
 * that protects exactly one route; projecting at the fetch boundary means the
 * unprojected upstream object does not exist past this function, so no future
 * route can forward a field nobody asked for. A `as MeResponse` CAST would not
 * do this: a cast renames the object, it does not rebuild it, so every upstream
 * field would still be there at runtime.
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
