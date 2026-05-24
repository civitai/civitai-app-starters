import {
  isMessage,
  type BlockInitPayload,
  type BlockToParentMessage,
  type ParentToBlockMessage,
  type ParentToBlockMessageType,
} from '@civitai/app-sdk/blocks';

import {
  EMPTY_SNAPSHOT,
  nextRequestId,
  snapshotFromInit,
  tokenFromWrapped,
  type BlockSnapshot,
  type BlockTransport,
  type OutboundRequest,
} from './transport.js';
import { payloadValidatorFor } from './validate.js';

import type { WrappedToken } from '@civitai/app-sdk/blocks';

const INIT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface IframeTransportOptions {
  /**
   * Origins from which `BLOCK_INIT` (and any other inbound message) is
   * accepted. MUST contain at least one entry. Messages from any other
   * origin — including the local origin — are dropped silently.
   *
   * Typically wired from `import.meta.env.VITE_BLOCK_ALLOWED_PARENT_ORIGINS`
   * (or the framework's equivalent) at block-app startup.
   */
  allowedParentOrigins: string[];
  /** Override for tests / SSR. Defaults to `globalThis.window`. */
  window?: Window;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  responseType: ParentToBlockMessageType;
}

/**
 * Iframe-mode transport. Validates `event.origin` on every inbound message,
 * awaits `BLOCK_INIT` with a 10s timeout (after which `waitForInit` rejects
 * — the host shows a fallback), queues outbound messages until init, and
 * correlates request/response pairs by `requestId`.
 */
export class IframeTransport implements BlockTransport {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly window: Window;

  private snapshot: BlockSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  /** Origin of the parent — captured from the first valid `BLOCK_INIT`. */
  private parentOrigin: string | null = null;

  /** Messages queued before `BLOCK_INIT` lands. Flushed in arrival order. */
  private readonly outbound: Array<{ type: string; payload: unknown }> = [];
  private readonly pending = new Map<string, PendingRequest>();

  private readonly initPromise: Promise<BlockInitPayload>;
  private resolveInit!: (payload: BlockInitPayload) => void;
  private rejectInit!: (err: Error) => void;
  private initTimeoutId: ReturnType<typeof setTimeout>;
  private initResolved = false;

  private readonly messageListener: (event: MessageEvent) => void;

  constructor(opts: IframeTransportOptions) {
    if (!opts.allowedParentOrigins.length) {
      throw new Error(
        'IframeTransport: allowedParentOrigins must contain at least one entry. ' +
          'Configure NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS (or the framework equivalent).',
      );
    }
    this.allowedOrigins = new Set(opts.allowedParentOrigins);
    this.window = opts.window ?? (globalThis as { window?: Window }).window!;
    if (!this.window) {
      throw new Error('IframeTransport: no window available; cannot mount on the server.');
    }

    this.initPromise = new Promise<BlockInitPayload>((resolve, reject) => {
      this.resolveInit = resolve;
      this.rejectInit = reject;
    });
    this.initTimeoutId = setTimeout(() => {
      if (!this.initResolved) {
        this.initResolved = true;
        this.rejectInit(
          new Error(
            `IframeTransport: timed out waiting for BLOCK_INIT after ${INIT_TIMEOUT_MS}ms. ` +
              'Verify the host frame is sending the init message and that its origin is in allowedParentOrigins.',
          ),
        );
      }
    }, INIT_TIMEOUT_MS);

    this.messageListener = (event) => this.handleMessage(event);
    this.window.addEventListener('message', this.messageListener);
  }

  getSnapshot(): BlockSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  waitForInit(): Promise<BlockInitPayload> {
    return this.initPromise;
  }

  sendMessage(message: BlockToParentMessage): void {
    this.dispatch(message.type, message.payload);
  }

