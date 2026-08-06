import type {
  BlockContext,
  BlockInitPayload,
  BlockSettings,
  BlockToken,
  ColorDomain,
  Theme,
  ViewerInfo,
  WrappedToken,
  ParentToBlockMessage,
  ParentToBlockMessageType,
  BlockToParentMessage,
  BlockToParentMessageType,
} from '@civitai/app-sdk/blocks';

/**
 * Synchronous snapshot the hooks read via `useSyncExternalStore`.
 *
 * Before `BLOCK_INIT` lands, `ready === false`, `viewer === null`, and the
 * per-field values are sentinel empties. Hooks that render UI must gate on
 * `ready`; non-UI hooks (e.g. `useBuzzWorkflow`) rely on the outbound queue
 * in `IframeTransport` instead of gating.
 */
export interface BlockSnapshot {
  ready: boolean;
  renderMode: 'iframe' | 'inline';
  context: BlockContext;
  token: BlockToken;
  settings: BlockSettings;
  /**
   * `null` for anonymous viewers, matching `BlockInitPayload.viewer`.
   *
   * Read `viewer?.signedIn` (or the equivalent `viewer !== null`) for the
   * sign-in gate; `viewer.id` / `viewer.username` are @deprecated init-time
   * identity disclosure — use `useViewer()` for identity.
   */
  viewer: ViewerInfo | null;
  theme: Theme;
  blockInstanceId: string;
  /**
   * @deprecated Your block's `blockId` is in its own `block.manifest.json` at
   * build time; receiving it again at init is parity surface. Still delivered —
   * see `BlockInitPayload.blockId` for why it cannot simply come off the wire.
   */
  blockId: string;
  /** @deprecated Build-time identity. See `BlockInitPayload.appId`. */
  appId: string;
  /**
   * The color-domain the host projected at init (`green`|`blue`|`red`), or
   * `null`/`undefined` when absent (anon read, or a host predating PR #2670).
   * Informational only — `useDomainMaturity` derives SFW from
   * `maxBrowsingLevel`, not this. Sentinel-`undefined` before `BLOCK_INIT`.
   */
  domain?: ColorDomain | null;
  /**
   * Authoritative domain browsing-level ceiling bitmask from `BLOCK_INIT`.
   * `undefined` before init / when the host doesn't send it → consumers
   * fail-closed to SFW.
   */
  maxBrowsingLevel?: number;
}

/**
 * Outbound message shape, without the auto-assigned `requestId` field.
 * Callers of `sendRequest` describe the message they want sent; the transport
 * appends the `requestId`.
 */
export type OutboundRequest = {
  [K in BlockToParentMessageType]: Extract<BlockToParentMessage, { type: K }> extends {
    payload: { requestId: string };
  }
    ? {
        type: K;
        payload: Omit<Extract<BlockToParentMessage, { type: K }>['payload'], 'requestId'>;
      }
    : never;
}[BlockToParentMessageType];

/**
 * Contract every transport (iframe v1, inline v2) implements. Hooks consume
 * this through the singleton in `./singleton.ts` so block apps stay unaware
 * of which path is active.
 *
 * Messages flow as full discriminated-union values rather than (type, payload)
 * tuples — this avoids generic-variance pitfalls when the implementation
 * has to widen back to the union.
 *
 * `sendRequest` here is intentionally untyped on the return; the typed view
 * lives in the free function {@link sendTypedRequest}. Putting the generic
 * on a free wrapper sidesteps the "interface method with generic return
 * depending on a parameter" variance problem (TS can't prove `Promise<Extract<..., TRes>>`
 * covariance across implementations).
 */
