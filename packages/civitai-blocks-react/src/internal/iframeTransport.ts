import {
  boundBlockToParentMessageType,
  isMessage,
  OTHER_MESSAGE_TYPE_LABEL,
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
  RequestTimeoutError,
  snapshotFromInit,
  tokenFromWrapped,
  type BlockSnapshot,
  type BlockTransport,
  type OutboundRequest,
} from './transport.js';
import { OriginMatcher } from './originMatcher.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './requestTimeouts.js';
import { payloadValidatorFor, projectInboundPayload } from './validate.js';

import type { WrappedToken } from '@civitai/app-sdk/blocks';

const INIT_TIMEOUT_MS = 10_000;

/**
 * How many DISTINCT inbound origins are remembered for the init-timeout
 * diagnostic, per bucket (accepted / rejected).
 *
 * Bounded on purpose: a framing page — or any browser extension sharing the
 * window — can postMessage from an unbounded number of origins, and the host
 * itself re-sends `BLOCK_INIT` on a ~400ms tick, so an uncapped set would let a
 * hostile or merely noisy page grow an error string without limit. Five is
 * enough to name the misconfigured origin next to the configured allowlist,
 * which is the whole diagnostic; past that the message says it is truncated
 * rather than pretending the list is complete.
 */
const MAX_TRACKED_ORIGINS = 5;

/** Bounded record of the distinct origins seen on one bucket. */
interface OriginTally {
  readonly seen: Set<string>;
  truncated: boolean;
}

function newTally(): OriginTally {
  return { seen: new Set<string>(), truncated: false };
}

/**
 * Remembers `origin` if there is room. Returns true only the FIRST time an
 * origin is recorded, so callers can attach a one-shot log to it without
 * turning the host's 400ms init retry into a console flood.
 */
function recordOrigin(tally: OriginTally, origin: string): boolean {
  if (tally.seen.has(origin)) return false;
  if (tally.seen.size >= MAX_TRACKED_ORIGINS) {
    tally.truncated = true;
    return false;
  }
  tally.seen.add(origin);
  return true;
}

/** The quoted, comma-separated list of origins remembered on one bucket. */
function formatOrigins(tally: OriginTally): string {
  return [...tally.seen].map((o) => `"${o}"`).join(', ');
}

/**
 * Leading clause for the bucket's parenthetical when it overflowed, so a capped
 * list is never read as a complete one. Empty when nothing was dropped — the
 * common case, and the one where the list IS the whole truth.
 */
function truncationNote(tally: OriginTally): string {
  return tally.truncated ? `first ${MAX_TRACKED_ORIGINS} of more; ` : '';
}

export interface IframeTransportOptions {
  /**
   * Origins from which `BLOCK_INIT` (and any other inbound message) is
   * accepted. MUST contain at least one entry. Messages from any other
   * origin — including the local origin — are dropped; a drop that happens
   * before init warns ONCE per distinct origin and is named in the
   * init-timeout error (see {@link MAX_TRACKED_ORIGINS}).
   *
   * Entries are canonicalised by `OriginMatcher`, so a trailing slash, a
   * mixed-case scheme/host and an explicit DEFAULT port all match the
   * equivalent `event.origin` — while a non-default port, the scheme and the
   * exact host stay significant. An entry that is not a bare origin THROWS
   * here rather than being silently skipped. Read that file's docblock before
   * changing anything about the comparison: it is a security boundary.
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
  /**
   * The block→host message type this entry is awaiting a reply TO — i.e. what the
   * block asked for, not what the host answers with.
   *
   * 🔴 IT IS HERE FOR THE REJECTION REPORT, AND THE REPLY TYPE CANNOT SUBSTITUTE.
   * `BLOCK_MESSAGE_REJECTED` names the hanging REQUEST because the host's counter
   * bounds its `type` label against the block→host protocol inventory, which holds
   * no `*_RESULT` key — so reporting `responseType` would clamp to `'other'`
   * server-side and collapse every rejection onto one label. See the message's
   * docblock in `@civitai/app-sdk/blocks`.
   */
  requestType: string;
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
   * The EXACT (non-wildcard) entries of `allowedParentOrigins`, NORMALISED by
   * `OriginMatcher` and usable as a `postMessage` `targetOrigin`. A wildcard
   * entry (`https://*.civitaic.com`) is not a concrete origin and cannot be a
   * target, so it is excluded there — see {@link announceReady} for what
   * happens when nothing exact remains.
   */
  private readonly exactAllowedOrigins: readonly string[];
  /**
   * The allowlist AS CONFIGURED (trimmed, not normalised). Named in the
   * init-timeout error so the operator sees the strings they actually wrote
   * next to the origins that actually arrived.
   */
  private readonly configuredOrigins: readonly string[];
  private readonly window: Window;