  sendRequest(
    request: OutboundRequest,
    responseType: ParentToBlockMessageType,
    opts: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const requestId = nextRequestId();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(new Error(`IframeTransport: request "${request.type}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve,
        reject,
        timeoutId,
        responseType,
      });
      this.dispatch(request.type, { ...request.payload, requestId });
    });
  }

  /** Test-only: tear down listeners + reject pending. */
  dispose(): void {
    this.window.removeEventListener('message', this.messageListener);
    clearTimeout(this.initTimeoutId);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('IframeTransport disposed'));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  private dispatch(type: string, payload: unknown): void {
    if (!this.parentOrigin) {
      this.outbound.push({ type, payload });
      return;
    }
    this.postToParent({ type, payload });
  }

  private flushOutbound(): void {
    while (this.outbound.length) {
      const msg = this.outbound.shift()!;
      this.postToParent(msg);
    }
  }

  private postToParent(msg: { type: string; payload: unknown }): void {
    // `parentOrigin` is captured from a validated BLOCK_INIT; safe to use as targetOrigin.
    this.window.parent.postMessage(msg, this.parentOrigin!);
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.allowedOrigins.has(event.origin)) return;
    const data = event.data as { type?: unknown; payload?: unknown };
    if (data == null || typeof data !== 'object' || typeof data.type !== 'string') return;

    // Trust-boundary shape check. `isMessage` only narrows on `type`;
    // anything that reaches state-mutating code below must pass the
    // payload validator for its type. Failures drop with a console.warn
    // rather than crash — see ./validate.ts.
    const validator = payloadValidatorFor(data.type);
    if (validator && !validator(data.payload)) {
      // eslint-disable-next-line no-console -- developer-facing diagnostic at a trust boundary
      console.warn(
        `IframeTransport: dropping malformed "${data.type}" message from ${event.origin}`,
      );
      return;
    }

    if (isMessage<ParentToBlockMessage, 'BLOCK_INIT'>(data, 'BLOCK_INIT')) {
      if (!this.initResolved) {
        this.initResolved = true;
        clearTimeout(this.initTimeoutId);
        this.parentOrigin = event.origin;
        this.snapshot = snapshotFromInit(data.payload);
        this.emit();
        this.flushOutbound();
        // Auto-send BLOCK_READY so the platform's 10-second ready timeout
        // doesn't trigger a fallback. We send height: 0 as a placeholder;
        // useBlockResize takes over with real measurements as soon as the
        // block's root element mounts. Queued because the iframe's React
        // tree hasn't rendered yet at this point — the postMessage goes
        // out on the next microtask via the standard dispatch path.
        this.dispatch('BLOCK_READY', { height: 0 });
        this.resolveInit(data.payload);
      }
      return;
    }

    // Host-pushed token rotation (no requestId). Always apply to the
    // snapshot; never matches a pending request.
    if (isMessage<ParentToBlockMessage, 'TOKEN_REFRESH'>(data, 'TOKEN_REFRESH')) {
      this.applyTokenRefresh(data.payload.token);
      return;
    }

    // For request/response replies, look up the pending entry by `requestId`.
    const payload = data.payload as { requestId?: unknown } | undefined;
    let pending: PendingRequest | undefined;
    let matchedRequestId: string | null = null;
    if (payload && typeof payload.requestId === 'string') {
      const candidate = this.pending.get(payload.requestId);
      if (candidate && candidate.responseType === data.type) {
        pending = candidate;
        matchedRequestId = payload.requestId;
      }
    }

    // TOKEN_REFRESH_RESPONSE updates the snapshot whether or not the
    // requestId matched a pending entry — the platform's IframeHost.tsx
    // can answer with an empty requestId on its own schedule. Apply
    // BEFORE resolving so awaiting code (and the useBlockToken effect
    // re-firing on token.expiresAt) sees the new value.
    if (isMessage<ParentToBlockMessage, 'TOKEN_REFRESH_RESPONSE'>(data, 'TOKEN_REFRESH_RESPONSE')) {
      this.applyTokenRefresh(data.payload.token);
    }

    if (pending && matchedRequestId !== null) {
      clearTimeout(pending.timeoutId);
      this.pending.delete(matchedRequestId);
      pending.resolve(payload);
      return;
    }

    if (isMessage<ParentToBlockMessage, 'SUSPEND'>(data, 'SUSPEND')) {
      // Reserved for future lifecycle hooks; no-op in v1.
      return;
    }
    if (isMessage<ParentToBlockMessage, 'RESUME'>(data, 'RESUME')) {
      return;
    }
  }

  private applyTokenRefresh(wrapped: WrappedToken): void {
    // Replace the whole token — scopes and buzzBudget can change at refresh
    // time (e.g. a manifest update altered the buzz budget). Carrying the
    // wrapped value end-to-end avoids the bug class where the snapshot's
    // expiresAt updated but scopes stayed stale.
    this.snapshot = { ...this.snapshot, token: tokenFromWrapped(wrapped) };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
