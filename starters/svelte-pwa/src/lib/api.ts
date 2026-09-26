import type { GenerateInput, WorkflowSnapshot } from '@civitai/app-sdk/orchestrator';

/**
 * What `GET /api/me` hands the SPA.
 *
 * `balance` is `null` when the BFF could not read it — `BuzzRead` is optional
 * at OAuth consent and `buzz.getUserAccount` answers 403 without it. It does
 * NOT come from `/api/v1/me`, which returns no balance at all; the BFF reads
 * it separately via `getBuzzBalance()`. Render nothing when it is nullish —
 * a dash is what the pre-fix bug looked like.
 */
export interface Me {
  authenticated: boolean;
  username?: string;
  balance?: number | null;
  grantedScopes?: string[];
  error?: string;
}

export async function getMe(): Promise<Me> {
  const res = await fetch('/api/me');
  if (res.status === 401) return { authenticated: false };
  return (await res.json()) as Me;
}

export async function estimateCost(input: GenerateInput): Promise<{ cost: number }> {
  const res = await fetch('/api/generate/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

export async function submitGeneration(
  input: GenerateInput,
): Promise<{ workflowId: string; snapshot: WorkflowSnapshot }> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

/**
 * Long-poll a workflow. `waitMs` tells the BFF how long to hold the
 * connection open while it watches for a terminal status; the BFF caps it
 * server-side. Returns `{ snapshot, done }` — `done: true` when terminal.
 * Callers loop on `done === false` until cumulative timeout or terminal.
 */
export async function getWorkflow(
  id: string,
  waitMs = 25_000,
  signal?: AbortSignal,
): Promise<{ snapshot: WorkflowSnapshot; done: boolean }> {
  const res = await fetch(`/api/workflow/${encodeURIComponent(id)}?wait=${waitMs}`, { signal });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function revoke(): Promise<void> {
  await fetch('/api/auth/revoke', { method: 'POST' });
}