  /**
   * Origins observed BEFORE init resolved, split by what the allowlist gate did
   * with them. Both bounded — see {@link MAX_TRACKED_ORIGINS}.
   *
   * 🔴 THE TWO BUCKETS ARE DIFFERENT DIAGNOSES AND AN EMPTY PAIR IS A THIRD.
   * "rejected" says the host is talking and the allowlist is wrong; "accepted,
   * but nothing was a valid BLOCK_INIT" says the allowlist is right and the
   * payload or the message type is wrong; neither means the host frame never
   * posted at all. Collapsing them would send the one person reading this error
   * to the wrong half of the system — the failure this whole diagnostic exists
   * to prevent.
   */
  private readonly acceptedOriginTally = newTally();
  private readonly rejectedOriginTally = newTally();

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
    // From the matcher, NOT re-derived here: a second copy of "which entries are
    // concrete origins, and how is one spelled" is a second place for the
    // trailing-slash/case/default-port bug this class just fixed to come back —
    // and it would come back specifically as a `postMessage` targetOrigin, where
    // the failure is a silently dropped announce.
    this.exactAllowedOrigins = this.originMatcher.exactOrigins;
    this.configuredOrigins = opts.allowedParentOrigins
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
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
              `${this.describeObservedOrigins()} ` +
              `Configured allowedParentOrigins: ${
                this.configuredOrigins.map((o) => `"${o}"`).join(', ') || '(none)'
              }. ` +
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

  /**
   * One sentence naming the origins this transport actually heard from before
   * init timed out — the single fact that turns "BLOCK_INIT never arrived" from
   * a guess into a diagnosis.
   *
   * Three outcomes, deliberately worded apart (see {@link acceptedOriginTally}).
   */
  private describeObservedOrigins(): string {
    const parts: string[] = [];
    if (this.rejectedOriginTally.seen.size > 0) {
      parts.push(
        `rejected messages from ${formatOrigins(this.rejectedOriginTally)} ` +
          `(${truncationNote(this.rejectedOriginTally)}no allowedParentOrigins entry matched)`,
      );
    }
    if (this.acceptedOriginTally.seen.size > 0) {
      parts.push(
        `accepted messages from ${formatOrigins(this.acceptedOriginTally)} ` +
          `(${truncationNote(this.acceptedOriginTally)}none of them was a valid BLOCK_INIT)`,
      );
    }
    if (parts.length === 0) {
      return 'No inbound message was received from any origin.';
    }
    return `Origins seen: ${parts.join('; ')}.`;
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
          // Typed, so a consumer can tell "no reply" from "the host said no"
          // without matching on this string. The MESSAGE is unchanged.
          const msg = `IframeTransport: request "${request.type}" timed out after ${timeoutMs}ms`;
          reject(new RequestTimeoutError(request.type, timeoutMs, msg));
        }
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve,
        reject,
        timeoutId,
        responseType,
        requestType: request.type,
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

