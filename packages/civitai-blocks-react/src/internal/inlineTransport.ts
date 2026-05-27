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

  constructor() {
    const bootstrap = (globalThis as { window?: Window }).window?.__CIVITAI_BLOCK_CONTEXT__;
    this.snapshot = bootstrap ? snapshotFromInit(bootstrap) : EMPTY_SNAPSHOT;
  }

  getSnapshot(): BlockSnapshot {
    return this.snapshot;
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
}
