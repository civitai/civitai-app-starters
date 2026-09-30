import { ApiError, isTerminal, type AppClient, type Workflow } from '@civitai/sdk';

import { ORCH_URL } from '../config.js';

export interface UploadedBlob {
  id: string;
  url?: string | null;
  type?: string;
  width?: number | null;
  height?: number | null;
  nsfwLevel?: string | null;
  blockedReason?: string | null;
}

interface SendOptions {
  body?: unknown;
  signal?: AbortSignal;
}

/** The consumer routes `@civitai/sdk` does not wrap; same token and 401-retry as the SDK. */
export interface ReadOptions extends SendOptions {
  hideMatureContent?: boolean;
}

export interface OrchestrationApi {
  getWorkflow(workflowId: string, opts?: ReadOptions & { wait?: number; until?: 'completion' | 'change' }): Promise<Workflow>;
  watchWorkflow(workflowId: string, opts?: ReadOptions): AsyncGenerator<Workflow, void, undefined>;
  updateWorkflow(workflowId: string, patch: { metadata?: unknown; tags?: string[] }, opts?: SendOptions): Promise<void>;
  addTag(workflowId: string, tag: string, opts?: SendOptions): Promise<void>;
  removeTag(workflowId: string, tag: string, opts?: SendOptions): Promise<void>;
  deleteWorkflow(workflowId: string, opts?: SendOptions): Promise<void>;
  presignUpload(opts?: SendOptions): Promise<{ uploadUrl: string; expiresAt?: string }>;
  uploadDirect(file: Blob, opts?: SendOptions): Promise<UploadedBlob>;
  refreshBlobUrl(blobId: string, opts?: SendOptions & { nsfwLevel?: string }): Promise<string>;
}

export function createOrchestrationApi(app: AppClient, baseUrl = ORCH_URL, doFetch: typeof fetch = fetch.bind(globalThis)): OrchestrationApi {
  const url = (path: string) => `${baseUrl}/${path}`;

  async function authed(input: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
    const attempt = async (fresh: boolean) => {
      const token = await app.getToken({ fresh, signal: init.signal });
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return doFetch(input, { ...init, headers });
    };
    const first = await attempt(false);
    return first.status === 401 ? attempt(true) : first;
  }

  async function json<T>(method: string, path: string, { body, signal }: SendOptions = {}): Promise<T> {
    const response = await authed(url(path), {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return read<T>(response);
  }

  const getWorkflow: OrchestrationApi['getWorkflow'] = (workflowId, { wait, until, hideMatureContent, signal } = {}) => {
    const query = new URLSearchParams();
    if (wait !== undefined) query.set('wait', String(wait));
    if (until !== undefined) query.set('until', until);
    if (hideMatureContent !== undefined) query.set('hideMatureContent', String(hideMatureContent));
    const suffix = query.size > 0 ? `?${query}` : '';
    return json('GET', `v2/consumer/workflows/${encodeURIComponent(workflowId)}${suffix}`, { signal });
  };

  // Mirrors @civitai/sdk's watchWorkflow, which cannot pass hideMatureContent.
  async function* watchWorkflow(workflowId: string, opts: ReadOptions = {}): AsyncGenerator<Workflow, void, undefined> {
    let seen: string | undefined;
    let failures = 0;
    let held = false;
    for (;;) {
      let workflow: Workflow;
      try {
        workflow = await getWorkflow(workflowId, held ? { ...opts, wait: HELD_READ_SECONDS, until: 'change' } : opts);
        failures = 0;
      } catch (error) {
        if (opts.signal?.aborted || !isTransient(error) || failures >= RETRY_BACKOFF_MS.length) throw error;
        await sleep(RETRY_BACKOFF_MS[failures++]!, opts.signal);
        continue;
      }
      held = true;
      const snapshot = JSON.stringify(workflow);
      if (snapshot !== seen) {
        seen = snapshot;
        yield workflow;
      }
      if (isTerminal(workflow)) return;
    }
  }

  return {
    getWorkflow,
    watchWorkflow,
    async updateWorkflow(workflowId, patch, opts) {
      await json('PUT', `v2/consumer/workflows/${encodeURIComponent(workflowId)}`, { ...opts, body: patch });
    },
    async addTag(workflowId, tag, opts) {
      await json('POST', `v2/consumer/workflows/${encodeURIComponent(workflowId)}/tags`, { ...opts, body: tag });
    },
    async removeTag(workflowId, tag, opts) {
      await json('DELETE', `v2/consumer/workflows/${encodeURIComponent(workflowId)}/tags/${encodeURIComponent(tag)}`, opts);
    },
    async deleteWorkflow(workflowId, opts) {
      await json('DELETE', `v2/consumer/workflows/${encodeURIComponent(workflowId)}`, opts);
    },
    presignUpload: (opts) => json('GET', 'v2/consumer/blobs/upload', opts),
    async uploadDirect(file, opts) {
      const response = await authed(url('v2/consumer/blobs'), {
        method: 'POST',
        signal: opts?.signal,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      return read<UploadedBlob>(response);
    },
    async refreshBlobUrl(blobId, opts = {}) {
      const query = opts.nsfwLevel ? `?nsfwLevel=${encodeURIComponent(opts.nsfwLevel)}` : '';
      const response = await authed(url(`v2/consumer/blobs/${encodeURIComponent(blobId)}${query}`), {
        method: 'GET',
        signal: opts.signal,
      });
      // Following the 308 is the only way to learn the fresh URL; the bytes are not wanted.
      void response.body?.cancel();
      if (!response.ok) throw new ApiError(response.status, response.statusText, undefined);
      return response.url;
    },
  };
}

const HELD_READ_SECONDS = 20;
const RETRY_BACKOFF_MS = [250, 1_000, 4_000];

function isTransient(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 429;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function read<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = text;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON; the text still says what went wrong.
    }
  }
  if (!response.ok) throw new ApiError(response.status, messageOf(body) ?? response.statusText, body);
  return (text === '' ? undefined : body) as T;
}

function messageOf(body: unknown): string | undefined {
  if (typeof body === 'string' && body.trim() !== '') return body;
  if (body == null || typeof body !== 'object') return undefined;
  const fields = body as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail', 'title']) {
    if (typeof fields[key] === 'string') return fields[key] as string;
  }
  return undefined;
}