  /**
   * Which block→host request a reply we are about to drop leaves hanging, and
   * whether we can tell at all.
   *
   * 🔴 "NO REQUEST IS PENDING" AND "I CANNOT TELL WHICH" ARE DIFFERENT ANSWERS, and
   * an earlier revision collapsed them. It returned `'other'` whenever `requestId`
   * was not a readable string and the `console.warn` then asserted *"unsolicited
   * push — nothing was awaiting it"*, which is FALSE for two shapes that occur:
   *  - a reply whose whole payload is not an object (`isObject` is the first thing
   *    most validators check), while its request sits in `pending` and hangs to its
   *    timeout;
   *  - a PRE-v2 host, which echoes `requestId` only via
   *    `...(requestId ? { requestId } : {})` — the asymmetry
   *    `isValidTokenRefreshResponse` exists to tolerate (NOT `isValidTokenRefresh`,
   *    which validates a host PUSH and has no `requestId` handling at all), so a
   *    legacy host's malformed `TOKEN_REFRESH_RESPONSE`
   *    arrives with no `requestId` at all while `REQUEST_TOKEN` is awaiting it.
   * In both, something IS hanging and the operator was told the opposite. So a
   * reply that leaves a request OF ITS OWN TYPE unattributed reports `unknown`
   * rather than `pushed`, and the warn names how many are awaiting that reply type
   * rather than claiming none was.
   *
   * 🔴 AND THE LOOKUP APPLIES THE SAME `responseType` PREDICATE AS REAL
   * CORRELATION. Without it, a malformed reply carrying ANOTHER in-flight request's
   * `requestId` — which a buggy host can produce by echoing the wrong id — reports
   * against the wrong request type, i.e. mislabels a healthy request as the broken
   * one. `handleMessage` already refuses to settle such a reply; this must refuse to
   * name it for the same reason.
   *
   * The `requestId` is read from an UNVALIDATED payload (the validator just
   * rejected it), so it is used ONLY as a `Map` key on our own pending table and
   * never trusted as data.
   *
   * 🔴 THE CLAMP IS NOT REDUNDANT WITH THE TYPE SYSTEM. `requestType` is whatever
   * the caller passed to `sendRequest` — typed, but a JavaScript consumer, or a
   * block built against a newer protocol, can put any string there, and this value
   * becomes a Prometheus label on the host. See `boundBlockToParentMessageType`.
   */
  private hangingRequestTypeFor(
    replyType: string,
    payload: unknown,
  ): { label: string; hung: 'named' | 'pushed'} | { label: string; hung: 'unknown'; awaiting: number } {
    // 🔴 THE DISCRIMINATOR IS "WHO IS AWAITING **THIS REPLY TYPE**", NOT
    // `pending.size`. An earlier revision used the size of the whole table, and it
    // was wrong in BOTH directions — the shape this file keeps producing:
    //  - too WIDE: a genuine malformed PUSH (`THEME_CHANGE`, `CONSENT_UNAVAILABLE`,
    //    `TOKEN_REFRESH`) arriving while anything at all was in flight printed "one
    //    may now hang", when `validate.ts` says in as many words that dropping one
    //    of those "costs at most a stale theme … never a hang — nothing awaits this
    //    message". For a busy block that made the honest push case near-unreachable;
    //  - too NARROW, on the same pass: the `responseType`-mismatch branch reached
    //    the "this reply names none of them" wording having just FOUND the request
    //    by id, so it asserted the one thing that was demonstrably false there.
    // Filtering by `responseType` answers both: if nobody is awaiting this reply
    // type, nothing here can hang whatever else is in flight.
    //
    // ⚠️ ONE EXCEPTION, AND IT IS THE HIGHEST-STAKES MOMENT THIS WARN HAS.
    // `BLOCK_INIT` has a validator and is never any request's `responseType`, so a
    // malformed one always lands on `pushed` and prints "nothing was awaiting it" —
    // while `waitForInit()` IS awaiting it and rejects 10s later, after which the
    // host shows a fallback.
    //
    // ⚠️ AND THE FILTER DID CHANGE THIS PATH, which an earlier revision of this note
    // denied on the premise that "pre-init `pending` is empty". It is not: a block
    // calling `useViewer()` from a bare mount effect has `GET_VIEWER` in `pending`
    // before any init lands, because `sendRequest` inserts there BEFORE `dispatch`
    // decides to queue. Under the old `pending.size` discriminator that printed
    // "1 request(s) … may now hang"; now it prints the push wording — i.e. the change
    // moved this path in the direction this very note calls the worst one. The
    // CONCLUSION still holds (no metric moves: `reportRejection` returns early on
    // `!parentOrigin`), and the rule above is not universal. Only the premise was
    // wrong.
    const awaiting = [...this.pending.values()].filter((p) => p.responseType === replyType);
    if (awaiting.length === 0) {
      return { label: OTHER_MESSAGE_TYPE_LABEL, hung: 'pushed' };
    }
    const requestId = (payload as { requestId?: unknown } | null | undefined)?.requestId;
    if (typeof requestId === 'string') {
      const pending = this.pending.get(requestId);
      // The same predicate `handleMessage` applies before it will SETTLE a reply.
      // An id matching a request awaiting a DIFFERENT reply type names nothing we
      // may attribute: blaming it would pin this breakage on a healthy request.
      if (pending && pending.responseType === replyType) {
        return { label: boundBlockToParentMessageType(pending.requestType), hung: 'named' };
      }
    }
    return { label: OTHER_MESSAGE_TYPE_LABEL, hung: 'unknown', awaiting: awaiting.length };
  }

