import { BridgeError, CivitaiError } from '../core/errors.js';
import { getTransport } from '../core/get-transport.js';
import type { BlockContext, BlockSettings, Theme, ViewerInfo } from '../core/handshake.js';
import type { BlockTransport } from '../core/transport.js';
import { createHost, createHostSession, type Host } from '../host/index.js';
import { createHttp } from '../http/index.js';
import {
  createOrchestrationClient,
  DEFAULT_ORCHESTRATION_URL,
  type OrchestrationClient,
} from '../orchestration/index.js';
import {
  createTokenSession,
  type GrantOptions,
  type Scope,
  type Session,
  type TokenOptions,
  type TokenSessionOptions,
} from '../session/index.js';
import { createSiteClient, DEFAULT_SITE_URL, type SiteClient } from '../site/index.js';
import { createStorageClient, type StorageClient } from '../storage/index.js';

/** Long enough for a slow host page; short enough that a block opened on its own says so. */
const DEFAULT_INIT_TIMEOUT_MS = 10_000;

export interface AppClient {
  /** The public Civitai REST API (`/api/v1`), as the viewer. */
  readonly site: SiteClient;
  /**
   * The viewer's own per-app key/value store.
   *
   * 🔴 Requires the block token the host mints: an app that authenticated with
   * an OAuth access token has no per-viewer app storage, and every call here is
   * refused. An anonymous viewer is refused too — gate on `viewer` rather than
   * reading an empty result as "nothing stored".
   */
  readonly storage: StorageClient;
  /** The orchestrator's workflows, as the viewer. */
  readonly orchestration: OrchestrationClient;
  /** Asks for more scopes. `false` when they cannot be granted — a refusal is an answer. */
  requestGrants(scopes: readonly Scope[], opts?: GrantOptions): Promise<boolean>;
  /** For a call this client does not make itself. */
  getToken(opts?: TokenOptions): Promise<string>;
}

/** An app running as a block inside a civitai.com page. */
export interface BlockAppClient extends AppClient {
  readonly host: Host;
  /** `null` for an anonymous viewer. */
  readonly viewer: ViewerInfo | null;
  readonly context: BlockContext;
  readonly settings: BlockSettings;
  readonly theme: Theme;
  /** Fires when anything above changes, e.g. the viewer switches theme. */
  onChange(listener: () => void): () => void;
}

interface ClientOptions {
  /** Defaults to `https://civitai.com/api/v1`. */
  siteUrl?: string;
  /** Defaults to `https://orchestration.civitai.com`. */
  orchestrationUrl?: string;
  fetch?: typeof fetch;
}

export interface BlockInitializeOptions extends ClientOptions {
  /** How long to wait for the host before rejecting. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Replaces the page's own bridge, e.g. with `createFakeTransport()` in a test. */
  transport?: BlockTransport;
}

export interface TokenInitializeOptions extends ClientOptions, TokenSessionOptions {}

/**
 * Starts the app. Inside a civitai.com page it waits for the host to hand over
 * the viewer, the slot and a token; given a token, it is ready at once.
 */
export function initialize(options?: BlockInitializeOptions): Promise<BlockAppClient>;
export function initialize(options: TokenInitializeOptions): Promise<AppClient>;
export async function initialize(
  options: BlockInitializeOptions | TokenInitializeOptions = {},
): Promise<AppClient | BlockAppClient> {
  if ('token' in options) return createAppClient(createTokenSession(options), options);

  const transport = options.transport ?? getTransport();
  await ready(transport, options.timeoutMs ?? DEFAULT_INIT_TIMEOUT_MS, options.signal);

  const snapshot = () => transport.snapshot.get();
  if (snapshot().viewer !== null && snapshot().token.kind === 'block') {
    throw new CivitaiError(
      'This block receives a block-scoped token, which the Civitai API and the orchestrator ' +
        'do not accept. Declare `auth: "oauth"` in block.manifest.json to use @civitai/sdk.',
    );
  }
  return {
    ...createAppClient(createHostSession(transport), options),
    host: createHost(transport),
    get viewer() {
      return snapshot().viewer;
    },
    get context() {
      return snapshot().context;
    },
    get settings() {
      return snapshot().settings;
    },
    get theme() {
      return snapshot().theme;
    },
    onChange: (listener) => transport.snapshot.subscribe(listener),
  };
}

function createAppClient(session: Session, options: ClientOptions): AppClient {
  const http = (baseUrl: string) => createHttp({ session, baseUrl, fetch: options.fetch });
  // One instance for both site-hosted surfaces: `storage`'s routes live under
  // the same base URL, so a `siteUrl` override redirects them together.
  const siteHttp = http(options.siteUrl ?? DEFAULT_SITE_URL);
  return {
    site: createSiteClient(siteHttp),
    storage: createStorageClient(siteHttp),
    orchestration: createOrchestrationClient(http(options.orchestrationUrl ?? DEFAULT_ORCHESTRATION_URL)),
    requestGrants: (scopes, opts) => session.requestGrants(scopes, opts),
    getToken: (opts) => session.getToken(opts),
  };
}

function ready(transport: BlockTransport, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (transport.snapshot.get().ready) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise<void>((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      off();
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(signal!.reason));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new BridgeError(
              'unavailable',
              'BLOCK_INIT',
              `No Civitai host responded within ${timeoutMs}ms. Outside a civitai.com page, ` +
                'pass a token: initialize({ token }).',
            ),
          ),
        ),
      timeoutMs,
    );
    const off = transport.snapshot.subscribe(() => {
      if (transport.snapshot.get().ready) finish(resolve);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