export interface BlockTransport {
  /** Current snapshot; cheap to call (no allocation). */
  getSnapshot(): BlockSnapshot;
  /**
   * The validated host (parent) origin a block may safely direct-fetch the
   * civitai App Blocks HTTP API against — `null` until the transport has
   * established it (iframe: the first allowlist-passing `BLOCK_INIT`; inline:
   * bootstrap present).
   *
   * SECURITY INVARIANT — the whole point of this accessor: it MUST return
   * ONLY an origin that passed the same trust gate every inbound message
   * passes (the iframe `OriginMatcher` allowlist / the inline same-origin
   * host). It must NEVER be derived from `document.referrer`, `window.location`
   * of a cross-origin parent, an unvalidated `event.origin`, or any
   * caller-supplied value. The returned origin becomes the base URL a
   * money-scoped block bearer token (`useBlockToken().raw`) is sent to, so
   * returning an unvalidated origin would be a token-exfiltration vector.
   */
  getHostOrigin(): string | null;
  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Fire-and-forget message to the peer. */
  sendMessage(message: BlockToParentMessage): void;
  /** Untyped — use {@link sendTypedRequest} for the type-narrowed view. */
  sendRequest(
    request: OutboundRequest,
    responseType: ParentToBlockMessageType,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
  /**
   * Subscribe to an UNSOLICITED parent→block push of a given type — one the host
   * initiates on its own schedule rather than as a reply to a `sendRequest`
   * (e.g. `IMAGE_SCAN_RESOLVED`). The handler runs ONLY after the same trust gate
   * every inbound message passes (origin allowlist + payload validator), so a
   * hook never has to add its own `window` message listener and bypass the
   * boundary. Returns an unsubscribe function.
   *
   * Untyped on the payload here for the same variance reason `sendRequest` is —
   * use the free wrapper {@link subscribeTyped} for the type-narrowed view.
   */
  onMessage(
    type: ParentToBlockMessageType,
    handler: (payload: unknown) => void,
  ): () => void;
}

/**
 * Type-safe wrapper around `transport.sendRequest`. Hooks always go through
 * this so the response payload narrows based on `responseType`.
 *
 * Implemented as `async` + `await` instead of a single `as` cast: `Promise<T>`
 * is invariant in `T`, so casting `Promise<unknown>` directly to
 * `Promise<Extract<..., TRes>>` trips TS variance checking. Awaiting first
 * yields a plain `unknown` we can cast synchronously, and the `async` keyword
 * re-wraps it in the correctly-typed Promise.
 */
export async function sendTypedRequest<TRes extends ParentToBlockMessageType>(
  transport: BlockTransport,
  request: OutboundRequest,
  responseType: TRes,
  opts?: { timeoutMs?: number },
): Promise<Extract<ParentToBlockMessage, { type: TRes }>['payload']> {
  const payload = await transport.sendRequest(request, responseType, opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- variance escape; see fn jsdoc
  return payload as any;
}

/**
 * Type-safe wrapper around `transport.onMessage`. Hooks that consume an
 * unsolicited parent→block push (e.g. `IMAGE_SCAN_RESOLVED`) go through this so
 * the handler's payload narrows to the message type. Mirrors
 * {@link sendTypedRequest}'s variance-escape pattern.
 */
export function subscribeTyped<TType extends ParentToBlockMessageType>(
  transport: BlockTransport,
  type: TType,
  handler: (payload: Extract<ParentToBlockMessage, { type: TType }>['payload']) => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- variance escape; see fn jsdoc
  return transport.onMessage(type, handler as (payload: any) => void);
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
  blockId: '',
  appId: '',
};

/**
 * Layer a resolved `theme` onto a slot context WITHOUT inventing the field on a
 * context that has no place for it.
 *
 * Both dev hosts (`createMockHost`, `createLiveHost`) forward the theme twice —
 * top-level on `BLOCK_INIT` and, where the slot carries it, inside `context` —
 * mirroring what the real host does. This is the second half.
 *
 * The `'theme' in ctx` test is what keeps that honest, and it is the same test
 * `IframeTransport.applyThemeChange` uses on a `THEME_CHANGE` push, so the
 * init-time and push-time paths agree. It matters more since `BlockContext`
 * became a discriminated union: {@link UnknownSlotContext} — the arm for a slot
 * this SDK has no shape for — carries `slotId` and NOTHING else, so blindly
 * spreading a `theme` onto it would fabricate a field the host never sent, on
 * precisely the contexts the SDK understands least. Under v1's index signature
 * that was silent and untypeable; now it is a compile error, which is how this
 * helper came to exist.
 */
export function withContextTheme(ctx: BlockContext, theme: Theme): BlockContext {
  if (!('theme' in ctx)) return ctx;
  return { ...ctx, theme };
}

/** Convert a wire `BlockInitPayload` (ISO string expiresAt) into a `BlockSnapshot`. */
export function snapshotFromInit(payload: BlockInitPayload): BlockSnapshot {
  return {
    ready: true,
    renderMode: payload.renderMode,
    context: payload.context,
    token: tokenFromWrapped(payload.token),
    settings: payload.settings,
    viewer: payload.viewer,
    theme: payload.theme,
    blockInstanceId: payload.blockInstanceId,
    blockId: payload.blockId,
    appId: payload.appId,
    domain: payload.domain,
    maxBrowsingLevel: payload.maxBrowsingLevel,
  };
}

/**
 * Rehydrate a wire `WrappedToken` (ISO `expiresAt`) into the runtime
 * `BlockToken` shape (`Date` `expiresAt`). Shared by `snapshotFromInit`
 * and the `TOKEN_REFRESH` / `TOKEN_REFRESH_RESPONSE` handlers so the
 * snapshot's token always reflects every wrapped field — `scopes` and
 * `buzzBudget` included — not just `raw`/`expiresAt`.
 */
export function tokenFromWrapped(wrapped: WrappedToken): BlockToken {
  return {
    raw: wrapped.raw,
    scopes: wrapped.scopes,
    expiresAt: new Date(wrapped.expiresAt),
    buzzBudget: wrapped.buzzBudget,
  };
}

let requestIdCounter = 0;
/**
 * Monotonic request ID with a random prefix so concurrent block instances
 * sharing the dev console don't collide in logs.
 */
export function nextRequestId(): string {
  requestIdCounter += 1;
  return `${Math.random().toString(36).slice(2, 8)}-${requestIdCounter}`;
}

/**
 * A collision-resistant IDEMPOTENCY key for a money POST (workflow submit / tip).
 * Distinct from `nextRequestId` (a per-message correlation id that is regenerated
 * on every retry): an idempotency key must be STABLE across the retry of one
 * logical operation, so the caller generates it ONCE and reuses it. Prefers the
 * platform `crypto.randomUUID()` (strong, unguessable); falls back to a random
 * string where it is unavailable (older webviews / non-secure contexts / test).
 */
export function generateIdempotencyKey(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}
