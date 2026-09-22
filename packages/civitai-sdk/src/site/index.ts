import type { Http, RequestOptions } from '../http/index.js';

export const DEFAULT_SITE_URL = 'https://civitai.com/api/v1';

/**
 * The public Civitai REST API. Routes are addressed by path, so a route the
 * API gains needs no release here.
 */
export interface SiteClient {
  get<T = unknown>(path: string, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  request<T = unknown>(method: string, path: string, opts?: RequestOptions): Promise<T>;
}

export function createSiteClient(http: Http): SiteClient {
  return {
    get: (path, opts) => http('GET', path, opts),
    post: (path, body, opts) => http('POST', path, { ...opts, body }),
    request: (method, path, opts) => http(method, path, opts),
  };
}
