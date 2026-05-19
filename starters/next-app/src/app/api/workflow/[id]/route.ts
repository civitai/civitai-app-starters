import { NextResponse, type NextRequest } from 'next/server';
import { getWorkflowSnapshot, OrchestratorError } from '@/lib/civitai';
import { isTerminal } from '@/lib/civitai-types';
import { getSession } from '@/lib/session';

/**
 * Long-poll endpoint. `?wait=<ms>` (capped at MAX_WAIT_MS) holds the
 * connection open and re-checks the orchestrator every POLL_INTERVAL_MS
 * until the workflow reaches a terminal status, then returns. The client
 * just keeps re-hitting this until `done: true` — single endpoint, no
 * client-side timer.
 */

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 30_000; // stay under most proxy / Vercel function timeouts

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const waitRaw = Number(url.searchParams.get('wait') ?? 0);
  const waitMs = Number.isFinite(waitRaw) ? Math.min(Math.max(waitRaw, 0), MAX_WAIT_MS) : 0;
  const deadline = Date.now() + waitMs;

  try {
    let snapshot = await getWorkflowSnapshot(session, id);

    while (!isTerminal(snapshot) && Date.now() + POLL_INTERVAL_MS <= deadline) {
      if (req.signal?.aborted) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      snapshot = await getWorkflowSnapshot(session, id);
    }

    return NextResponse.json({ snapshot, done: isTerminal(snapshot) });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return NextResponse.json(
        { error: 'orchestrator_error', detail: err.detail },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: 'unknown' }, { status: 500 });
  }
}
