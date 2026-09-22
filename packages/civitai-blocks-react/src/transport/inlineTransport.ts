// v2 stub. Reads bootstrap state from `window.__CIVITAI_BLOCK_CONTEXT__`;
// not wired to any real platform path in v1. Lives here so `BlockTransportDetector`
// can branch and so the public hook surface is identical between modes.
//
// Intentionally minimal: tests verify only that the detector picks this when
// bootstrap is present. The full implementation lands with v2 inline mode.
//
// TODO(v2 trust boundary): inline mode currently reads the bootstrap object
// directly from the host's window without origin or shape validation — the
// equivalent of `IframeTransport`'s `allowedParentOrigins` + `payloadValidatorFor`
// gates. v1 impact is bounded because `sendMessage` / `sendRequest` are no-ops
// here, but the v2 implementation must add an equivalent trust boundary
// (e.g. validate the bootstrap shape with `isValidBlockInitPayload` from
// `./validate.ts` before constructing the snapshot, and document any
// host-cooperation contract that takes the place of origin allowlisting).

import type {
  BlockToParentMessage,
  ParentToBlockMessageType,
} from '@civitai/app-sdk/blocks';

import {
  EMPTY_SNAPSHOT,
  snapshotFromInit,
  type BlockSnapshot,
  type BlockTransport,
  type OutboundRequest,
} from './transport.js';

declare global {
  interface Window {
    __CIVITAI_BLOCK_CONTEXT__?: import('@civitai/app-sdk/blocks').BlockInitPayload;
  }
}

export class InlineTransport implements BlockTransport {
  private snapshot: BlockSnapshot;
  private readonly hostOrigin: string | null;

  constructor() {
    const win = (globalThis as { window?: Window }).window;
    const bootstrap = win?.__CIVITAI_BLOCK_CONTEXT__;
    this.snapshot = bootstrap ? snapshotFromInit(bootstrap) : EMPTY_SNAPSHOT;
    // SECURITY INVARIANT — mirrors IframeTransport.getHostOrigin(): the value
    // returned here is only ever a trusted host origin. In inline mode the
    // block executes INSIDE the host's own document (the host injected
    // `__CIVITAI_BLOCK_CONTEXT__` on its own window), so there is no
    // cross-origin trust boundary and `window.location.origin` IS the host
    // origin by construction — it is the origin the host page is served from,
    // not a spoofable signal like `document.referrer`. Gated on bootstrap
    // presence so the accessor stays `null` until inline init, matching the
    // iframe contract. It becomes the base URL a money-scoped bearer token is
    // sent to, so it must never be derived from any caller-supplied value.
    this.hostOrigin = bootstrap ? (win?.location?.origin ?? null) : null;
  }

  getSnapshot(): BlockSnapshot {
    return this.snapshot;
  }

  /**
   * The host origin — `null` until an inline bootstrap is present. See the
   * constructor's SECURITY INVARIANT note for why `window.location.origin` is
   * the trusted host origin in inline (same-document) mode.
   */
  getHostOrigin(): string | null {
    return this.hostOrigin;
  }

  subscribe(_listener: () => void): () => void {
    return () => {};
  }

  sendMessage(_message: BlockToParentMessage): void {
    // v2 will invoke platform APIs directly; intentional no-op in v1.
  }

  sendRequest(
    _request: OutboundRequest,
    _responseType: ParentToBlockMessageType,
    _opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    return Promise.reject(new Error('InlineTransport.sendRequest is not implemented in v1'));
  }

  onMessage(
    _type: ParentToBlockMessageType,
    _handler: (payload: unknown) => void,
  ): () => void {
    // v1 inline mode receives no host pushes (sendMessage/sendRequest are no-ops
    // too); the full implementation lands with v2 inline mode.
    return () => {};
  }
}
