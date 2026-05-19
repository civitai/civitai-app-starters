import { createCivitaiClient } from '@civitai/client';

/** The orchestrator client returned by `createCivitaiClient`. */
export type CivitaiClient = ReturnType<typeof createCivitaiClient>;

export interface CreateAppClientOptions {
  /** OAuth access token or personal API key. Used as Bearer credential. */
  token: string;
  /** Orchestrator base URL. Defaults to Civitai's prod orchestrator. */
  baseUrl?: string;
  /** SDK env mode. Defaults to 'prod'. */
  env?: 'dev' | 'prod';
}

const DEFAULT_ORCHESTRATOR_BASE_URL = 'https://orchestration.civitai.com';

/**
 * Create a typed Civitai orchestrator client authenticated with the user's
 * OAuth access token (or a personal API key — same Bearer scheme).
 *
 * Wraps `@civitai/client`'s factory with sensible defaults. The returned
 * client is the same shape `@civitai/client` produces — pass it to the
 * SDK's standalone functions (`submitWorkflow({ client, body })`, etc.)
 * or to the wrappers in `@civitai/app-sdk/workflows`.
 */
export function createAppClient(opts: CreateAppClientOptions): CivitaiClient {
  return createCivitaiClient({
    baseUrl: opts.baseUrl ?? DEFAULT_ORCHESTRATOR_BASE_URL,
    env: opts.env ?? 'prod',
    auth: opts.token,
  });
}

export type AppClient = CivitaiClient;
