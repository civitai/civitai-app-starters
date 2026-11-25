import { ERROR_REPORTS_CAPABILITY, LOCAL_PREVIEW_STORAGE } from './handshake.js';
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
  /**
   * Where the document store is served when the host moved this app to the app-data service;
   * absent otherwise (every other app, and a host that predates it). `initialize()` reads it ONCE,
   * so a later change cannot move an app's storage between services mid-session.
   */
  appData?: AppDataService;
  /**
   * `true` when the host listed {@link ERROR_REPORTS_CAPABILITY} in
   * `BLOCK_INIT.capabilities`: it collects this frame's non-fatal errors (a
   * moderator's review preview). Absent otherwise. `initialize()` reads it ONCE.
   */
  errorReports?: true;
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



/**
 * Did the host mark this frame a dev-tunnel preview whose document store is
 * served locally? THE predicate for that question. `initialize()` reads it once
 * and the one latched answer selects the local document store AND tells the
 * host session which scopes no grant can add (`requestGrants`), so the two
 * cannot disagree. Never inferred from `token.scopes`: a published app whose
 * token lacks `apps:storage` looks the same as a preview's.
 */
export function isLocalPreviewStorage(snapshot: Pick<BlockSnapshot, 'storageMode'>): boolean {
  return snapshot.storageMode === LOCAL_PREVIEW_STORAGE;
}

/**
 * Did the host ask for this frame's non-fatal errors? THE predicate for it:
 * true on a dev-tunnel preview (`storageMode`, which older hosts send alone)
 * and wherever the host listed {@link ERROR_REPORTS_CAPABILITY} (a review
 * preview). Never inferred from the token or the URL.
 */
export function hostCollectsErrors(snapshot: Pick<BlockSnapshot, 'storageMode' | 'errorReports'>): boolean {
  return isLocalPreviewStorage(snapshot) || snapshot.errorReports === true;
}

/** `BLOCK_INIT.appData`, validated: the app-data service that serves this app's document store. */
export interface AppDataService {
  /** The service's base URL: `https:`, no credentials, query or fragment. */
  url: string;
  /** The app's blockId, as the service names apps in its routes. */
  slug: string;
}

/** The service's own slug grammar (an app's blockId). */
const APP_DATA_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * THE predicate for `BLOCK_INIT.appData`: the exact `{ url, slug }` shape, copied by field, or
 * `undefined`. Anything else — another shape, a URL that is not plain `https:`, a slug outside the
 * service's grammar — reads as absent, which keeps the site's routes.
 */
export function readAppDataService(value: unknown): AppDataService | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { url, slug } = value as Record<string, unknown>;
  if (typeof url !== 'string' || typeof slug !== 'string' || !APP_DATA_SLUG.test(slug)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    return undefined;
  }
  if (url.includes('?') || url.includes('#')) return undefined;
  return { url, slug };
}

/** Convert a wire `BlockInitPayload` (ISO string expiresAt) into a `BlockSnapshot`. */
export function snapshotFromInit(payload: BlockInitPayload, hostOrigin: string): BlockSnapshot {
  const appData = readAppDataService(payload.appData);
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
    // The exact shape or nothing, as above: absent keeps the site's storage routes.
    ...(appData ? { appData } : {}),
    // An array holding the exact string, or nothing: any other shape reads as
    // "this host does not collect them", which keeps today's behaviour.
    ...(Array.isArray(payload.capabilities) && payload.capabilities.includes(ERROR_REPORTS_CAPABILITY)
      ? { errorReports: true as const }
      : {}),
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
