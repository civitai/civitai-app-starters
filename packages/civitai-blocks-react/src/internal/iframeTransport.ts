import {
  isMessage,
  parseBlockInitFragment,
  stripBlockInitFragment,
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
import { OriginMatcher } from './originMatcher.js';
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
  private readonly originMatcher: OriginMatcher;
  /**
   * The EXACT (non-wildcard) entries of `allowedParentOrigins`, usable as a
   * `postMessage` `targetOrigin`. A wildcard entry (`https://*.civitaic.com`)
   * is not a concrete origin and cannot be a target, so it is excluded here —
   * see {@link announceReady} for what happens when nothing exact remains.
   */
  private readonly exactAllowedOrigins: readonly string[];
  private readonly window: Window;

  private snapshot: BlockSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  /** Origin of the parent — captured from the first valid `BLOCK_INIT`. */
  private parentOrigin: string | null = null;

  /** Messages queued before `BLOCK_INIT` lands. Flushed in arrival order. */
  private readonly outbound: Array<{ type: string; payload: unknown }> = [];
  private readonly pending = new Map<string, PendingRequest>();

  /**
   * Handlers for UNSOLICITED parent→block pushes (e.g. `IMAGE_SCAN_RESOLVED`) —
   * messages the host initiates on its own schedule, NOT replies to a pending
   * `sendRequest`. Keyed by message type; each entry a set of subscribers.
   */
  private readonly pushListeners = new Map<string, Set<(payload: unknown) => void>>();

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
    // Build the matcher from the allowlist. Exact entries match by equality;
    // `https://*.example.com` entries match any subdomain on a dot boundary
    // (mirrors the host-side CSP frame-ancestors convention).
    this.originMatcher = new OriginMatcher(opts.allowedParentOrigins);
    this.exactAllowedOrigins = opts.allowedParentOrigins
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.includes('*'));
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

    // FAST PATH (additive): seed the three non-secret init fields from the URL
    // fragment, if the host put one there. This runs BEFORE the listener is
    // attached so that even a `BLOCK_INIT` racing in on the very next task
    // finds a snapshot already carrying theme/renderMode/blockInstanceId.
    //
    // 🔴 `ready` stays FALSE. Only `BLOCK_INIT` flips it, and only
    // `snapshotFromInit` — which runs later and overwrites all three fields —
    // is authoritative. No token, viewer, context or settings is ever sourced
    // from the URL.
    this.seedFromFragment();

    this.messageListener = (event) => this.handleMessage(event);
    this.window.addEventListener('message', this.messageListener);

    // INVERTED HANDSHAKE (additive): tell the parent we are listening, so it can
    // push `BLOCK_INIT` in response rather than waiting out its retry tick. This
    // MUST come after `addEventListener` — otherwise a host that answers
    // synchronously would post into a frame with no listener and the announce
    // would have made things worse, not better.
    //
    // 🔴 Best-effort only. Nothing downstream depends on it: the host keeps its
    // own bounded retry + readiness timeout, so a dropped/ignored announce costs
    // at most the latency this was meant to save.
    this.announceReady();
  }

  /**
   * Read the host's URL-fragment fast path into the pre-init snapshot.
   *
   * Silent no-op when the fragment is absent, belongs to the block app itself,
   * or is a version we do not understand — in every one of those cases the
   * block falls back to waiting for `BLOCK_INIT`, i.e. today's behaviour.
   */
  private seedFromFragment(): void {
    let hash: string | undefined;
    try {
      hash = this.window.location?.hash;
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

    this.snapshot = {
      ...this.snapshot,
      ...(fragment.theme !== undefined ? { theme: fragment.theme } : {}),
      ...(fragment.renderMode !== undefined ? { renderMode: fragment.renderMode } : {}),
      ...(fragment.blockInstanceId !== undefined
        ? { blockInstanceId: fragment.blockInstanceId }
        : {}),
    };

    // Hygiene: take our keys back out of the visible URL, preserving anything
    // the block app itself put in the fragment. Purely cosmetic — every
    // consumer reads the snapshot, not the URL — so a failure (an opaque-origin
    // sandbox rejects `history.replaceState`) is swallowed.
    try {
      const remainder = stripBlockInitFragment(hash);
      if (remainder !== null) {
        const loc = this.window.location;
        const base = `${loc.pathname}${loc.search}`;
        this.window.history.replaceState(
          this.window.history.state,
          '',
          remainder.length > 0 ? `${base}#${remainder}` : base,
        );
      }
    } catch {
      // Sandboxed opaque origin, or no History API. Nothing depends on this.
    }
  }

  /**
   * Post the contentless `BLOCK_HELLO` announce to the parent.
   *
   * Targeting: the announce goes out BEFORE any `BLOCK_INIT` has been
   * validated, so `parentOrigin` is still null and we cannot use the normal
   * `postToParent` path. We therefore aim at each EXACT entry of the configured
   * allowlist — the set of origins this block was built to trust — rather than
   * broadcasting. Only when the allowlist is wildcard-only (no exact origin can
   * be derived, e.g. a preview-subdomain-only build) do we fall back to `'*'`,
   * which is acceptable solely because the message carries no payload: it
   * discloses nothing a framing page does not already know from the URL it
   * chose to frame.
   */
  private announceReady(): void {
    let parent: Window;
    try {
      parent = this.window.parent;
      // Not framed (or self-framed) — nobody to announce to.
      if (!parent || parent === this.window) return;
    } catch {
      return;
    }

    const targets = this.exactAllowedOrigins.length > 0 ? this.exactAllowedOrigins : ['*'];
    for (const target of targets) {
      try {
        parent.postMessage({ type: 'BLOCK_HELLO' } satisfies BlockToParentMessage, target);
      } catch {
        // An unreachable/mismatched target throws nothing in practice; guard
        // anyway so one bad allowlist entry can't abort the remaining posts.
      }
    }
  }

  getSnapshot(): BlockSnapshot {
    return this.snapshot;
  }

  /**
   * The validated parent origin — `null` until `BLOCK_INIT` lands.
   *
   * SECURITY INVARIANT — do NOT change what this returns: it hands back ONLY
   * `this.parentOrigin`, which is set exactly once, in `handleMessage`, from
   * the `event.origin` of the FIRST `BLOCK_INIT` — AND only after that message
   * cleared `this.originMatcher.matches(event.origin)` (the allowlist gate at
   * the very top of `handleMessage`, the same gate every inbound message
   * passes). It is therefore guaranteed to be a legitimate civitai origin.
   *
   * It is NEVER derived from `document.referrer`, `window.location`, or an
   * unvalidated `event.origin`. Blocks send a money-scoped bearer token
   * (`useBlockToken().raw`) to this origin, so returning a spoofable value
   * would be a token-exfiltration vector. This is the same value already
   * trusted as the `targetOrigin` of every `postMessage` to the parent
   * (see `postToParent`).
   */
  getHostOrigin(): string | null {
    return this.parentOrigin;
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

  onMessage(
    type: ParentToBlockMessageType,
    handler: (payload: unknown) => void,
  ): () => void {
    let set = this.pushListeners.get(type);
    if (!set) {
      set = new Set();
      this.pushListeners.set(type, set);
    }
    set.add(handler);
    return () => {
      const s = this.pushListeners.get(type);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.pushListeners.delete(type);
    };
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
    this.pushListeners.clear();
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
    if (!this.originMatcher.matches(event.origin)) return;
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

    // CONTRACT — load-bearing, do NOT weaken the `!this.initResolved` guard:
    // BLOCK_INIT is DEDUPED. Only the FIRST valid init is honored; every repeat
    // is a complete no-op (no re-snapshot, no re-emit to subscribers, no second
    // BLOCK_READY, parentOrigin frozen to the first sender). The civitai host
    // (`IframeHost.tsx`) depends on this: to defeat the cross-origin iframe
    // `onLoad` race it RE-SENDS BLOCK_INIT on a ~400ms interval until it observes
    // BLOCK_READY (civitai PR #2546). If this dedupe were removed, every retry
    // tick would re-init the block and re-emit BLOCK_READY. Pinned by
    // iframe-transport.test.ts → "dedupes repeated BLOCK_INIT (host retry-until-ready contract)".
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

    // Host-pushed SITE-THEME change (viewer toggled light/dark mid-session; no
    // requestId). Same shape of handling as TOKEN_REFRESH: apply to the snapshot
    // and emit, never matches a pending request.
    //
    // Deliberately NOT gated on `initResolved`. A push that lands before
    // BLOCK_INIT is still the freshest value the host has, and it cannot
    // "half-init" anything: `ready` stays false (only BLOCK_INIT flips it) and
    // `snapshotFromInit` replaces the whole snapshot when init lands, so the
    // payload remains authoritative exactly as it is for the URL-fragment fast
    // path seeded in the constructor.
    if (isMessage<ParentToBlockMessage, 'THEME_CHANGE'>(data, 'THEME_CHANGE')) {
      this.applyThemeChange(data.payload.theme);
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

    // Unsolicited parent→block push (not a reply to any pending request) — e.g.
    // `IMAGE_SCAN_RESOLVED`. Deliver to any handlers registered via `onMessage`.
    // This runs ONLY AFTER the message has already CLEARED both the origin
    // allowlist (`this.originMatcher.matches`) and the payload validator
    // (`payloadValidatorFor`) at the top of `handleMessage` — it does NOT and
    // must NOT bypass them. Do not reorder this ahead of those gates: a push from
    // a disallowed origin, or a malformed payload, is dropped before it can reach
    // here (locked by the origin-drop regression test in iframe-transport.test.ts).
    // Reply-type messages that arrive without a matching pending have no push
    // listeners, so they fall through to the no-op tail below unchanged.
    const handlers = this.pushListeners.get(data.type);
    if (handlers && handlers.size > 0) {
      for (const handler of [...handlers]) handler(data.payload);
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

  /**
   * Apply a host-pushed `THEME_CHANGE` to the snapshot.
   *
   * Emits only when the value actually MOVED. `useSyncExternalStore` re-reads
   * `getSnapshot()` on every emit and re-renders when the identity differs, so
   * an unconditional `{ ...snapshot }` would re-render every subscriber on a
   * redundant push (the host re-sending the same theme, e.g. after a re-mount
   * of its effect) even though nothing changed.
   *
   * Updates BOTH readers. The host forwards the theme TWICE — as the top-level
   * `BLOCK_INIT.theme` and again inside `BLOCK_INIT.context` (`theme` is on the
   * host's context allowlist, and `ModelSlotContext.theme` is a documented,
   * publicly exported SDK field: "Host-page color scheme; lets the iframe match
   * without a flicker"). Moving only the top-level field would leave a block
   * that reads `context.theme` frozen at its mount-time value while
   * `useBlockContext().theme` moved — a silent divergence between two fields
   * the SDK's own types invite you to read interchangeably.
   *
   * Only ever UPDATES a context that already carries the key; never INTRODUCES
   * it. A host/slot that omits `theme` from its context said something by
   * omitting it, and synthesising the field here would make the SDK assert a
   * value the host never sent (and needlessly break `context` identity for
   * every non-model slot).
   */
  private applyThemeChange(theme: BlockSnapshot['theme']): void {
    if (this.snapshot.theme === theme) return;
    const next: BlockSnapshot = { ...this.snapshot, theme };
    if ('theme' in next.context) next.context = { ...next.context, theme };
    this.snapshot = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
