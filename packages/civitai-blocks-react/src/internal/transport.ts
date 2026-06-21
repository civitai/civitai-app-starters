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
  /** `null` for anonymous viewers, matching `BlockInitPayload.viewer`. */
  viewer: ViewerInfo | null;
  theme: Theme;
  blockInstanceId: string;
  blockId: string;
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
