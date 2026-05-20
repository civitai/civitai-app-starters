/**
 * Orchestrator glue — types, constants, and fetch-based helpers shared by every
 * starter's BFF. Client + server safe: no Node-only imports, no `process.env`
 * access. All configuration flows through the `OrchestratorClient` value that
 * the caller builds.
 */

// ---------- Constants -------------------------------------------------------

export const DEFAULT_ORCHESTRATOR_BASE_URL = 'https://orchestration.civitai.com';

/** Default SDXL base model. Replace per starter / per call as needed. */
export const DEFAULT_MODEL_AIR = 'urn:air:sdxl:checkpoint:civitai:101055@128078';

/**
 * Terminal orchestrator statuses (lowercase — matches what the API returns).
 */
export const TERMINAL_STATUSES = ['succeeded', 'failed', 'expired', 'canceled'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

// ---------- Types -----------------------------------------------------------

/**
 * Orchestrator workflow status. Lowercase — matches what the orchestrator
 * actually returns. Forward-compat: open-ended string union so unknown
 * statuses don't break typing.
 */
export type WorkflowStatus =
  | 'unassigned'
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'canceled'
  | (string & {});

export interface GenerateInput {
  prompt: string;
  negativePrompt?: string;
  /** AIR URN, e.g. `urn:air:sdxl:checkpoint:civitai:101055@128078`. */
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  quantity?: number;
}

export interface WorkflowSnapshot {
  id: string;
  status: WorkflowStatus;
  cost?: { total?: number };
  steps?: Array<{
    output?: {
      /** Canonical image array. Each item has `url` + `available: boolean`. */
      images?: Array<{ url?: string; available?: boolean }>;
      /** Legacy/alternative — some workflow types still emit `blobs[]`. */
      blobs?: Array<{ url?: string; type?: string; mimeType?: string }>;
    };
  }>;
  [key: string]: unknown;
}

/**
 * Minimal orchestrator client config — just the base URL and the user's
 * access token. Build one with {@link createOrchestratorClient} and pass it
 * to the per-call helpers below.
 */
export interface OrchestratorClient {
  baseUrl: string;
  accessToken: string;
}

export class OrchestratorError extends Error {
  override readonly name = 'OrchestratorError';
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

// ---------- Client factory --------------------------------------------------

export interface CreateOrchestratorClientOptions {
  /** OAuth access token (or personal API key — same Bearer scheme). */
  accessToken: string;
  /** Orchestrator base URL. Defaults to Civitai's prod orchestrator. */
  baseUrl?: string;
}

export function createOrchestratorClient(
  opts: CreateOrchestratorClientOptions,
): OrchestratorClient {
  return {
    baseUrl: opts.baseUrl ?? DEFAULT_ORCHESTRATOR_BASE_URL,
    accessToken: opts.accessToken,
  };
}

// ---------- Raw HTTP --------------------------------------------------------

/**
 * Internal raw-fetch helper. Logs the failing response to console.error and
 * throws {@link OrchestratorError} on non-2xx. Exported so callers can build
 * their own orchestrator routes without duplicating this code.
 */
export async function callOrchestrator(
  client: OrchestratorClient,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const { headers, ...rest } = init;
  const res = await fetch(`${client.baseUrl}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${client.accessToken}`,
      ...headers,
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    console.error(
      `[orchestrator] ${init.method ?? 'GET'} ${path} -> ${res.status} ${res.statusText}\n` +
        `  raw body: ${text.length ? text.slice(0, 500) : '(empty)'}`,
    );
    throw new OrchestratorError(`HTTP ${res.status}`, res.status, body);
  }
  return body;
}

// ---------- Workflow body builder ------------------------------------------

export interface BuildTextToImageBodyOptions {
  /** Optional workflow tags — useful for attribution / debugging. */
  tags?: string[];
}

/**
 * Build a `textToImage` workflow body from a {@link GenerateInput}. Mirrors
 * the shape every starter's existing `buildWorkflowBody` produced.
 */
export function buildTextToImageBody(
  input: GenerateInput,
  opts: BuildTextToImageBodyOptions = {},
): unknown {
  const body: { tags?: string[]; steps: unknown[] } = {
    steps: [
      {
        $type: 'textToImage' as const,
        name: 'step_0',
        timeout: '00:10:00',
        input: {
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          model: input.model ?? DEFAULT_MODEL_AIR,
          width: input.width ?? 1024,
          height: input.height ?? 1024,
          steps: input.steps ?? 25,
          cfgScale: input.cfgScale ?? 5,
          seed: input.seed,
          quantity: input.quantity ?? 1,
        },
      },
    ],
  };
  if (opts.tags && opts.tags.length > 0) body.tags = opts.tags;
  return body;
}

// ---------- Workflow endpoints ---------------------------------------------

/**
 * Cost preview ("what if") — runs the workflow validation/pricing pipeline
 * without committing any Buzz.
 */
export function estimateWorkflow(
  client: OrchestratorClient,
  body: unknown,
): Promise<WorkflowSnapshot> {
  return callOrchestrator(client, '/v2/consumer/workflows?whatif=true', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<WorkflowSnapshot>;
}

/** Submit a workflow for real execution. Debits the token-owner's Buzz. */
export function submitWorkflow(
  client: OrchestratorClient,
  body: unknown,
): Promise<WorkflowSnapshot> {
  return callOrchestrator(client, '/v2/consumer/workflows', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<WorkflowSnapshot>;
}

export function getWorkflow(
  client: OrchestratorClient,
  workflowId: string,
): Promise<WorkflowSnapshot> {
  return callOrchestrator(
    client,
    `/v2/consumer/workflows/${encodeURIComponent(workflowId)}`,
    { method: 'GET' },
  ) as Promise<WorkflowSnapshot>;
}

// ---------- Polling ---------------------------------------------------------

export interface PollWorkflowOptions {
  /** Polling interval in ms. Default 1000. */
  intervalMs?: number;
  /** Max total time to poll in ms. Default 30000. */
  timeoutMs?: number;
  /** Optional abort signal — checked between ticks. */
  signal?: AbortSignal;
}

/**
 * Server-side long-poll helper. Re-fetches the workflow every `intervalMs`
 * until it reaches a terminal status, the timeout elapses, or the signal
 * aborts. Returns the latest snapshot regardless of which condition tripped —
 * callers inspect {@link isTerminal} on the result to decide what to do.
 */
export async function pollWorkflow(
  client: OrchestratorClient,
  workflowId: string,
  opts: PollWorkflowOptions = {},
): Promise<WorkflowSnapshot> {
  const interval = opts.intervalMs ?? 1000;
  const timeout = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeout;

  let snapshot = await getWorkflow(client, workflowId);
  while (!isTerminal(snapshot) && Date.now() + interval <= deadline) {
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, interval));
    snapshot = await getWorkflow(client, workflowId);
  }
  return snapshot;
}

// ---------- Snapshot inspection --------------------------------------------

export function isTerminal(snap: WorkflowSnapshot | null | undefined): boolean {
  if (!snap?.status) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(String(snap.status));
}

/** Pull every available image URL out of a workflow snapshot. */
export function extractImageUrls(snap: WorkflowSnapshot | null | undefined): string[] {
  if (!snap?.steps) return [];
  const out: string[] = [];
  for (const step of snap.steps) {
    for (const img of step.output?.images ?? []) {
      if (img.available && img.url) out.push(img.url);
    }
    for (const blob of step.output?.blobs ?? []) {
      if (blob.url && (blob.mimeType ?? blob.type ?? '').startsWith('image/')) {
        out.push(blob.url);
      }
    }
  }
  return out;
}
