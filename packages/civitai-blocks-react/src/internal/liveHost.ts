/**
 * `createLiveHost` — the LIVE sibling of {@link createMockHost}.
 *
 * Where `createMockHost` SYNTHESIZES every reply (no network, no real Buzz),
 * `createLiveHost` FORWARDS the App-Block postMessage protocol to the REAL
 * Civitai backend using a short-lived, pasted dev block token (minted via
 * `POST /api/v1/blocks/dev-token`, scope doc §3 Option A). It lets `dev:live`
 * run local block code against real compute / real Buzz / the real catalog —
 * Phase 2 of claudedocs/app-blocks-dev-token-endpoint-scope.md (§5.2).
 *
 * It returns the SAME {@link MockHost} interface as `createMockHost` (so a
 * harness can swap them), but `setScenario` / `buzz` are inert no-ops here —
 * there are no synthetic scenarios in live mode (the backend is the source of
 * truth).
 *
 * Mechanism (mirrors `createMockHost`):
 *  1. Patches `window.parent.postMessage` via `Object.defineProperty` so the
 *     block's OUTBOUND messages are intercepted.
 *  2. Replies as `MessageEvent`s fired from `window.location.origin` — the SDK
 *     `IframeTransport` DROPS any inbound message whose `origin` ≠ the allowed
 *     parent origin, so a block using this in dev MUST allow
 *     `window.location.origin` (same requirement as the mock host).
 *  3. On mount, fetches `/api/v1/blocks/me` (Bearer = the dev token) for the
 *     viewer, decodes the token JWT payload for the block identity / scopes /
 *     budget / maturity, and dispatches `BLOCK_INIT`.
 *
 * REAL NETWORK, REAL MONEY: unlike the mock host, this calls `fetch`. The only
 * network it does is (a) `GET /api/v1/blocks/me` and (b) the four
 * `blocks.{estimate,submit,poll,cancel}Workflow` tRPC mutations — each with the
 * Bearer dev token. A successful submit SPENDS the dev's OWN real Buzz against
 * real compute. The token's per-call budget + the per-user daily cap are the
 * server-side bounds (scope doc §4).
 *
 * PICKERS (Phase 1 of "make dev:live a faithful local host"): the live host
 * SERVES the resource pickers locally. On `OPEN_CHECKPOINT_PICKER` /
 * `OPEN_RESOURCE_PICKER` it opens an in-harness catalog-browser overlay (real
 * models fetched with the dev block token via `/api/v1/blocks/models`, public
 * fallback), the dev picks one, and the host replies with a REAL
 * `BlockCheckpointInfo` / `BlockResourceInfo` in the EXACT shape the production
 * host returns — so `useCheckpointPicker` / `useResourcePicker` are byte-identical
 * in dev:live and in prod (protocol fidelity, not chrome fidelity). A pick is
 * DISCOVERY ONLY: the server re-validates + prices every id at estimate/submit;
 * nothing the dev clicks here is trusted or spends Buzz. See the picker handlers.
 *
 * APP-STORAGE KV (Phase 4): the live host SERVES the five `APP_STORAGE_*` calls
 * by forwarding to the block-token `apps.storage.{get,set,delete,list,getQuota}`
 * tRPC procedures (publicProcedure + verifyBlockToken, FLAT `{ blockToken, … }`
 * input). Reads need the `apps:storage:read` scope, writes `apps:storage:write`
 * — the dev token already carries whatever the local manifest declared, and the
 * server enforces. Real per-(block_instance, user) KV, real 64KB/50MB quotas.
 *
 * SET_USER_CHECKPOINT (Phase 4): FORWARDED (faithful) to the block-token
 * `blocks.updateUserSettings` mutation — never fabricated. The default page
 * setup mints a PAGE token which lacks `ctx.modelId`, so the backend returns the
 * honest error "block token lacks modelId context"; that real outcome is
 * surfaced to the block. With a model-slot token it persists for real.
 *
 * SCOPE — the ONE capability live mode still cannot SERVE is OPEN_BUZZ_PURCHASE:
 * there is NO headless / block-token Buzz-purchase path (buying Buzz strictly
 * requires the interactive Stripe/Paddle host chrome). So it deep-links the real
 * purchase page and replies `purchased: false` — honest-by-design, never a
 * fabricated success. See the per-message handlers below.
 */

import {
  type BlockContext,
  type BlockInitPayload,
  type BlockWorkflowSnapshot,
  type ColorDomain,
  type Theme,
  type ViewerInfo,
  type WorkflowBody,
  type WrappedToken,
} from '@civitai/app-sdk/blocks';

import type { MockHost, MockHostScenarioPatch, MockBuzzHandle } from './mockHost.js';
import {
  openPickerOverlay,
  type PickerOverlayHandle,
  type OpenPickerOptions,
} from './pickerOverlay.js';

/** Default civitai backend the live host forwards to. */
const DEFAULT_BACKEND_BASE_URL = 'https://civitai.com';

/**
 * Options for {@link createLiveHost}. Mirrors the {@link MockHost}-relevant
 * subset of `MockHostOptions`, plus the live-only `blockToken` / `backendBaseUrl`
 * / `fetchImpl`.
 */
