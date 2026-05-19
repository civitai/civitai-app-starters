import { json } from '@sveltejs/kit';
import { submitGeneration, OrchestratorError, type GenerateInput } from '$lib/civitai';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) return json({ error: 'not_authenticated' }, { status: 401 });

  const body = (await request.json()) as GenerateInput;
  if (!body?.prompt || typeof body.prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }

  try {
    const snapshot = await submitGeneration(session, body);
    return json({ workflowId: snapshot.id, snapshot });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return json({ error: 'orchestrator_error', detail: err.detail }, { status: err.status });
    }
    return json({ error: 'unknown' }, { status: 500 });
  }
};
