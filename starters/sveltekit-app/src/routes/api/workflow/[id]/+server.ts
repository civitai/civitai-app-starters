import { json } from '@sveltejs/kit';
import {
  createOrchestratorClient,
  isTerminal,
  OrchestratorError,
  pollWorkflow,
} from '@civitai/app-sdk/orchestrator';
import { config } from '$lib/env';
import type { RequestHandler } from './$types';

/**
 * Long-poll endpoint. `?wait=<ms>` (capped at MAX_WAIT_MS) holds the
 * connection open and re-checks the orchestrator until the workflow reaches
 * a terminal status, then returns.
 */

const MAX_WAIT_MS = 30_000;

export const GET: RequestHandler = async ({ params, url, locals, request }) => {
  const session = locals.session;
  if (!session) return json({ error: 'not_authenticated' }, { status: 401 });

  const waitRaw = Number(url.searchParams.get('wait') ?? 0);
  const waitMs = Number.isFinite(waitRaw) ? Math.min(Math.max(waitRaw, 0), MAX_WAIT_MS) : 0;

  const client = createOrchestratorClient({
    accessToken: session.tokens.access_token,
    baseUrl: config.ORCHESTRATOR_URL,
  });

  try {
    const snapshot = await pollWorkflow(client, params.id, {
      timeoutMs: waitMs,
      signal: request.signal,
    });
    return json({ snapshot, done: isTerminal(snapshot) });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return json({ error: 'orchestrator_error', detail: err.body }, { status: err.status });
    }
    return json({ error: 'unknown' }, { status: 500 });
  }
};
