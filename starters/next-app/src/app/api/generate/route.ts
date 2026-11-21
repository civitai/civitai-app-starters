import { NextResponse, type NextRequest } from 'next/server';
import { submitGeneration, OrchestratorError, type GenerateInput } from '@/lib/civitai';
import { getSession } from '@/lib/session';
import { readIdempotencyKey } from '@/lib/submit-key';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const body = (await req.json()) as GenerateInput;
  if (!body?.prompt || typeof body.prompt !== 'string') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }
  // A missing or malformed key is refused, never rewritten (see `submit-key.ts`).
  const key = readIdempotencyKey(body);
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: 400 });

  try {
    const snapshot = await submitGeneration(session, body, key.key);
    return NextResponse.json({ workflowId: snapshot.id, snapshot });
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