export interface LiveHostOptions {
  /**
   * The PASTED dev block token — a short-lived RS256 JWT minted by
   * `POST /api/v1/blocks/dev-token`. v1 echoes this token on `REQUEST_TOKEN`
   * (no auto-refresh); when it expires (~15min) the dev re-mints + restarts.
   * VITE_-bundled, so it must be SHORT-LIVED — never an API key (scope §5.1).
   */
  blockToken: string;
  /** Backend base URL the protocol forwards to. Default `https://civitai.com`. */
  backendBaseUrl?: string;
  /**
   * Override the viewer used in `BLOCK_INIT` instead of fetching
   * `/api/v1/blocks/me`. When omitted the host fetches the real viewer (and
   * falls back to a minimal anon-ish viewer if that fetch fails).
   */
  viewer?: ViewerInfo | null;
  /** Host theme delivered in `BLOCK_INIT` + context. Default `'dark'`. */
  theme?: Theme;
  /**
   * The `BLOCK_INIT` context. Defaults to a PAGE context (`{ slotId: 'app.page' }`),
   * since dev-token mints PAGE tokens only.
   */
  context?: BlockContext;
  /**
   * Called with every intercepted OUTBOUND message — lets a harness UI render a
   * message log (same hook as the mock host's `onOutbound`).
   */
  onOutbound?: (msg: { type: string; payload?: unknown }) => void;
  /** Override `window`. Defaults to `globalThis.window`. */
  window?: Window & typeof globalThis;
  /**
   * Injectable `fetch` (tests pass a mock). Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * TEST SEAM for the in-harness picker overlay. Called with the overlay's
   * {@link PickerOverlayHandle} once its first catalog page has loaded, on every
   * `OPEN_CHECKPOINT_PICKER` / `OPEN_RESOURCE_PICKER`. Tests use it to drive a
   * deterministic selection (`handle.selectFirst()` / `selectByVersionId()`) or
   * a dismissal (`handle.dismiss()`) without synthesizing DOM clicks. In a real
   * `dev:live` run this is omitted — the dev clicks a card in the overlay.
   */
  onPickerReady?: (handle: PickerOverlayHandle) => void;
}

/** Page slot id — dev-token mints page tokens (mirrors PAGE_SLOT_ID server-side). */
const PAGE_SLOT_ID = 'app.page';

/** The budgeted-spend scope the workflow procedures require. */
const BUDGETED_SCOPE = 'ai:write:budgeted';

/**
 * Decoded payload of a block-token JWT (the claims `BlockTokenService.sign`
 * stamps — see civitai `block-token.service.ts`). Everything is optional/unknown
 * because the token is dev-pasted: we decode it WITHOUT signature verification
 * (that's the server's job at the API boundary), purely to seed `BLOCK_INIT`.
 */
interface DecodedBlockTokenPayload {
  blockId?: string;
  appId?: string;
  appBlockId?: string;
  blockInstanceId?: string;
  ctx?: Record<string, unknown>;
  scopes?: string[];
  buzzBudget?: number;
  maxBrowsingLevel?: number;
  domain?: ColorDomain | null;
  sub?: string;
  /** Unix seconds. */
  exp?: number;
}

/**
 * Decode the middle (payload) segment of a JWT (base64url) WITHOUT verifying
 * the signature — client-side we only need the claims to build BLOCK_INIT; the
 * server re-verifies the signature on every API call. Returns `{}` on any
 * malformed input (never throws).
 */
export function decodeBlockTokenPayload(token: string): DecodedBlockTokenPayload {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payloadSeg = parts[1];
    if (!payloadSeg) return {};
    // base64url → base64
    const b64 = payloadSeg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = base64urlDecode(padded);
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as DecodedBlockTokenPayload;
  } catch {
    return {};
  }
}

