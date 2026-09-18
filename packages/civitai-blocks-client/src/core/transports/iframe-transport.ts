import {
  isMessage,
  parseBlockInitFragment,
  stripBlockInitFragment,
  type BlockToParentMessage,
  type ParentToBlockMessage,
  type WrappedToken,
} from '@civitai/app-sdk/blocks';

import {
  EMPTY_SNAPSHOT,
  snapshotFromInit,
  tokenFromWrapped,
  type BlockSnapshot,
  type BlockTransport,
} from '../transport.js';
import { BridgeError, type BridgeFailureCode } from '../errors.js';
import { OriginMatcher } from '../origin-matcher.js';

/**
 * How this bridge frames one call: a correlation id, and a result or a failure.
 * None of it reaches a caller, and another transport would carry none of it —
 * an HTTP response is its own correlation and its status is its failure.
 */
interface Envelope<T> {
  requestId: string;
  result?: T;
  error?: { code: BridgeFailureCode; message: string };
}

function replyTypeFor(type: string): string {
  return `${type}_RESULT`;
}

/** Turns a reply into the value it carries, or the failure it reports. */
function unwrap(type: string, reply: unknown): unknown {
  const envelope = reply as Envelope<unknown> | undefined;

  if (envelope?.error !== undefined) {
    throw new BridgeError(envelope.error.code, type, envelope.error.message || `${type} failed`);
  }
  if (envelope?.result === undefined) {
    throw new BridgeError('malformed', type, `${type} reply carried no result`);
  }
  return envelope.result;
}

let requestIdCounter = 0;
/**
 * Monotonic request ID with a random prefix so concurrent block instances
 * sharing the dev console don't collide in logs.
 */
function nextRequestId(): string {
  requestIdCounter += 1;
  return `${Math.random().toString(36).slice(2, 8)}-${requestIdCounter}`;
}

export interface IframeTransportOptions {
  /** At least one entry. Other origins — including the local one — drop silently. */
  allowedParentOrigins: string[];
  /** Override for tests / SSR. Defaults to `globalThis.window`. */
  window?: Window;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: unknown) => void;
  detach: () => void;
  responseType: string;
}

/**
 * Validates `event.origin` on every inbound message, queues outbound until
 * `BLOCK_INIT`, and correlates replies by `requestId`.
 */
export class IframeTransport implements BlockTransport {
  #originMatcher: OriginMatcher;
  /** A wildcard entry is not a concrete origin, so it cannot be a `targetOrigin`. */
  #exactAllowedOrigins: readonly string[];
  #window: Window;

  #snapshot: BlockSnapshot = EMPTY_SNAPSHOT;
  #listeners = new Set<() => void>();

  readonly snapshot = {
    get: () => this.#snapshot,
    subscribe: (listener: () => void) => {
      this.#listeners.add(listener);
      return () => this.#listeners.delete(listener);
    },
  };

  /** Origin of the parent — captured from the first valid `BLOCK_INIT`. */
  #parentOrigin: string | null = null;

  /** Messages queued before `BLOCK_INIT` lands. Flushed in arrival order. */
  #outbound: Array<{ type: string; payload: unknown }> = [];
  #pending = new Map<string, PendingRequest>();

  /**
   * Handlers for UNSOLICITED parent→block pushes (e.g. `IMAGE_SCAN_RESOLVED`) —
   * messages the host initiates on its own schedule, NOT replies to a pending
   * `request`. Keyed by message type; each entry a set of subscribers.
   */
  #pushListeners = new Map<string, Set<(payload: unknown) => void>>();

  /** Latches on the first `BLOCK_INIT`; the host re-posts it until it sees `BLOCK_READY`. */
  #initResolved = false;

  #messageListener: (event: MessageEvent) => void;

  constructor(opts: IframeTransportOptions) {
    if (!opts.allowedParentOrigins.length) {
      throw new Error(
        'IframeTransport: allowedParentOrigins must contain at least one entry. ' +
          'Configure NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS (or the framework equivalent).',
      );
    }
    this.#originMatcher = new OriginMatcher(opts.allowedParentOrigins);
    this.#exactAllowedOrigins = opts.allowedParentOrigins
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.includes('*'));
    this.#window = opts.window ?? (globalThis as { window?: Window }).window!;
    if (!this.#window) {
      throw new Error('IframeTransport: no window available; cannot mount on the server.');
    }

