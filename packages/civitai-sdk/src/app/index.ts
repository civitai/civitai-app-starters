import { BridgeError, CivitaiError } from '../core/errors.js';
import { getTransport } from '../core/get-transport.js';
import type { BlockContext, BlockSettings, Theme, ViewerInfo } from '../core/handshake.js';
import type { BlockSnapshot, BlockTransport } from '../core/transport.js';
import { createHost, createHostSession, type Host } from '../host/index.js';
import { ApiError, createHttp, type Http } from '../http/index.js';
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
  /**
   * The public Civitai REST API (`/api/v1`), as the viewer.
   *
   * Routes are addressed by path, so this client cannot know in advance which
   * ones an app will call. A block holding the block-scoped token reaches the
   * `blocks/*` routes it was minted for plus `GET models/{id}`; anywhere else
   * the API refuses it, and the refusal carries the manifest fix — see
   * {@link BlockInitializeOptions.requireOAuthToken} to fail at startup instead.
   */
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
  /**
   * The orchestrator's workflows, as the viewer.
   *
   * 🔴 The orchestrator accepts no block-scoped token on any route, so unlike
   * {@link AppClient.site} this destination IS known ahead of the call: a block
   * holding one is refused here up front, with the manifest fix, rather than
   * spending a request to be told.
   */
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
  /**
   * Refuse to start at all unless a signed-in viewer's token is an OAuth access
   * token, naming the `auth: "oauth"` manifest opt-in. For a block whose FIRST
   * screen already needs a surface the block-scoped token cannot serve, so that
   * "misconfigured" surfaces once at startup rather than as a refusal per call.
   *
   * 🔴 Do not set it as a precaution. The host's OAuth mint is flag-gated and
   * the flag defaults OFF, so wherever it is off this makes the block fail to
   * load for every signed-in viewer — including a block that only ever calls
   * `storage` or a `blocks/*` route, which the block token serves and an OAuth
   * token does not. Anonymous viewers are unaffected: no OAuth token is minted
   * for one whatever the manifest says, so the manifest is not their fix.
   */
  requireOAuthToken?: boolean;
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
  const holdsBlockTokenNow = holdsBlockToken(snapshot);
  if (options.requireOAuthToken === true && holdsBlockTokenNow()) {
    throw new CivitaiError(
      'This block receives a block-scoped token, not the OAuth access token it asked to ' +
        'require. Declare `auth: "oauth"` in block.manifest.json; if it already does, the ' +
        "host's OAuth mint is not enabled for it yet.",
    );
  }
  return {
    ...createAppClient(createHostSession(transport), options, holdsBlockTokenNow),
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

/**
 * 🔴 THE ONE PREDICATE, AND ITS EXACT SCOPE. A signed-in viewer whose token is
 * the block JWT: the case where an OAuth access token exists in principle — the
 * host mints one only for a signed-in viewer, and only when the manifest asks —
 * but this block does not hold it.
 *
 * Both halves are load-bearing and neither may be widened:
 *
 * - `viewer === null` — an anonymous viewer gets no OAuth token whatever the
 *   manifest says, so naming the manifest would send them at the wrong fix
 *   (theirs is `host.requestSignIn()`). It is also a frozen wire field.
 * - `kind !== 'block'` — `kind` is optional, and a host predating it sends none.
 *   An absent `kind` is not evidence of a block token, so it must read as "not
 *   this failure" and behave exactly as it did before `kind` existed.
 *
 * It is read live, not captured: the host rotates the token, and an opt-in block
 * on a host whose flag is flipped on gets an `oauth` token on the next refresh.
 */
const holdsBlockToken = (snapshot: () => BlockSnapshot) => () =>
  snapshot().viewer !== null && snapshot().token.kind === 'block';

/** The fix, spelled once, so every surface names the same thing. */
const OAUTH_OPT_IN = 'declare `auth: "oauth"` in block.manifest.json';

/**
 * Paths the block-scoped token was minted for. A refusal there is not about the
 * token's KIND — app storage, for one, is refused to an OAuth token and served
 * only to a block token — so the manifest advice must not be attached to it.
 *
 * This is the token's own namespace prefix, not a copy of the server's route
 * table: the 35-odd `withBlockScope` routes are the server's to change, and a
 * list of them here would be the thing that drifts.
 */
const BLOCK_NAMESPACE = /^\/*blocks\//;

function createAppClient(
  session: Session,
  options: ClientOptions,
  holdsBlockTokenNow: () => boolean = () => false,
): AppClient {
  const http = (baseUrl: string) => createHttp({ session, baseUrl, fetch: options.fetch });
  // One instance for both site-hosted surfaces: `storage`'s routes live under
  // the same base URL, so a `siteUrl` override redirects them together.
  // Wrapped once, so `BLOCK_NAMESPACE` is the single place that decides where the
  // diagnosis applies. `storage` needs no exemption of its own: every one of its
  // routes is `blocks/app-storage/*`, which that namespace already excludes, and
  // `test/storage/seam.test.ts` pins its `BASE` there textually.
  const siteHttp = explainApiRefusal(http(options.siteUrl ?? DEFAULT_SITE_URL), holdsBlockTokenNow);
  return {
    site: createSiteClient(siteHttp),
    storage: createStorageClient(siteHttp),
    orchestration: createOrchestrationClient(
      refuseBlockToken(http(options.orchestrationUrl ?? DEFAULT_ORCHESTRATION_URL), holdsBlockTokenNow),
    ),
    requestGrants: (scopes, opts) => session.requestGrants(scopes, opts),
    getToken: (opts) => session.getToken(opts),
  };
}

/**
 * The orchestrator, which accepts a block-scoped token on no route at all. That
 * makes this the one destination the SDK can judge without making the call, so
 * it refuses eagerly — before any request — rather than letting a 401 stand in
 * for a configuration problem.
 */
function refuseBlockToken(http: Http, holdsBlockTokenNow: () => boolean): Http {
  return (method, path, opts) =>
    holdsBlockTokenNow()
      ? Promise.reject(
          new CivitaiError(
            'The orchestrator does not accept a block-scoped token, and this block holds one. ' +
              `To run workflows as the viewer, ${OAUTH_OPT_IN} so the host mints an OAuth ` +
              'access token; the block token reaches the `blocks/*` API routes and app storage only.',
          ),
        )
      : http(method, path, opts);
}

/**
 * `/api/v1`, where the SDK cannot know the destination: {@link SiteClient} is
 * `get`/`post`/`request` over a base URL, so the route is the caller's string
 * and a route the API gains needs no release here. Predicting it is therefore
 * out of the question — but EXPLAINING a refusal is not, and that keeps the
 * diagnosis the old eager guard existed for at the call that actually needed it.
 *
 * ⚠ It cannot catch every case, and does not pretend to: a PUBLIC route such as
 * `images` ignores an unusable token and answers ANONYMOUSLY instead of
 * refusing. Nothing observable at this seam distinguishes that from a successful
 * authenticated read, so a block that must act as the viewer should prefer the
 * `blocks/*` twin or set `requireOAuthToken`.
 */
function explainApiRefusal(http: Http, holdsBlockTokenNow: () => boolean): Http {
  return async (method, path, opts) => {
    try {
      return await http(method, path, opts);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403) &&
        !BLOCK_NAMESPACE.test(path) &&
        holdsBlockTokenNow()
      ) {
        // Appended to the error already thrown, rather than replacing it: a
        // caller branches on `status` and reads `body` (`ApiError` is public and
        // documented for exactly that), and re-wrapping would drop the stack
        // that says which call failed. The server's own sentence stays first.
        error.message =
          `${error.message} — and this block holds a block-scoped token, which the API accepts ` +
          `only on its \`blocks/*\` routes (plus \`GET models/{id}\`). If \`${path}\` needs an ` +
          `OAuth access token, ${OAUTH_OPT_IN}.`;
      }
      throw error;
    }
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