/** base64 → utf-8 string, working in both browser (atob) + node (Buffer). */
function base64urlDecode(b64: string): string {
  if (typeof atob === 'function') {
    // atob → binary string; decode as UTF-8.
    const bin = atob(b64);
    try {
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return bin;
    }
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

/**
 * Build the {@link WrappedToken} the host sends to the block, from the raw token
 * + its decoded claims. `buzzBudget` is only attached when the token carries the
 * budgeted scope (mirrors the host: it's present only with `ai:write:budgeted`).
 */
function wrappedTokenFrom(raw: string, decoded: DecodedBlockTokenPayload): WrappedToken {
  const scopes = Array.isArray(decoded.scopes) ? decoded.scopes : [];
  const expiresAt =
    typeof decoded.exp === 'number'
      ? new Date(decoded.exp * 1000).toISOString()
      : new Date(Date.now() + 15 * 60_000).toISOString();
  const hasBudget = scopes.includes(BUDGETED_SCOPE) && typeof decoded.buzzBudget === 'number';
  return {
    raw,
    scopes,
    expiresAt,
    ...(hasBudget ? { buzzBudget: decoded.buzzBudget } : {}),
  };
}

/** `true` when the token's `exp` (Unix seconds) is in the past. */
function isExpired(decoded: DecodedBlockTokenPayload): boolean {
  return typeof decoded.exp === 'number' && decoded.exp * 1000 < Date.now();
}

/**
 * A failed-shape {@link BlockWorkflowSnapshot} the block can recover from. Used
 * when a backend call errors so the block's promise resolves instead of hanging
 * to its 120s timeout. `workflowId` is a non-empty sentinel because the SDK
 * validator drops empty-workflowId snapshots (mirrors the host's failure shape).
 */
function errorSnapshot(error: string): BlockWorkflowSnapshot {
  return { workflowId: 'failed', status: 'failed', error };
}

/**
 * Result of one tRPC mutation call: the parsed snapshot, or an error string.
 *
 * `transient` distinguishes a TRANSPORT/INFRA blip (network throw, or an HTTP
 * status that says "the backend couldn't answer right now" — 5xx / 408 / 429 /
 * 401) from a genuine, non-retryable error. It is NEVER a workflow `failed`
 * STATUS: the backend reports a failed *workflow* as a 200 response whose
 * snapshot has `status: 'failed'`, so a non-2xx / throw on POLL is always a
 * transport problem, not the orchestrator saying the generation failed. Callers
 * (the POLL handler) retry transient errors with bounded backoff instead of
 * synthesizing a terminal `failed` snapshot — see {@link pollWithRetry}.
 */
interface TrpcCallResult {
  snapshot?: BlockWorkflowSnapshot;
  error?: string;
  /** True when `error` is a transport/infra blip worth retrying. */
  transient?: boolean;
}

/**
 * The raw result of one tRPC call BEFORE any per-procedure unwrap: the parsed
 * response envelope (or `undefined` on a thrown fetch / empty body), or an error
 * string. {@link callTrpcMutation} (workflow path) and {@link callTrpcData}
 * (storage / checkpoint path) both build on this, so the fetch / parse / status
 * / error logic lives in exactly one place.
 */
interface RawTrpcResult {
  /** The parsed JSON response (the `{ result: { data: { json } } }` envelope). */
  parsed?: unknown;
  error?: string;
  /** True when `error` is a transport/infra blip worth retrying. */
  transient?: boolean;
}

/**
 * The result of one generic tRPC DATA call: the UNWRAPPED data object the
 * procedure returned (the storage / settings procs return plain records, not a
 * `{ snapshot }` wrapper), or an error string. Mirrors {@link TrpcCallResult}'s
 * `transient` semantics.
 */
interface TrpcDataResult {
  data?: unknown;
  error?: string;
  /** True when `error` is a transport/infra blip worth retrying. */
  transient?: boolean;
}

/**
 * Whether an HTTP status from a tRPC call is a transient transport/infra blip
 * (retry may succeed) vs. a deterministic error. 401 is included because a
 * not-yet-rolled-out backend pod legitimately 401s for a few seconds during a
 * deploy (the dev token is fine; the pod just hasn't loaded the verifier yet) —
 * the exact blip the round-5 dogfood hit. Anything ≥ 500, plus 408 (timeout)
 * and 429 (rate-limit), is also transient.
 */
function isTransientHttpStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429 || status === 401;
}

/**
 * Bounded-retry policy for transient POLL transport errors. A few quick
 * attempts with short exponential backoff (~1.75s total worst case) absorbs a
 * single bad pod / network hiccup without turning a server-side success into a
 * terminal `failed`. After the cap, the POLL handler replies with a NON-terminal
 * `processing` snapshot (keep-polling) rather than fabricating `failed`, so the
 * block's own poll loop tries again.
 */
const POLL_RETRY_BACKOFF_MS = [250, 500, 1000] as const;

/**
 * Create a LIVE host that forwards the App-Block postMessage protocol to the
 * real Civitai backend. Returns the same {@link MockHost} interface as
 * {@link createMockHost} (so a harness can swap them); `setScenario` / `buzz`
 * are no-ops (there are no synthetic scenarios in live mode).
 *
 * @example
 * const host = createLiveHost({ blockToken: import.meta.env.VITE_LIVE_BLOCK_TOKEN });
 * const uninstall = host.install();
 * // … drive the block against the REAL backend (real Buzz!) …
 * uninstall();
 */
export function createLiveHost(options: LiveHostOptions): MockHost {
  const maybeWin =
    options.window ?? (globalThis as { window?: Window & typeof globalThis }).window;
  if (!maybeWin) {
    throw new Error('createLiveHost: no window available (call from a DOM environment).');
  }
  const win: Window & typeof globalThis = maybeWin;

  const rawToken = options.blockToken;
  if (!rawToken || typeof rawToken !== 'string') {
    // Non-fatal: the host still installs so the dev sees a clear error in the
    // block, rather than a silently-dead harness.
    // eslint-disable-next-line no-console
    console.error(
      '[createLiveHost] No block token supplied. Set VITE_LIVE_BLOCK_TOKEN to a dev token ' +
        'minted via POST /api/v1/blocks/dev-token.',
    );
  }

  const baseUrl = (options.backendBaseUrl ?? DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '');
  // The default fetch MUST be invoked as a method of globalThis. A detached
  // reference (`const f = globalThis.fetch; f(url)`) throws "Illegal invocation"
  // in browsers — fetch is a DOM-bound builtin — which broke the catalog/picker
  // and every live-host network call when no fetchImpl was supplied. Wrap it so
  // the call is always bound.
  const fetchImpl: typeof fetch =
    options.fetchImpl ??
    ((input, init) => (globalThis as { fetch: typeof fetch }).fetch(input, init));
  const theme: Theme = options.theme ?? 'dark';
  const decoded = decodeBlockTokenPayload(rawToken ?? '');

  if (isExpired(decoded)) {
    // eslint-disable-next-line no-console
    console.error(
      '[createLiveHost] dev token expired — re-mint via POST /api/v1/blocks/dev-token and ' +
        'update VITE_LIVE_BLOCK_TOKEN. Replying with the expired token anyway; the backend ' +
        'will 401 (the honest signal).',
    );
  }

  // A token minted from an OAuth login carries no spend scope (the server
  // strips `ai:write:budgeted` — the civitai-cli OAuth client has no AI
  // Services). With such a token the block's `granted` is false, so Generate
  // calls REQUEST_CONSENT — which live mode CANNOT grant (there's no scope to
  // re-mint into). Warn UP FRONT, before the dev wastes a click on a Generate
  // that silently dead-ends. (The CLI also warns at mint time.)
  const tokenCanSpend = Array.isArray(decoded.scopes) && decoded.scopes.includes(BUDGETED_SCOPE);
  if (rawToken && !isExpired(decoded) && !tokenCanSpend) {
    // eslint-disable-next-line no-console
    console.warn(
      '[createLiveHost] This dev token is READ-ONLY — it has no `ai:write:budgeted` scope, so ' +
        'Generate will NOT spend Buzz (REQUEST_CONSENT cannot be granted in live mode). It was ' +
        'likely minted from an OAuth login. Real generation needs a full-scope personal API key: ' +
        '`civitai login --token <key>` (https://civitai.com/user/account), then re-mint the dev token.',
    );
  }

  // One-time "not supported in live v1" log gating per capability.
  const loggedOnce = new Set<string>();
  const logOnce = (key: string, message: string) => {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[createLiveHost] ${message}`);
  };

  /**
   * The single tRPC transport primitive. Builds the non-batched httpLink +
   * superjson request for `procedure` and returns the PARSED envelope (or an
   * error). `method` selects the tRPC verb:
   *   - `'POST'` (mutation): body is `{ json: <input> }`.
   *   - `'GET'` (query): input is querystring-encoded as
   *     `?input=encodeURIComponent(JSON.stringify({ json: <input> }))`.
   * Every call carries `Authorization: Bearer <rawToken>`. A thrown fetch →
   * `{ error, transient: true }`; a non-2xx → `{ error, transient }` (status-
   * classified via {@link isTransientHttpStatus}). Both `callTrpcMutation` and
   * `callTrpcData` build on this so the fetch/parse/error logic lives once.
   */
  async function rawTrpcCall(
    procedure: string,
    input: Record<string, unknown>,
    method: 'GET' | 'POST',
  ): Promise<RawTrpcResult> {
    if (!fetchImpl) return { error: 'no fetch available' };
    try {
      let url = `${baseUrl}/api/trpc/${procedure}`;
      const init: RequestInit = {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${rawToken}`,
        },
      };
      if (method === 'GET') {
        // tRPC query: superjson input goes in the querystring.
        const encoded = encodeURIComponent(JSON.stringify({ json: input }));
        url = `${url}?input=${encoded}`;
      } else {
        // Non-batched httpLink + superjson transformer wraps the input as
        // `{ json: <input> }` (no `meta` for plain JSON inputs).
        init.body = JSON.stringify({ json: input });
      }
      const res = await fetchImpl(url, init);
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (!res.ok) {
        const msg = extractTrpcError(parsed) ?? `${procedure} failed: HTTP ${res.status}`;
        return { error: msg, transient: isTransientHttpStatus(res.status) };
      }
      return { parsed };
    } catch (err) {
      // A thrown fetch is a network/transport failure (DNS, connection reset,
      // CORS, offline) — always transient.
      return { error: err instanceof Error ? err.message : String(err), transient: true };
    }
  }

  /**
   * POST a tRPC WORKFLOW mutation (the `blocks.{estimate,submit,poll,cancel}-
   * Workflow` procs which return a `{ snapshot }` wrapper). Byte-for-byte
   * behaviourally identical to the previous direct implementation — still POST,
   * still {@link extractSnapshot}.
   */
  async function callTrpcMutation(
    procedure: string,
    input: Record<string, unknown>,
  ): Promise<TrpcCallResult> {
    const raw = await rawTrpcCall(procedure, input, 'POST');
    if (raw.error !== undefined) return { error: raw.error, transient: raw.transient };
    const snapshot = extractSnapshot(raw.parsed);
    if (!snapshot) {
      return { error: `${procedure}: malformed response (no snapshot)` };
    }
    return { snapshot };
  }

  /**
   * Call a tRPC DATA procedure (storage / settings) and unwrap the plain data
   * object it returns (via {@link extractData}). `method` is `'GET'` for queries
   * (`apps.storage.{get,list,getQuota}`) and `'POST'` for mutations
   * (`apps.storage.{set,delete}`, `blocks.updateUserSettings`).
   */
  async function callTrpcData(
    procedure: string,
    input: Record<string, unknown>,
    method: 'GET' | 'POST',
  ): Promise<TrpcDataResult> {
    const raw = await rawTrpcCall(procedure, input, method);
    if (raw.error !== undefined) return { error: raw.error, transient: raw.transient };
    const data = extractData(raw.parsed);
    if (data === undefined) {
      return { error: `${procedure}: malformed response (no data)` };
    }
    return { data };
  }

  /**
   * POLL with bounded retry of transient transport errors. A genuine workflow
   * `failed` arrives as a `snapshot` (HTTP 200) and is returned immediately; a
   * transient transport blip (network throw / 5xx / 408 / 429 / 401) is retried
   * with {@link POLL_RETRY_BACKOFF_MS} backoff. The final result is only ever a
   * `snapshot` OR a still-transient error — the caller turns the latter into a
   * keep-polling `processing` reply, never a fabricated terminal `failed`.
   */
  async function pollWithRetry(workflowId: string): Promise<TrpcCallResult> {
    let last: TrpcCallResult = { error: 'poll failed', transient: true };
    for (let attempt = 0; attempt <= POLL_RETRY_BACKOFF_MS.length; attempt += 1) {
      last = await callTrpcMutation('blocks.pollWorkflow', { blockToken: rawToken, workflowId });
      // A real snapshot (incl. a genuine terminal `failed`) — done.
      if (last.snapshot) return last;
      // A non-transient error (malformed response, deterministic 4xx) — don't
      // burn retries; surface it.
      if (!last.transient) return last;
      // Transient: back off and retry, unless we've exhausted the budget.
      const delay = POLL_RETRY_BACKOFF_MS[attempt];
      if (delay === undefined) break;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    return last;
  }

  let installed = false;
  let teardown: () => void = () => {};

  function install(): () => void {
    if (installed) return teardown;
    installed = true;

    const parentOrigin = win.location.origin;
    const originalParent = win.parent;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    // Picker overlays currently mounted in the document. Closed on host teardown
    // so a still-open picker can never outlive the host (or leak a DOM node).
    const openOverlays = new Set<PickerOverlayHandle>();
    let torn = false;

    const dispatchToBlock = (data: unknown) => {
      if (torn) return;
      win.dispatchEvent(new MessageEvent('message', { data, origin: parentOrigin }));
    };
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };

    /** Resolve the viewer for BLOCK_INIT (real fetch, or the override). */
    async function resolveViewer(): Promise<ViewerInfo | null> {
      if (options.viewer !== undefined) return options.viewer;
      if (!fetchImpl) return anonFallbackViewer();
      try {
        const res = await fetchImpl(`${baseUrl}/api/v1/blocks/me`, {
          headers: { authorization: `Bearer ${rawToken}` },
        });
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.warn(
            `[createLiveHost] /api/v1/blocks/me returned HTTP ${res.status}; using a minimal ` +
              'anon-ish viewer. Check the dev token is valid + not expired.',
          );
          return anonFallbackViewer();
        }
        const me = (await res.json()) as {
          id?: number;
          username?: string | null;
          status?: 'active' | 'banned' | 'muted';
        };
        if (typeof me.id !== 'number') return anonFallbackViewer();
        return {
          id: me.id,
          username: me.username ?? null,
          ...(me.status ? { status: me.status } : {}),
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[createLiveHost] /api/v1/blocks/me fetch failed; using a minimal anon-ish viewer.',
          err,
        );
        return anonFallbackViewer();
      }
    }

    /** Dispatch BLOCK_INIT once the viewer is resolved. */
    async function dispatchInit() {
      const viewer = await resolveViewer();
      if (torn) return;
      const baseContext: BlockContext = options.context ?? { slotId: PAGE_SLOT_ID };
      const context: BlockContext = { ...baseContext, theme };
      const initPayload: BlockInitPayload = {
        blockInstanceId: decoded.blockInstanceId ?? 'page_live',
        blockId: decoded.blockId ?? 'live-block',
        appId: decoded.appId ?? 'app_dev',
        token: wrappedTokenFrom(rawToken ?? '', decoded),
        context,
        settings: { publisherSettings: {}, userSettings: {} },
        viewer,
        theme,
        renderMode: 'iframe',
        ...(decoded.domain != null ? { domain: decoded.domain } : {}),
        ...(typeof decoded.maxBrowsingLevel === 'number'
          ? { maxBrowsingLevel: decoded.maxBrowsingLevel }
          : {}),
      };
      dispatchToBlock({ type: 'BLOCK_INIT', payload: initPayload });
    }

    /**
     * Open the in-harness picker overlay and resolve it into a picker-result
     * message. `resultType` is the inbound message type the block awaits
     * (`CHECKPOINT_PICKER_RESULT` / `RESOURCE_PICKER_RESULT`); a pick dispatches
     * `{ requestId, selected }`, a dismissal `{ requestId }` (no `selected`) —
     * EXACTLY the production host's contract, so the hooks are byte-identical.
     *
     * DISCOVERY ONLY: the overlay just browses the catalog. The picked id is a
     * hint — the server re-validates + prices it at estimate/submit. Nothing here
     * is trusted or spends Buzz.
     */
    const openPicker = (
      params: Pick<OpenPickerOptions, 'type' | 'baseModelGroup' | 'currentVersionId'>,
      resultType: 'CHECKPOINT_PICKER_RESULT' | 'RESOURCE_PICKER_RESULT',
      requestId: string,
    ) => {
      const handle = openPickerOverlay({
        type: params.type,
        baseUrl,
        token: rawToken,
        fetchImpl,
        ...(params.baseModelGroup != null ? { baseModelGroup: params.baseModelGroup } : {}),
        ...(params.currentVersionId != null ? { currentVersionId: params.currentVersionId } : {}),
        ...(win.document ? { document: win.document } : {}),
        ...(options.onPickerReady ? { onReady: options.onPickerReady } : {}),
        onResolve: (selection) => {
          openOverlays.delete(handle);
          if (torn) return;
          dispatchToBlock({
            type: resultType,
            // A dismissal omits `selected` (the hooks resolve to undefined/null).
            payload: { requestId, ...(selection ? { selected: selection.selected } : {}) },
          });
        },
      });
      // `openResolve` may have fired synchronously (e.g. a test's onReady that
      // immediately selects). Only track an overlay that's still open.
      if (!handle.resolved) openOverlays.add(handle);
    };

    const parentMock = {
      postMessage: (msg: unknown) => {
        if (
          typeof msg !== 'object' ||
          msg === null ||
          typeof (msg as { type?: unknown }).type !== 'string'
        ) {
          return;
        }
        const typed = msg as {
          type: string;
          payload?: {
            requestId?: string;
            workflowId?: string;
            body?: WorkflowBody;
            path?: string;
            target?: 'current' | 'new_tab';
            suggestedAmount?: number;
            baseModelGroup?: string;
            currentVersionId?: number;
            resourceType?: 'Checkpoint' | 'LORA';
            key?: string;
            value?: unknown;
            prefix?: string;
            limit?: number;
            cursor?: string;
            versionId?: number | null;
          };
        };

        options.onOutbound?.({ type: typed.type, payload: typed.payload });

        const requestId = typed.payload?.requestId;

        switch (typed.type) {
          case 'BLOCK_READY':
          case 'RESIZE_IFRAME':
            // Iframe resize: no host chrome to resize in dev (the harness owns
            // layout). No-op, mirroring the mock host.
            return;

          case 'REQUEST_TOKEN': {
            if (isExpired(decoded)) {
              // eslint-disable-next-line no-console
              console.error(
                '[createLiveHost] REQUEST_TOKEN: dev token is expired — re-mint via ' +
                  'POST /api/v1/blocks/dev-token and update VITE_LIVE_BLOCK_TOKEN. ' +
                  'Replying with the expired token; the backend will 401.',
              );
            }
            // v1 echoes the pasted token (no auto-refresh / re-mint).
            dispatchToBlock({
              type: 'TOKEN_REFRESH_RESPONSE',
              payload: {
                ...(requestId ? { requestId } : {}),
                token: wrappedTokenFrom(rawToken ?? '', decoded),
              },
            });
            return;
          }

          case 'ESTIMATE_WORKFLOW': {
            const body = typed.payload?.body;
            void callTrpcMutation('blocks.estimateWorkflow', { blockToken: rawToken, body }).then(
              (r) => {
                dispatchToBlock({
                  type: 'ESTIMATE_RESULT',
                  payload: {
                    requestId,
                    snapshot: r.snapshot ?? errorSnapshot(r.error ?? 'estimate failed'),
                  },
                });
              },
            );
            return;
          }

          case 'SUBMIT_WORKFLOW': {
            const body = typed.payload?.body;
            void callTrpcMutation('blocks.submitWorkflow', { blockToken: rawToken, body }).then(
              (r) => {
                dispatchToBlock({
                  type: 'WORKFLOW_SUBMITTED',
                  payload: {
                    requestId,
                    snapshot: r.snapshot ?? errorSnapshot(r.error ?? 'submit failed'),
                  },
                });
              },
            );
            return;
          }

          case 'POLL_WORKFLOW': {
            const workflowId = typed.payload?.workflowId ?? '';
            void pollWithRetry(workflowId).then((r) => {
              // Snapshot present (incl. a genuine terminal `failed` from the
              // backend) — forward it as-is.
              if (r.snapshot) {
                dispatchToBlock({
                  type: 'WORKFLOW_STATUS',
                  payload: { requestId, snapshot: r.snapshot },
                });
                return;
              }
              // A still-transient transport error AFTER bounded retries must NOT
              // become a terminal `failed` (the workflow may well be succeeding
              // server-side). Reply with a NON-terminal `processing` snapshot
              // carrying the transient error so the block's poll loop keeps
              // polling and the real outcome surfaces on a later tick. A genuine
              // workflow failure only ever arrives as `r.snapshot.status` ===
              // 'failed' above.
              const transient = r.transient ?? false;
              logOnce(
                'poll-transient',
                `pollWorkflow transport error (kept polling, not failed): ${r.error ?? 'unknown'}`,
              );
              dispatchToBlock({
                type: 'WORKFLOW_STATUS',
                payload: {
                  requestId,
                  // keeps the workflowId so the block maps it back to the right card.
                  snapshot: {
                    workflowId,
                    status: transient ? ('processing' as const) : ('failed' as const),
                    error: r.error ?? 'poll failed',
                  },
                },
              });
            });
            return;
          }

          case 'CANCEL_WORKFLOW': {
            const workflowId = typed.payload?.workflowId ?? '';
            void callTrpcMutation('blocks.cancelWorkflow', {
              blockToken: rawToken,
              workflowId,
            }).then((r) => {
              dispatchToBlock({
                type: 'WORKFLOW_CANCELED',
                payload: {
                  requestId,
                  snapshot:
                    r.snapshot ?? {
                      workflowId,
                      status: 'canceled' as const,
                      error: r.error ?? 'cancel failed',
                    },
                },
              });
            });
            return;
          }

          case 'OPEN_BUZZ_PURCHASE': {
            // No headless purchase contract. Deep-link the dev to the real
            // purchase page and reply purchased:false (honest — we can't observe
            // the out-of-band purchase). Do NOT fabricate purchased:true.
            try {
              win.open(`${baseUrl}/purchase/buzz`, '_blank');
            } catch {
              /* window.open may be unavailable (tests) — the reply still lands */
            }
            // eslint-disable-next-line no-console
            console.info(
              '[createLiveHost] Opened the Buzz purchase page in a new tab. Complete the ' +
                'purchase there, then re-estimate / re-submit.',
            );
            dispatchToBlock({
              type: 'BUZZ_PURCHASE_RESULT',
              payload: { requestId: requestId ?? '', purchased: false },
            });
            return;
          }

          case 'OPEN_CHECKPOINT_PICKER': {
            // Serve the picker locally: open the in-harness catalog browser
            // filtered to Checkpoints in the requested ecosystem, pre-highlight
            // the current pick, and reply with a REAL BlockCheckpointInfo (or no
            // `selected` on dismissal) — the production contract. DISCOVERY ONLY:
            // the server re-validates + prices the picked id at estimate/submit.
            openPicker(
              {
                type: 'Checkpoint',
                ...(typeof typed.payload?.baseModelGroup === 'string'
                  ? { baseModelGroup: typed.payload.baseModelGroup }
                  : {}),
                ...(typeof typed.payload?.currentVersionId === 'number'
                  ? { currentVersionId: typed.payload.currentVersionId }
                  : {}),
              },
              'CHECKPOINT_PICKER_RESULT',
              requestId ?? '',
            );
            return;
          }

          case 'OPEN_RESOURCE_PICKER': {
            // Same as the checkpoint picker but for the requested resourceType
            // (v1: 'Checkpoint' | 'LORA'). Replies with a REAL BlockResourceInfo
            // (or no `selected` on dismissal). DISCOVERY ONLY — re-priced +
            // re-validated server-side at estimate/submit.
            const resourceType: 'Checkpoint' | 'LORA' =
              typed.payload?.resourceType === 'Checkpoint' ? 'Checkpoint' : 'LORA';
            openPicker(
              {
                type: resourceType,
                ...(typeof typed.payload?.baseModelGroup === 'string'
                  ? { baseModelGroup: typed.payload.baseModelGroup }
                  : {}),
              },
              'RESOURCE_PICKER_RESULT',
              requestId ?? '',
            );
            return;
          }

          case 'SET_USER_CHECKPOINT': {
            // FORWARD (faithful) to blocks.updateUserSettings — never fabricate.
            // Mirror the prod IframeHost's versionId validation: a number or an
            // explicit null is valid; anything else is rejected WITHOUT a backend
            // call. NOTE: dev-token mints PAGE tokens which lack `ctx.modelId`, so
            // with the default page setup the backend returns the honest error
            // "block token lacks modelId context" — this is FAITHFUL (it surfaces
            // the real outcome) and works for real with a model-slot token.
            const rawVersionId = typed.payload?.versionId;
            const versionId =
              rawVersionId === null
                ? null
                : typeof rawVersionId === 'number'
                  ? rawVersionId
                  : undefined;
            if (versionId === undefined) {
              dispatchToBlock({
                type: 'USER_CHECKPOINT_SET',
                payload: {
                  requestId: requestId ?? '',
                  ok: false,
                  error: 'versionId must be a number or null',
                },
              });
              return;
            }
            void callTrpcData(
              'blocks.updateUserSettings',
              { blockToken: rawToken, settings: { checkpoint_version_id: versionId } },
              'POST',
            ).then((r) => {
              dispatchToBlock({
                type: 'USER_CHECKPOINT_SET',
                payload: r.error
                  ? { requestId: requestId ?? '', ok: false, error: r.error }
                  : { requestId: requestId ?? '', ok: true },
              });
            });
            return;
          }

          case 'APP_STORAGE_GET': {
            // Query apps.storage.get {blockToken, key} (GET). The server enforces
            // the apps:storage:read scope; the dev token carries it iff the local
            // manifest declared it.
            const key = typed.payload?.key ?? '';
            void callTrpcData('apps.storage.get', { blockToken: rawToken, key }, 'GET').then(
              (r) => {
                if (r.error) {
                  dispatchToBlock({
                    type: 'APP_STORAGE_GET_RESULT',
                    payload: { requestId: requestId ?? '', value: null, error: r.error },
                  });
                  return;
                }
                const value = (r.data as { value?: unknown })?.value ?? null;
                dispatchToBlock({
                  type: 'APP_STORAGE_GET_RESULT',
                  payload: { requestId: requestId ?? '', value },
                });
              },
            );
            return;
          }

          case 'APP_STORAGE_SET': {
            // Mutation apps.storage.set {blockToken, key, value} (POST). The
            // server enforces apps:storage:write + the 64KB/50MB quotas.
            const key = typed.payload?.key ?? '';
            const value = typed.payload?.value;
            void callTrpcData(
              'apps.storage.set',
              { blockToken: rawToken, key, value },
              'POST',
            ).then((r) => {
              if (r.error) {
                dispatchToBlock({
                  type: 'APP_STORAGE_SET_RESULT',
                  payload: { requestId: requestId ?? '', ok: false, error: r.error },
                });
                return;
              }
              const sizeBytes = (r.data as { sizeBytes?: unknown })?.sizeBytes;
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: {
                  requestId: requestId ?? '',
                  ok: true,
                  ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
                },
              });
            });
            return;
          }

          case 'APP_STORAGE_DELETE': {
            // Mutation apps.storage.delete {blockToken, key} (POST).
            const key = typed.payload?.key ?? '';
            void callTrpcData(
              'apps.storage.delete',
              { blockToken: rawToken, key },
              'POST',
            ).then((r) => {
              if (r.error) {
                dispatchToBlock({
                  type: 'APP_STORAGE_DELETE_RESULT',
                  payload: {
                    requestId: requestId ?? '',
                    ok: false,
                    deleted: false,
                    error: r.error,
                  },
                });
                return;
              }
              dispatchToBlock({
                type: 'APP_STORAGE_DELETE_RESULT',
                payload: {
                  requestId: requestId ?? '',
                  ok: true,
                  deleted: Boolean((r.data as { deleted?: unknown })?.deleted),
                },
              });
            });
            return;
          }

          case 'APP_STORAGE_LIST': {
            // Query apps.storage.list {blockToken, prefix?, limit, cursor?} (GET).
            // Clamp the limit to the server's [1,200] bound (default 50); only
            // include prefix/cursor when they're strings so JSON.stringify drops
            // the undefined keys (the server input is `.optional()`).
            const rawLimit = typed.payload?.limit;
            const limit =
              typeof rawLimit === 'number'
                ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
                : 50;
            const prefix = typed.payload?.prefix;
            const cursor = typed.payload?.cursor;
            const listInput: Record<string, unknown> = { blockToken: rawToken, limit };
            if (typeof prefix === 'string') listInput.prefix = prefix;
            if (typeof cursor === 'string') listInput.cursor = cursor;
            void callTrpcData('apps.storage.list', listInput, 'GET').then((r) => {
              if (r.error) {
                dispatchToBlock({
                  type: 'APP_STORAGE_LIST_RESULT',
                  payload: { requestId: requestId ?? '', keys: [], error: r.error },
                });
                return;
              }
              const rawKeys = (r.data as { keys?: unknown })?.keys;
              const keys = (Array.isArray(rawKeys) ? rawKeys : []).map((k) => {
                const entry = k as { key?: unknown; updatedAt?: unknown };
                return {
                  key: String(entry.key),
                  updatedAt:
                    entry.updatedAt instanceof Date
                      ? entry.updatedAt.toISOString()
                      : String(entry.updatedAt),
                };
              });
              const nextCursor = (r.data as { nextCursor?: unknown })?.nextCursor;
              dispatchToBlock({
                type: 'APP_STORAGE_LIST_RESULT',
                payload: {
                  requestId: requestId ?? '',
                  keys,
                  ...(typeof nextCursor === 'string' && nextCursor.length > 0
                    ? { nextCursor }
                    : {}),
                },
              });
            });
            return;
          }

          case 'APP_STORAGE_QUOTA': {
            // Query apps.storage.getQuota {blockToken} (GET).
            void callTrpcData('apps.storage.getQuota', { blockToken: rawToken }, 'GET').then(
              (r) => {
                if (r.error) {
                  dispatchToBlock({
                    type: 'APP_STORAGE_QUOTA_RESULT',
                    payload: {
                      requestId: requestId ?? '',
                      usedBytes: 0,
                      rowCount: 0,
                      limitBytes: 0,
                      limitRows: 0,
                      error: r.error,
                    },
                  });
                  return;
                }
                const d = r.data as {
                  usedBytes?: unknown;
                  rowCount?: unknown;
                  limitBytes?: unknown;
                  limitRows?: unknown;
                };
                const num = (v: unknown) => (typeof v === 'number' ? v : 0);
                dispatchToBlock({
                  type: 'APP_STORAGE_QUOTA_RESULT',
                  payload: {
                    requestId: requestId ?? '',
                    usedBytes: num(d?.usedBytes),
                    rowCount: num(d?.rowCount),
                    limitBytes: num(d?.limitBytes),
                    limitRows: num(d?.limitRows),
                  },
                });
              },
            );
            return;
          }

          case 'NAVIGATE': {
            const path = typed.payload?.path ?? '';
            const target = typed.payload?.target ?? 'current';
            // Resolve relative paths against the backend origin so an in-app
            // path (`/models/123`) opens on the real site.
            const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path}`;
            try {
              if (target === 'new_tab') {
                win.open(url, '_blank');
              } else {
                win.location.assign(url);
              }
            } catch {
              /* navigation may be unavailable (tests) */
            }
            return;
          }

          case 'REQUEST_CONSENT': {
            // Live mode CANNOT grant consent: there is no host UI to open and no
            // way to re-mint a token with a scope it doesn't carry. If the token
            // already has the budgeted scope, the block never gets here (its
            // `granted` is true) — so reaching this case means the token is
            // read-only (typically an OAuth-minted token) and Generate would
            // otherwise dead-end SILENTLY. Log a clear, actionable error rather
            // than swallowing it. (The startup warning above already fired once.)
            logOnce(
              'request-consent',
              'REQUEST_CONSENT received but live mode cannot grant scopes. Your dev token lacks ' +
                '`ai:write:budgeted`, so Generate will not spend. Re-mint with a full-scope personal ' +
                'API key: `civitai login --token <key>` (https://civitai.com/user/account), then ' +
                'update VITE_LIVE_BLOCK_TOKEN and restart.',
            );
            return;
          }

          case 'TRACK_EVENT':
          case 'REQUEST_SIGN_IN':
          case 'BLOCK_ERROR':
            // No-op. TRACK_EVENT/BLOCK_ERROR are fire-and-forget; REQUEST_SIGN_IN
            // can't open a login in dev (the viewer comes from the token — a
            // failed viewer fetch already warns in resolveViewer).
            return;

          default:
            return;
        }
      },
    };

    Object.defineProperty(win, 'parent', {
      value: parentMock,
      configurable: true,
      writable: true,
    });

    // Defer one tick so the block's transport listener is registered before
    // BLOCK_INIT fires (mirrors the mock host). The viewer fetch is async; the
    // init lands when it resolves.
    after(0, () => {
      void dispatchInit();
    });

    teardown = () => {
      if (torn) return;
      torn = true;
      installed = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      // Close any open picker overlay (unmounts its DOM; resolves it `null`).
      for (const overlay of openOverlays) overlay.close();
      openOverlays.clear();
      Object.defineProperty(win, 'parent', {
        value: originalParent,
        configurable: true,
        writable: true,
      });
    };
    return teardown;
  }

  // `setScenario` / `buzz` are inert in live mode — there are no synthetic
  // scenarios (the backend is the source of truth). Kept so the returned object
  // is interchangeable with a `createMockHost` handle.
  const buzzHandle: MockBuzzHandle = {
    getBalance: () => undefined,
    setBalance: () => {
      /* no-op in live mode */
    },
  };

  return {
    install,
    setScenario: (_patch: MockHostScenarioPatch) => {
      /* no-op in live mode */
    },
    buzz: buzzHandle,
  };
}

/** A minimal anon-ish viewer used when `/api/v1/blocks/me` can't be reached. */
function anonFallbackViewer(): ViewerInfo {
  return { id: 0, username: 'dev-live', status: 'active' };
}

/**
 * Extract the `snapshot` from a tRPC response. Handles the superjson
 * `{ result: { data: { json: T } } }` envelope AND the transformer-less
 * `{ result: { data: T } }` shape, defensively (mirrors `fetchBuzzAccount`).
 */
function extractSnapshot(parsed: unknown): BlockWorkflowSnapshot | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const result = (parsed as { result?: { data?: unknown } }).result;
  const data = result?.data;
  if (data == null) return undefined;
  // superjson: { json: { snapshot } } ; plain: { snapshot }
  const unwrapped =
    typeof data === 'object' && data !== null && 'json' in data
      ? (data as { json?: unknown }).json
      : data;
  if (typeof unwrapped !== 'object' || unwrapped === null) return undefined;
  const snapshot = (unwrapped as { snapshot?: unknown }).snapshot;
  if (typeof snapshot !== 'object' || snapshot === null) return undefined;
  return snapshot as BlockWorkflowSnapshot;
}

/**
 * Extract the UNWRAPPED data object from a tRPC response — the generalization of
 * {@link extractSnapshot} for procedures that return a plain record (storage /
 * settings) rather than a `{ snapshot }` wrapper. Handles the superjson
 * `{ result: { data: { json: T } } }` envelope AND the transformer-less
 * `{ result: { data: T } }` shape. Returns `undefined` only when there is no
 * `result.data` at all (a genuinely malformed response); a procedure that
 * legitimately returns `null`/`{}` round-trips as that value.
 */
function extractData(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const result = (parsed as { result?: { data?: unknown } }).result;
  const data = result?.data;
  if (data === undefined || data === null) return undefined;
  // superjson: { json: <T> } ; plain: <T>
  return typeof data === 'object' && data !== null && 'json' in data
    ? (data as { json?: unknown }).json
    : data;
}

/**
 * Extract a human-readable error message from a tRPC error response. tRPC v11
 * error bodies are `{ error: { json: { message } } }` (superjson) or
 * `{ error: { message } }`. Returns undefined when no message is found.
 */
function extractTrpcError(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const inner =
    'json' in error ? (error as { json?: unknown }).json : (error as Record<string, unknown>);
  if (typeof inner !== 'object' || inner === null) return undefined;
  const message = (inner as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}
