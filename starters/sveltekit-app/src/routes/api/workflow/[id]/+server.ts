import { json } from '@sveltejs/kit';
import { getWorkflowSnapshot, OrchestratorError } from '$lib/civitai';
import { isTerminal } from '$lib/civitai-types';
import type { RequestHandler } from './$types';

/**
 * Long-poll endpoint. `?wait=<ms>` (capped at MAX_WAIT_MS) holds the
 * connection open and re-checks the orchestrator every POLL_INTERVAL_MS
 * until the workflow reaches a terminal status, then returns.
 */

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 30_000;

export const GET: RequestHandler = async ({ params, url, locals, request }) => {
  const session = locals.session;
  if (!session) return json({ error: 'not_authenticated' }, { status: 401 });

  const waitRaw = Number(url.searchParams.get('wait') ?? 0);
  const waitMs = Number.isFinite(waitRaw) ? Math.min(Math.max(waitRaw, 0), MAX_WAIT_MS) : 0;
  const deadline = Date.now() + waitMs;

  try {
    let snapshot = await getWorkflowSnapshot(session, params.id);

    while (!isTerminal(snapshot) && Date.now() + POLL_INTERVAL_MS <= deadline) {
      if (request.signal?.aborted) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      snapshot = await getWorkflowSnapshot(session, params.id);
    }

    return json({ snapshot, done: isTerminal(snapshot) });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return json({ error: 'orchestrator_error', detail: err.detail }, { status: err.status });
    }
    return json({ error: 'unknown' }, { status: 500 });
  }
};