  /**
   * Tell the host that this transport refused an inbound message, so the drop
   * becomes a number instead of a `console.warn` nobody is reading.
   *
   * 🔴 WHY IT GOES OVER THE BRIDGE AND NOT STRAIGHT TO AN ENDPOINT. A block runs
   * in a sandboxed iframe at an OPAQUE origin with no ambient credential and no
   * civitai session, so it has no metrics path of its own: a direct POST would be
   * cross-origin, uncredentialed, and would need a new PUBLIC unauthenticated
   * endpoint to receive it — a fresh abuse surface for an observability add-on, and
   * explicitly out of scope. The host already owns the receiving half: its
   * dispatcher counts every inbound bridge message on
   * `civitai_app_block_bridge_messages_total{app_block_id,type,host,outcome}` and
   * flushes it through the same-origin, coalescing `/api/track/block-message`
   * beacon. Reporting over the bridge reuses that end to end and adds no route: the
   * host's handler for this message records `outcome="validator_rejected"` against
   * the `type` we name here.
   *
   * 🔴 THE VALIDATOR'S NAME IS NOT ON THIS WIRE, AND THE `console.warn` DOES NOT
   * CLOSE THE GAP EITHER — an earlier revision of this docblock claimed it did, and
   * that was false. `payloadValidatorFor` is a function from type to validator, so
   * the TOP-LEVEL validator is derivable from the type already on the wire; a
   * `validator` field would carry only that derivable half, which reads as coverage
   * while adding none, and a fifth Prometheus label is not free (the beacon route's
   * own docblock asks for the label product to be read before one is added). The
   * half that is NOT derivable is which NESTED helper rejected —
   * `isValidGatedImage` inside `isValidImagesResult` on 2026-09-18 — and the warn
   * cannot supply it: `validator.name` resolves to the top-level validator, and no
   * helper in `validate.ts` reports its own name anywhere at runtime. So that
   * diagnosis is UNAVAILABLE today, from any surface. Closing it means teaching the
   * validators to return a reason; do not read the warn as a substitute.
   *
   * 🔴 NOTHING IS REPORTED BEFORE `BLOCK_INIT`, DELIBERATELY. `dispatch` has no
   * `parentOrigin` until the first valid init, so a report raised while rejecting a
   * malformed `BLOCK_INIT` could only be QUEUED — and the host re-sends init on a
   * ~400ms interval until `BLOCK_READY`, so that queue is a producer with no
   * consumer: ~25 entries inside one 10s ready window, flushed only if a later init
   * succeeds and silently discarded if none does. The gap it would have covered is
   * already covered by a different series — a block that never inits never sends
   * `BLOCK_READY`, so the host's ready timeout records
   * `civitai_app_block_renders_total{result="timeout"}`. This counter exists for the
   * failures AFTER ready, which that one is structurally blind to.
   *
   * 🔴 NO EMIT BUDGET, AND THE ONE AN EARLIER REVISION CARRIED WAS JUSTIFIED BY A
   * FALSEHOOD. It capped reports at 30 per 10s "so a flood cannot burn the host's
   * 30 msg/sec inbound budget that legitimate `BLOCK_ERROR` reporting needs". The
   * host consumes `BLOCK_MESSAGE_REJECTED` in its shared dispatcher ABOVE that
   * limiter — the same placement, and for the same stated reason, as its
   * `no_handler` branch — so a report consumes none of that budget and the cap
   * bought nothing. What it did buy was a permanent UNDERCOUNT, which inverts the
   * receiving side's own documented preference: `bridgeLabels.ts` chooses its clamp
   * so that "a real flood is still VISIBLE rather than exactly counted … the series
   * reads 'enormous' instead of 'wrong'". A cap here makes a flood read SMALL, the
   * one shape of wrongness that side rejects. Magnitude is therefore unbounded on
   * this path exactly as it already is for `no_handler` and `deduped`; the host's
   * `BRIDGE_MESSAGE_COUNT_MAX` is the clamp that bounds a row, and the beacon
   * coalesces identical label sets, so the network cost of a flood is ~one row.
   */
  private reportRejection(hangingRequestType: string): void {
    // No parent origin yet ⇒ nothing to post to, and queueing is worse than
    // dropping here (see the docblock). Checked rather than left to `dispatch`,
    // whose queue is unbounded and has no consumer on this path.
    if (!this.parentOrigin) return;
    // Fail-soft: a throw here would propagate out of the `message` listener and
    // abort dispatch for this event — turning an observability feature into a
    // second silent drop on top of the one it is reporting.
    try {
      this.dispatch('BLOCK_MESSAGE_REJECTED', { type: hangingRequestType });
    } catch {
      // swallow — telemetry must never break the transport it observes
    }
  }

