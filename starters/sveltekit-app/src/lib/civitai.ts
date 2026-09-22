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

/**
 * The projection of `/api/v1/me` this app is allowed to hold — and therefore the
 * most it can ever leak.
 *
 * 🔴 CLOSED ON PURPOSE: NO `[key: string]: unknown` INDEX SIGNATURE. SvelteKit
 * serialises whatever a `load` function returns straight into the SSR payload
 * embedded in the delivered HTML, so anything reachable from here is public to
 * whoever can read the page — including fields the app never renders. With an
 * index signature that is invisible: neither a reader nor `tsc` can tell you
 * what actually ships, because the type admits everything upstream returns.
 *
 * Widening this is a SECURITY DECISION, not a typing convenience. Add a field
 * only when a component renders it, and project it in {@link getMe} in the same
 * edit — the type is what makes the review possible.
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
 * `/api/v1/me` returns far more than this — every future route, endpoint and
 * `load` function in this app now structurally cannot forward a field nobody
 * asked for, because the unprojected upstream object does not exist past this
 * function. Projecting in `+page.server.ts` instead would have fixed exactly one
 * route and left the same defect one file away.
 *
 * A `as MeResponse` CAST would not do this: a cast renames the object, it does
 * not rebuild it, so every upstream field would still be there at runtime and
 * still be serialised.
 */
export async function getMe(session: Session): Promise<MeResponse> {
  const raw = (await fetchMe({
    baseUrl: config.CIVITAI_BASE_URL,
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
