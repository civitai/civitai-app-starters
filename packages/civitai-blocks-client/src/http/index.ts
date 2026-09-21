import type { Session } from '../session/index.js';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | readonly QueryValue[]>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  /** The response body, parsed as JSON when it was JSON. */
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface HttpOptions {
  session: Session;
  baseUrl: string;
  fetch?: typeof fetch;
}

export type Http = <T>(method: string, path: string, opts?: RequestOptions) => Promise<T>;

/** A JSON client that sends the session's token and survives one expired token. */
export function createHttp(options: HttpOptions): Http {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  const send = (method: string, path: string, opts: RequestOptions, token: string) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    return doFetch(urlFor(baseUrl, path, opts.query), { method, headers, body, signal: opts.signal });
  };

  return async <T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> => {
    const { session } = options;
    let response = await send(method, path, opts, await session.getToken({ signal: opts.signal }));
    // One retry: a token that expired in flight is routine, a second refusal is not.
    if (response.status === 401) {
      const fresh = await session.getToken({ fresh: true, signal: opts.signal });
      response = await send(method, path, opts, fresh);
    }
    return read<T>(response);
  };
}

function urlFor(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(`${baseUrl}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item != null) url.searchParams.append(key, String(item));
    }
  }
  return url.toString();
}

async function read<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = text;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON; keep the text so an error can still say what came back.
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, messageOf(body) ?? response.statusText, body);
  }
  return (text === '' ? undefined : body) as T;
}

/** civitai reports `{ error }` or `{ message }`; the orchestrator reports problem details. */
function messageOf(body: unknown): string | undefined {
  if (body == null || typeof body !== 'object') return undefined;
  const fields = body as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail', 'title']) {
    if (typeof fields[key] === 'string') return fields[key];
  }
  return undefined;
}
