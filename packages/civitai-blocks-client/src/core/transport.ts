import type {
  BlockContext,
  BlockInitPayload,
  BlockSettings,
  BlockToken,
  ColorDomain,
  Theme,
  ViewerInfo,
  WrappedToken,
  BlockToParentMessage,
} from '@civitai/app-sdk/blocks';



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
  /** `null` for anonymous viewers. For identity, request it rather than reading it here. */
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
}


/**
 * How a message answers. `legacy` is the framing the host had before this
 * package owned the protocol; it is declared per message by the domain that
 * still speaks it, and the transport converts it to the other one.
 */
export type ReplyFraming = 'envelope' | 'legacy';

export interface RequestOptions {
  signal?: AbortSignal;
  replies?: ReplyFraming;
}

export interface BlockTransport {
  /** Read synchronously at render time; `subscribe` fires on every change. */
  readonly snapshot: {
    get(): BlockSnapshot;
    subscribe(listener: () => void): () => void;
  };
  /** A message the host does not answer. */
  notify(message: BlockToParentMessage): void;
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
  };
}

/** Wire `WrappedToken` (ISO expiry) → runtime `BlockToken` (Date expiry). */
export function tokenFromWrapped(wrapped: WrappedToken): BlockToken {
  return {
    raw: wrapped.raw,
    scopes: wrapped.scopes,
    expiresAt: new Date(wrapped.expiresAt),
    buzzBudget: wrapped.buzzBudget,
  };
}
