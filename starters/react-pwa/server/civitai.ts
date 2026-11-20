import { fetchBuzzAccount, fetchMe } from '@civitai/app-sdk';
import { hasScope, TokenScope } from '@civitai/app-sdk/scopes';
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

const STARTER_TAG = 'react-pwa';

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
 * 🔴 THERE IS NO `balance` HERE, AND THERE NEVER CAN BE. `/api/v1/me` does not
 * return one — see {@link getBuzzBalance}.
 *
 * Enforced structurally by `tests/guards/starter-me-projection.test.mjs`.
 */
export interface MeResponse {
  username?: string;
}

/**
 * Fetch the signed-in user's profile and PROJECT it down to the one field this
 * starter renders from it (`username`, in the header).
 *
 * 🔴 THE PROJECTION IS THE POINT, AND IT LIVES HERE RATHER THAN IN THE ROUTE.
 * `server/app.ts` already picks `username` out for `GET /api/me`, but
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
  };
}

/**
 * The signed-in user's spendable Buzz — or `null` when this app cannot read it.
 *
 * 🔴 BALANCE DOES NOT COME FROM `/api/v1/me`, AND NEVER HAS. That endpoint
 * sends `id, username, tier, status, isMember, subscriptions`, plus
 * conditionally `isModerator`, `email`/`emailVerified` and the token-only
 * `tokenScope`/`buzzLimit`/`subject` (civitai/civitai
 * `src/pages/api/v1/me.ts`). Reading `balance` off it yields `undefined`, which
 * is exactly how every starter used to render `Buzz balance: —`.
 *
 * 🔴 `buzzLimit` IS NOT A BALANCE. It is the per-token SPEND CAP chosen at
 * OAuth consent. Rendering it under a balance label is the same defect wearing
 * a different field name.
 *
 * The real value lives behind the `buzz.getUserAccount` tRPC procedure, which
 * `.meta({ requiredScope: TokenScope.BuzzRead })` (civitai/civitai
 * `src/server/routers/buzz.router.ts:42`). With no `accountTypes` input its
 * handler returns EXACTLY ONE entry — the default account, labelled `yellow`
 * (`src/server/services/buzz.service.ts:158`) — so this reads that entry
 * rather than inventing a sum over pools that the route does not return.
 *
 * 🔴 `null` IS AN EXPECTED OUTCOME, NOT AN ERROR PATH. `BuzzRead` is optional
 * at consent and is not guaranteed to a third-party client, and the procedure
 * answers 403 without it. The caller must HIDE the balance row — never render
 * a dash, never show an error banner, never throw. Everything else this
 * starter does works without a balance.
 *
 * Must run SERVER-SIDE: `/api/trpc/[trpc].ts` sets no CORS headers, so a
 * browser fetch to it cannot succeed even with a valid token.
 */
export async function getBuzzBalance(session: Session): Promise<number | null> {
  // Without the scope the request can only 403 — don't spend a round trip on it.
  if (!hasScope(session.tokens.scope, TokenScope.BuzzRead)) return null;
  try {
    const accounts = await fetchBuzzAccount({
      baseUrl: env.CIVITAI_BASE_URL,
      accessToken: session.tokens.access_token,
    });
    // An EMPTY array is "could not read it", not "zero Buzz". A tRPC error
    // envelope can arrive with HTTP 200, and `fetchBuzzAccount` unwraps that to
    // `[]` — rendering `0` there would be a confident wrong number.
    const account = accounts.find((a) => a.accountType === 'yellow') ?? accounts[0];
    return typeof account?.balance === 'number' ? account.balance : null;
  } catch {
    // 403 (scope not granted) is the expected case. Network/5xx degrade the
    // same way on purpose: the balance is decorative and the page must render.
    return null;
  }
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
