import { NextResponse, type NextRequest } from 'next/server';
import { estimateGenerationCost, OrchestratorError, type GenerateInput } from '@/lib/civitai';
import { estimateResponseBody } from '@/lib/estimate';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const body = (await req.json()) as GenerateInput;
  if (!body?.prompt || typeof body.prompt !== 'string') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  try {
    const snapshot = await estimateGenerationCost(session, body);
    // `cost` is null when the snapshot carries no numeric `cost.total` — never
    // a made-up 0 (see `costOrNull`).
    return NextResponse.json(estimateResponseBody(snapshot));
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return NextResponse.json(
        { error: 'orchestrator_error', detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: 'unknown' }, { status: 500 });
  }
}
