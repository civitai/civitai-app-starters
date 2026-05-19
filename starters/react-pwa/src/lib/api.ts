import type { GenerateInput, WorkflowSnapshot } from './civitai-types';

export interface Me {
  authenticated: boolean;
  username?: string;
  balance?: number;
  grantedScopes?: string[];
  error?: string;
}

export async function getMe(): Promise<Me> {
  const res = await fetch('/api/me');
  if (res.status === 401) return { authenticated: false };
  const json = (await res.json()) as Me;
  return json;
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
