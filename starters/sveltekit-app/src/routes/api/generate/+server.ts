import { json } from '@sveltejs/kit';
import { submitGeneration, OrchestratorError, type GenerateInput } from '$lib/civitai';
import { readIdempotencyKey } from '$lib/submit-key';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) return json({ error: 'not_authenticated' }, { status: 401 });

  const body = (await request.json()) as GenerateInput;
  if (!body?.prompt || typeof body.prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }
  // A malformed key is refused, never rewritten (see `submit-key.ts`).
  const key = readIdempotencyKey(body);
  if (!key.ok) return json({ error: key.error }, { status: 400 });

  try {
    const snapshot = await submitGeneration(session, body, key.key);
    return json({ workflowId: snapshot.id, snapshot });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return json({ error: 'orchestrator_error', detail: err.body }, { status: err.status });
    }
    return json({ error: 'unknown' }, { status: 500 });
  }
};
