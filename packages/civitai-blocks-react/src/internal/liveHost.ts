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
 * SCOPE — live v1 deliberately does NOT support: pickers
 * (OPEN_CHECKPOINT_PICKER / OPEN_RESOURCE_PICKER), SET_USER_CHECKPOINT, the
 * App-Storage KV protocol, and an in-band Buzz purchase. Each of those replies
 * with a clearly-labelled "not supported in live v1" outcome (never a fabricated
 * success) and logs once. Use mock mode for those flows, or a later live
 * version. See the per-message handlers below.
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
}

/** Page slot id — dev-token mints page tokens (mirrors PAGE_SLOT_ID server-side). */
const PAGE_SLOT_ID = 'app.page';

/** The budgeted-spend scope the workflow procedures require. */
const BUDGETED_SCOPE = 'ai:write:budgeted';

const NOT_SUPPORTED_STORAGE = 'app-storage not supported in live v1 yet';
const NOT_SUPPORTED_PICKER = 'picker not supported in live v1 (use mock mode or v1.1)';
const NOT_SUPPORTED_USER_CHECKPOINT = 'not supported in live v1';

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
 */
interface TrpcCallResult {
  snapshot?: BlockWorkflowSnapshot;
  error?: string;
}

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
  const fetchImpl: typeof fetch =
    options.fetchImpl ?? ((globalThis as { fetch?: typeof fetch }).fetch as typeof fetch);
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

  // One-time "not supported in live v1" log gating per capability.
  const loggedOnce = new Set<string>();
  const logOnce = (key: string, message: string) => {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[createLiveHost] ${message}`);
  };

  /** POST a tRPC mutation (superjson, non-batched httpLink shape). */
  async function callTrpcMutation(
    procedure: string,
    input: Record<string, unknown>,
  ): Promise<TrpcCallResult> {
    if (!fetchImpl) return { error: 'no fetch available' };
    try {
      const res = await fetchImpl(`${baseUrl}/api/trpc/${procedure}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${rawToken}`,
        },
        // Non-batched httpLink + superjson transformer wraps the input as
        // `{ json: <input> }` (no `meta` for plain JSON inputs). The blocks
        // procedures take `{ blockToken, body? }`.
        body: JSON.stringify({ json: input }),
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (!res.ok) {
        const msg = extractTrpcError(parsed) ?? `${procedure} failed: HTTP ${res.status}`;
        return { error: msg };
      }
      const snapshot = extractSnapshot(parsed);
      if (!snapshot) {
        return { error: `${procedure}: malformed response (no snapshot)` };
      }
      return { snapshot };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  let installed = false;
  let teardown: () => void = () => {};

  function install(): () => void {
    if (installed) return teardown;
    installed = true;

    const parentOrigin = win.location.origin;
    const originalParent = win.parent;
    const timers = new Set<ReturnType<typeof setTimeout>>();
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
            void callTrpcMutation('blocks.pollWorkflow', {
              blockToken: rawToken,
              workflowId,
            }).then((r) => {
              dispatchToBlock({
                type: 'WORKFLOW_STATUS',
                payload: {
                  requestId,
                  snapshot:
                    r.snapshot ?? {
                      // A failed poll keeps the workflowId so the block can map
                      // it back to the right card.
                      workflowId,
                      status: 'failed' as const,
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
            logOnce('checkpoint-picker', NOT_SUPPORTED_PICKER);
            dispatchToBlock({
              type: 'CHECKPOINT_PICKER_RESULT',
              payload: { requestId: requestId ?? '' },
            });
            return;
          }

          case 'OPEN_RESOURCE_PICKER': {
            logOnce('resource-picker', NOT_SUPPORTED_PICKER);
            dispatchToBlock({
              type: 'RESOURCE_PICKER_RESULT',
              payload: { requestId: requestId ?? '' },
            });
            return;
          }

          case 'SET_USER_CHECKPOINT': {
            logOnce('set-user-checkpoint', `SET_USER_CHECKPOINT ${NOT_SUPPORTED_USER_CHECKPOINT}`);
            dispatchToBlock({
              type: 'USER_CHECKPOINT_SET',
              payload: { requestId: requestId ?? '', ok: false, error: NOT_SUPPORTED_USER_CHECKPOINT },
            });
            return;
          }

          case 'APP_STORAGE_GET': {
            logOnce('app-storage', NOT_SUPPORTED_STORAGE);
            dispatchToBlock({
              type: 'APP_STORAGE_GET_RESULT',
              payload: { requestId: requestId ?? '', value: null, error: NOT_SUPPORTED_STORAGE },
            });
            return;
          }

          case 'APP_STORAGE_SET': {
            logOnce('app-storage', NOT_SUPPORTED_STORAGE);
            dispatchToBlock({
              type: 'APP_STORAGE_SET_RESULT',
              payload: { requestId: requestId ?? '', ok: false, error: NOT_SUPPORTED_STORAGE },
            });
            return;
          }

          case 'APP_STORAGE_DELETE': {
            logOnce('app-storage', NOT_SUPPORTED_STORAGE);
            dispatchToBlock({
              type: 'APP_STORAGE_DELETE_RESULT',
              payload: {
                requestId: requestId ?? '',
                ok: false,
                deleted: false,
                error: NOT_SUPPORTED_STORAGE,
              },
            });
            return;
          }

          case 'APP_STORAGE_LIST': {
            logOnce('app-storage', NOT_SUPPORTED_STORAGE);
            dispatchToBlock({
              type: 'APP_STORAGE_LIST_RESULT',
              payload: { requestId: requestId ?? '', keys: [], error: NOT_SUPPORTED_STORAGE },
            });
            return;
          }

          case 'APP_STORAGE_QUOTA': {
            logOnce('app-storage', NOT_SUPPORTED_STORAGE);
            dispatchToBlock({
              type: 'APP_STORAGE_QUOTA_RESULT',
              payload: {
                requestId: requestId ?? '',
                usedBytes: 0,
                rowCount: 0,
                limitBytes: 0,
                limitRows: 0,
                error: NOT_SUPPORTED_STORAGE,
              },
            });
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

          case 'TRACK_EVENT':
          case 'REQUEST_SIGN_IN':
          case 'REQUEST_CONSENT':
          case 'BLOCK_ERROR':
            // Log + no-op. Consent is implicit in live mode (dev-as-owner; the
            // scopes are already in the token), so there is no withhold / grant
            // round-trip and nothing to re-mint.
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