  private postToParent(msg: { type: string; payload: unknown }): void {
    // `parentOrigin` is captured from a validated BLOCK_INIT; safe to use as targetOrigin.
    this.window.parent.postMessage(msg, this.parentOrigin!);
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.originMatcher.matches(event.origin)) {
      // Still a DROP — nothing below this line runs. What changed is that the
      // drop is no longer invisible: an origin rejected before init lands is the
      // single fact that diagnoses a misspelled allowlist entry, and it is
      // otherwise unobservable from inside the iframe. Bounded to
      // MAX_TRACKED_ORIGINS distinct origins, and `recordOrigin` returns true
      // only on the first sighting, so the host's ~400ms init retry warns ONCE
      // rather than 25 times per ready window.
      if (!this.initResolved && recordOrigin(this.rejectedOriginTally, event.origin)) {
        // eslint-disable-next-line no-console -- developer-facing diagnostic at a trust boundary
        console.warn(
          `IframeTransport: dropping a message from "${event.origin}" — no ` +
            'allowedParentOrigins entry matched. Configured: ' +
            `${this.configuredOrigins.map((o) => `"${o}"`).join(', ') || '(none)'}.`,
        );
      }
      return;
    }
    if (!this.initResolved) recordOrigin(this.acceptedOriginTally, event.origin);
    const data = event.data as { type?: unknown; payload?: unknown };
    if (data == null || typeof data !== 'object' || typeof data.type !== 'string') return;

    // Trust-boundary shape check. `isMessage` only narrows on `type`;
    // anything that reaches state-mutating code below must pass the
    // payload validator for its type. Failures drop with a console.warn
    // rather than crash — see ./validate.ts.
    const validator = payloadValidatorFor(data.type);
    if (validator && !validator(data.payload)) {
      const hanging = this.hangingRequestTypeFor(data.type, data.payload);
      // 🔴 THE THREE CASES SAY THREE DIFFERENT THINGS, and `unknown` is the one an
      // earlier revision printed as `pushed`. Claiming "nothing was awaiting it"
      // while a request hangs is worse than saying nothing: it sends the one person
      // reading this console away from the actual symptom.
      const diagnosis =
        hanging.hung === 'named'
          ? `; "${hanging.label}" will now hang to its request timeout)`
          : hanging.hung === 'pushed'
            ? ', unsolicited push — nothing was awaiting it)'
            // `hung` is exactly three states and the two above are excluded, so this
            // arm is `'unknown'` by construction — but a FOURTH state would land here
            // silently, and the obvious `: 0` fallback prints "0 request(s) … so one
            // may now hang", a sentence that contradicts itself. Say that instead.
            : `; ${hanging.hung === 'unknown' ? `${hanging.awaiting} request(s)` : 'an unknown number of requests'} awaiting "${data.type}" and this reply names none of them, so one may now hang)`;
      // eslint-disable-next-line no-console -- developer-facing diagnostic at a trust boundary
      console.warn(
        `IframeTransport: dropping malformed "${data.type}" message from ${event.origin} ` +
          `(rejected by ${validator.name || 'an anonymous validator'}` +
          diagnosis,
      );
      this.reportRejection(hanging.label);
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
    //
    // 🔴 PROJECTED, NOT RAW. This is the last point before an inbound payload
    // crosses into block code — `pending.resolve` below and the push handlers
    // further down are the only two deliveries, and BOTH read this binding.
    // `projectInboundPayload` drops fields a consumer is not allowed to see
    // (today: every key beyond `imageId`/`status` on a `hidden` gated image) and
    // is identity for every other type. Validation said "deliver this message";
    // this says "deliver these fields".
    //
    // The `TOKEN_REFRESH_RESPONSE` branch below still reads `data.payload` on
    // purpose: it applies to the SNAPSHOT rather than handing anything to block
    // code, and it needs the narrowing `isMessage` gave `data`. Every DELIVERY
    // must read this binding instead — the raw object still carries whatever the
    // host sent.
    //
    // It runs on the block's side of the boundary rather than in the hook
    // because `getTransport` + `sendTypedRequest` are PUBLIC exports: a consumer
    // that bypasses `useGatedImages()` still gets the projection.
    const payload = projectInboundPayload(data.type, data.payload) as
      | { requestId?: unknown }
      | undefined;
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
      // `payload`, not `data.payload`: the projected view — see the binding above.
      for (const handler of [...handlers]) handler(payload);
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
