import { LOCAL_PREVIEW_STORAGE } from './handshake.js';
import type {
  BlockContext,
  BlockInitPayload,
  BlockSettings,
  BlockToken,
  ColorDomain,
  Theme,
  ViewerInfo,
  WrappedToken,
} from './handshake.js';



/**
 * Synchronous snapshot. Before `BLOCK_INIT` every field is a sentinel empty, so
 * anything rendering UI must gate on `ready`; senders can rely on the outbound queue.
 */
export interface BlockSnapshot {
  ready: boolean;
  renderMode: 'iframe' | 'inline';
  context: BlockContext;
  token: BlockToken;
  settings: BlockSettings;
  /**
   * `null` for anonymous viewers. For identity, read `app.site.get('blocks/me')`
   * rather than this — not `site.get('me')`, which does not accept a block token.
   */
  viewer: ViewerInfo | null;
  theme: Theme;
  blockInstanceId: string;
  /**
   * The validated parent origin; `null` until init. A money-scoped bearer token
   * is sent here, so it is only ever an origin that passed the allowlist —
   * never `document.referrer`, a cross-origin `location` or anything supplied
   * by a caller.
   */
  hostOrigin: string | null;
  /** Informational only — derive SFW from `maxBrowsingLevel`, not this. */
  domain?: ColorDomain | null;
  /** Domain ceiling bitmask. `undefined` means consumers must fail closed to SFW. */
  maxBrowsingLevel?: number;
  /** The domain ceiling narrowed to this viewer. Always a subset of `maxBrowsingLevel`. */
  effectiveBrowsingLevel?: number;
  /**
   * `'local-preview'` when the host said this frame is a dev-tunnel preview with
   * no server-side storage; absent otherwise. `initialize()` reads it ONCE, so a
   * later change cannot move an app's storage between stores mid-session.
   */
  storageMode?: 'local-preview';
}


export interface RequestOptions {
  signal?: AbortSignal;
}

export interface BlockTransport {
  /** Read synchronously at render time; `subscribe` fires on every change. */
  readonly snapshot: {
    get(): BlockSnapshot;
    subscribe(listener: () => void): () => void;
  };
  /** A message the host does not answer. */
  notify(message: { type: string; payload?: unknown }): void;
  /**
   * Resolves with the value the host answered, or rejects: a `BridgeError` for a
   * failure it reported, the signal's `reason` if the caller aborts. Framing —
   * correlation ids, envelopes — is this layer's business, not a caller's.
   */
  request(type: string, params: unknown, opts?: RequestOptions): Promise<unknown>;
  /**
   * Unsolicited host pushes, already origin-checked — a caller never needs its
   * own window listener.
   */
  on(type: string, handler: (payload: unknown) => void): () => void;
}

export const EMPTY_SNAPSHOT: BlockSnapshot = {
  ready: false,
  renderMode: 'iframe',
  context: { slotId: '' },
  token: { raw: '', scopes: [], expiresAt: new Date(0) },
  settings: { publisherSettings: {}, userSettings: {} },
  viewer: null,
  theme: 'light',
  blockInstanceId: '',
  hostOrigin: null,
};



/** Convert a wire `BlockInitPayload` (ISO string expiresAt) into a `BlockSnapshot`. */
export function snapshotFromInit(payload: BlockInitPayload, hostOrigin: string): BlockSnapshot {
  return {
    ready: true,
    hostOrigin,
    renderMode: payload.renderMode,
    context: payload.context,
    token: tokenFromWrapped(payload.token),
    settings: payload.settings,
    viewer: payload.viewer,
    theme: payload.theme,
    blockInstanceId: payload.blockInstanceId,
    domain: payload.domain,
    maxBrowsingLevel: payload.maxBrowsingLevel,
    effectiveBrowsingLevel: payload.effectiveBrowsingLevel,
    // The exact string or nothing: a value this SDK does not know must read as
    // "not a local preview", which keeps today's behaviour (the real routes).
    ...(payload.storageMode === LOCAL_PREVIEW_STORAGE ? { storageMode: LOCAL_PREVIEW_STORAGE } : {}),
  };
}

/** Wire `WrappedToken` (ISO expiry) → runtime `BlockToken` (Date expiry). */
export function tokenFromWrapped(wrapped: WrappedToken): BlockToken {
  return {
    raw: wrapped.raw,
    scopes: wrapped.scopes,
    expiresAt: new Date(wrapped.expiresAt),
    buzzBudget: wrapped.buzzBudget,
    kind: wrapped.kind,
  };
}