    // Seeds theme/renderMode/blockInstanceId before the listener attaches, so a
    // racing BLOCK_INIT finds them. `ready` stays false and nothing secret is
    // ever sourced from the URL.
    this.#seedFromFragment();

    this.#messageListener = (event) => this.#handleMessage(event);
    this.#window.addEventListener('message', this.#messageListener);

    // Must follow addEventListener: a host that answers synchronously would
    // otherwise post into a frame with no listener. Best-effort — the host still
    // retries on its own.
    this.#announceReady();
  }

  /** No-op when absent, foreign or an unknown version — we then just await BLOCK_INIT. */
  #seedFromFragment(): void {
    let hash: string | undefined;
    try {
      hash = this.#window.location?.hash;
    } catch {
      // A location read can throw in exotic embeddings; the fast path is
      // optional, so degrade to "no fragment".
      return;
    }

    const fragment = parseBlockInitFragment(hash);
    if (
      fragment.theme === undefined &&
      fragment.renderMode === undefined &&
      fragment.blockInstanceId === undefined
    ) {
      return;
    }

    this.#snapshot = {
      ...this.#snapshot,
      ...(fragment.theme !== undefined ? { theme: fragment.theme } : {}),
      ...(fragment.renderMode !== undefined ? { renderMode: fragment.renderMode } : {}),
      ...(fragment.blockInstanceId !== undefined
        ? { blockInstanceId: fragment.blockInstanceId }
        : {}),
    };

    // Cosmetic only, so a sandbox rejecting replaceState is swallowed.
    try {
      const remainder = stripBlockInitFragment(hash);
      if (remainder !== null) {
        const loc = this.#window.location;
        const base = `${loc.pathname}${loc.search}`;
        this.#window.history.replaceState(
          this.#window.history.state,
          '',
          remainder.length > 0 ? `${base}#${remainder}` : base,
        );
      }
    } catch {
      // Sandboxed opaque origin, or no History API. Nothing depends on this.
    }
  }

  /**
   * Aimed at each exact allowlist entry, since `parentOrigin` is not yet known.
   * Falls back to `'*'` only for a wildcard-only allowlist, which is safe here
   * solely because the message carries no payload.
   */
  #announceReady(): void {
    let parent: Window;
    try {
      parent = this.#window.parent;
      // Not framed (or self-framed) — nobody to announce to.
      if (!parent || parent === this.#window) return;
    } catch {
      return;
    }

    const targets = this.#exactAllowedOrigins.length > 0 ? this.#exactAllowedOrigins : ['*'];
    for (const target of targets) {
      try {
        parent.postMessage({ type: 'BLOCK_HELLO' } satisfies BlockToParentMessage, target);
      } catch {
        // An unreachable/mismatched target throws nothing in practice; guard
        // anyway so one bad allowlist entry can't abort the remaining posts.
      }
    }
  }

  notify(message: BlockToParentMessage): void {
    this.#dispatch(message.type, message.payload);
  }

  async request(
    type: string,
    params: unknown,
    opts: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    return unwrap(type, await this.#exchange(type, params, opts));
  }

  #exchange(
    type: string,
    params: unknown,
    opts: { signal?: AbortSignal },
  ): Promise<unknown> {
    const responseType = replyTypeFor(type);
    const { signal } = opts;
    if (signal?.aborted) return Promise.reject(signal.reason);

    const requestId = nextRequestId();
    // The reply name is derived once, in `envelope.ts`; at runtime the same
    // pairing is enforced by matching `responseType` on arrival.
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = () => {
        if (this.#pending.delete(requestId)) reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(requestId, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        detach: () => signal?.removeEventListener('abort', onAbort),
        responseType,
      });
      this.#dispatch(type, { ...(params as object), requestId });
    });
  }

  on(type: string, handler: (payload: unknown) => void): () => void {
    let set = this.#pushListeners.get(type);
    if (!set) {
      set = new Set();
      this.#pushListeners.set(type, set);
    }
    set.add(handler);
    return () => {
      const s = this.#pushListeners.get(type);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.#pushListeners.delete(type);
    };
  }

  /** Test-only: tear down listeners + reject pending. */
  dispose(): void {
    this.#window.removeEventListener('message', this.#messageListener);
    for (const pending of this.#pending.values()) {
      pending.detach();
      pending.reject(new Error('IframeTransport disposed'));
    }
    this.#pending.clear();
    this.#listeners.clear();
    this.#pushListeners.clear();
  }

  #dispatch(type: string, payload: unknown): void {
    if (!this.#parentOrigin) {
      this.#outbound.push({ type, payload });
      return;
    }
    this.#postToParent({ type, payload });
  }

  #flushOutbound(): void {
    while (this.#outbound.length) {
      const msg = this.#outbound.shift()!;
      this.#postToParent(msg);
    }
  }

  #postToParent(msg: { type: string; payload: unknown }): void {
    // `parentOrigin` is captured from a validated BLOCK_INIT; safe to use as targetOrigin.
    this.#window.parent.postMessage(msg, this.#parentOrigin!);
  }

  #handleMessage(event: MessageEvent): void {
    if (!this.#originMatcher.matches(event.origin)) return;
    const data = event.data as { type?: unknown; payload?: unknown };
    if (data == null || typeof data !== 'object' || typeof data.type !== 'string') return;

    if (isMessage<ParentToBlockMessage, 'BLOCK_INIT'>(data, 'BLOCK_INIT')) {
      if (!this.#initResolved) {
        // Build before latching: a throw here must leave the transport exactly as
        // it was, so the host's re-post can still heal it.
        const snapshot = snapshotFromInit(data.payload, event.origin);
        this.#initResolved = true;
        this.#parentOrigin = event.origin;
        this.#snapshot = snapshot;
        this.#emit();
        this.#flushOutbound();
        // height 0 is a placeholder; the real measurement follows once the app mounts.
        this.#dispatch('BLOCK_READY', { height: 0 });
      }
      return;
    }

    // Host-pushed token rotation (no requestId). Always apply to the
    // snapshot; never matches a pending request.
    if (isMessage<ParentToBlockMessage, 'TOKEN_REFRESH'>(data, 'TOKEN_REFRESH')) {
      this.#applyTokenRefresh(data.payload.token);
      return;
    }

    // Not gated on init: a pre-init push is still the freshest value, and it
    // cannot half-init anything because BLOCK_INIT replaces the snapshot wholesale.
    if (isMessage<ParentToBlockMessage, 'THEME_CHANGE'>(data, 'THEME_CHANGE')) {
      this.#applyThemeChange(data.payload.theme);
      return;
    }

    // Matching the TYPE too, not just the id: `IMAGE_SCAN_RESOLVED` is a push
    // that deliberately reuses its `OPEN_IMAGE_UPLOAD`'s requestId, so an
    // id-only match could resolve the upload with the scan verdict's payload.
    const payload = data.payload as { requestId?: unknown } | undefined;
    let pending: PendingRequest | undefined;
    let matchedRequestId: string | null = null;
    if (payload && typeof payload.requestId === 'string') {
      const candidate = this.#pending.get(payload.requestId);
      if (candidate && candidate.responseType === data.type) {
        pending = candidate;
        matchedRequestId = payload.requestId;
      }
    }

    // Applies whether or not a requestId matched — the host may answer unsolicited.
    // Before resolving, so awaiting code sees the new token.
    if (isMessage<ParentToBlockMessage, 'TOKEN_REFRESH_RESPONSE'>(data, 'TOKEN_REFRESH_RESPONSE')) {
      this.#applyTokenRefresh(data.payload.token);
    }

    if (pending && matchedRequestId !== null) {
      pending.detach();
      this.#pending.delete(matchedRequestId);
      pending.resolve(payload);
      return;
    }

    const handlers = this.#pushListeners.get(data.type);
    if (handlers && handlers.size > 0) {
      for (const handler of [...handlers]) handler(data.payload);
      return;
    }
  }

  #applyTokenRefresh(wrapped: WrappedToken): void {
    // Whole token: scopes and buzzBudget can move at refresh, not just expiry.
    this.#snapshot = { ...this.#snapshot, token: tokenFromWrapped(wrapped) };
    this.#emit();
  }

  /**
   * Emits only on a real change, and updates both `snapshot.theme` and
   * `context.theme` — the host sends both and callers read them
   * interchangeably. Never introduces `context.theme` where the host omitted it.
   */
  #applyThemeChange(theme: BlockSnapshot['theme']): void {
    if (this.#snapshot.theme === theme) return;
    const next: BlockSnapshot = { ...this.#snapshot, theme };
    if ('theme' in next.context) next.context = { ...next.context, theme };
    this.#snapshot = next;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
