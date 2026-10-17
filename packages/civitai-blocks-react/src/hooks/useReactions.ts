import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  BlockAppReaction,
  BlockEntityReactionErrorCode,
  BlockEntityReactionResult,
  BlockEntityReactionState,
  BlockReactionCounts,
  BlockReactionEntityType,
  BlockStoredReaction,
} from '@civitai/app-sdk/blocks';

import { getTransport } from '../transport/singleton.js';
import { RequestTimeoutError, sendTypedRequest } from '../transport/transport.js';
import { useTransportConnection } from './useTransportConnection.js';

export type {
  BlockAppReaction,
  BlockEntityReactionErrorCode,
  BlockEntityReactionResult,
  BlockEntityReactionState,
  BlockReactionCounts,
  BlockReactionEntityType,
  BlockStoredReaction,
};

/**
 * The reactions an app may set, as a runtime value: `Like`, `Heart`, `Laugh`,
 * `Cry`. Never `Dislike` (the host refuses it).
 *
 * Declared here rather than value-imported from `@civitai/app-sdk/blocks` (where
 * `APP_REACTIONS` holds the same list) so this hook does not raise the package's
 * `@civitai/app-sdk` peer floor; see `PEER_FLOOR.md`. `test/useReactions.test.tsx`
 * asserts the two lists are equal.
 */
export const REACTIONS = ['Like', 'Heart', 'Laugh', 'Cry'] as const satisfies readonly BlockAppReaction[];

/**
 * The CLOSED set of codes `ENTITY_REACTION(S)_RESULT` carries, as a runtime
 * value. Mirrors civitai's `ENTITY_REACTION_ERRORS` (and `@civitai/app-sdk`'s
 * `ENTITY_REACTION_ERROR_CODES`); declared locally for the peer-floor reason on
 * {@link REACTIONS}.
 */
export const REACTION_ERROR_CODES = [
  'invalid-request',
  'sign-in-required',
  'review-mode',
  'not-ready',
  'needs-consent',
  'entity-unavailable',
  'rate-limited',
] as const satisfies readonly BlockEntityReactionErrorCode[];

const CODE_SET: ReadonlySet<string> = new Set(REACTION_ERROR_CODES);

/** Most ids one read may carry; the hook splits larger sets into several reads. */
const READ_CHUNK = 100;

/** `true` when `error` is one of the closed {@link REACTION_ERROR_CODES}. */
export function isReactionErrorCode(error: string): error is BlockEntityReactionErrorCode {
  return CODE_SET.has(error);
}

/**
 * A reaction read or write that did not succeed.
 *
 * `.code` is the host's closed code, or `undefined` for a transport timeout, a
 * code a newer host added, or a local {@link ReactionError.busy} refusal.
 * Check the flags before `.message`: only a `.code` is meant to be branched on,
 * and none of these messages is written for a viewer.
 */
export class ReactionError extends Error {
  readonly code?: BlockEntityReactionErrorCode;
  /**
   * No reply arrived in time. 🔴 The write MAY have landed: the host could have
   * completed it and failed to deliver the reply. The hook reverts its
   * optimistic state and re-reads that image, so `byId` converges on the truth.
   */
  readonly timedOut: boolean;
  /**
   * Refused locally because the same image and reaction already has a request
   * in flight. Nothing was sent. Disable the control while
   * `pending(id, reaction)` is true and this does not happen.
   */
  readonly busy: boolean;
  /** No session. Route into `useRequestSignIn()`. */
  readonly signInRequired: boolean;
  /** The viewer has not granted `social:react:self`. Ask with `useRequestConsent()`. */
  readonly needsConsent: boolean;

  constructor(error: string, opts?: { timedOut?: boolean; busy?: boolean }) {
    super(error);
    this.name = 'ReactionError';
    this.timedOut = opts?.timedOut === true;
    this.busy = opts?.busy === true;
    if (isReactionErrorCode(error)) this.code = error;
    this.signInRequired = error === 'sign-in-required';
    this.needsConsent = error === 'needs-consent';
  }
}

/** Options for {@link useReactions}. */
export interface UseReactionsOptions {
  /**
   * The `reactTicket` each image arrived with, keyed by image id. A block
   * endpoint (`/api/v1/blocks/images`, `/gated-images`, a collection's images)
   * attaches one per image for a signed-in viewer, signed for this app and this
   * viewer, valid 24 hours.
   *
   * 🔴 REQUIRED, for reads and writes alike. The host answers no image without
   * a valid ticket: a read lists it in `unavailable`, and `toggle` on it is
   * refused here with `entity-unavailable` before anything is sent, because
   * the server would refuse it only AFTER spending one of the viewer's
   * reactions from the quota the site's own button shares.
   */
  tickets: Readonly<Record<number | string, string | undefined>>;
}

/** What {@link useReactions} returns. */
export interface UseReactions {
  /**
   * The known state per image id: counts, the viewer's reactions, and
   * `statsUnknown`. An id is absent until a read answers it, and stays absent
   * if the host listed it in {@link UseReactions.unavailable}.
   */
  byId: Readonly<Record<number, BlockEntityReactionState>>;
  /**
   * Ids the host would not answer for want of a valid ticket. 🔴 These have NO
   * known state; do not render them as "not reacted".
   */
  unavailable: readonly number[];
  /** `true` while a read is in flight. */
  loading: boolean;
  /** The last failure of a read or a write, or `null`. Cleared by the next one. */
  error: ReactionError | null;
  /**
   * Set the viewer's `reaction` on image `id` to `reacted`, and resolve with
   * what the host reports.
   *
   * Optimistic: `byId[id]` moves at once and moves back if the write fails.
   * REJECTS with a {@link ReactionError} on every failure. On success `byId[id]`
   * adopts the host's `viewerReactions`, the truth read back after the write.
   * When the host's `reacted` differs from the one asked for, a concurrent
   * change won, and `byId` follows the host.
   */
  toggle: (
    id: number,
    reaction: BlockAppReaction,
    reacted: boolean,
  ) => Promise<BlockEntityReactionResult>;
  /** `true` while a `toggle` for this image and reaction is in flight. */
  pending: (id: number, reaction: BlockAppReaction) => boolean;
}

interface Store {
  byId: Record<number, BlockEntityReactionState>;
  unavailable: number[];
}

const pendingKey = (id: number, reaction: string): string => `${id}:${reaction}`;

/** `state` with `reaction` held or not, and its count moved by one to match. */
function withReaction(
  state: BlockEntityReactionState,
  reaction: BlockAppReaction,
  reacted: boolean,
): BlockEntityReactionState {
  const holds = state.viewerReactions.includes(reaction);
  if (holds === reacted) return state;
  const viewerReactions: BlockStoredReaction[] = reacted
    ? [...state.viewerReactions, reaction]
    : state.viewerReactions.filter((r) => r !== reaction);
  const count = state.counts[reaction] ?? 0;
  return {
    ...state,
    viewerReactions,
    counts: { ...state.counts, [reaction]: Math.max(0, count + (reacted ? 1 : -1)) },
  };
}

/**
 * Read and set the VIEWER'S reactions on images this app was served, through
 * the host's `GET_ENTITY_REACTIONS` and `SET_ENTITY_REACTION` bridge (scope
 * `social:react:self`).
 *
 * A reaction made here is a reaction on civitai.com: it pays the reactor and
 * the image owner exactly as the site's own button does, moves the image's
 * rankings, notifies, and lists the viewer among the image's reactors. It draws
 * on the SAME per-viewer quota as the site.
 *
 * 🔴 THE SCOPE IS CONSENT-GATED AND SENSITIVE. Declare `social:react:self` in
 * the manifest with a `scopeJustifications` entry; until the viewer grants it,
 * every call rejects with `needs-consent` (`.needsConsent`), which is the cue
 * for `useRequestConsent()`. There is no per-tap confirm.
 *
 * Reads `ids` on mount in chunks of 100, then reads only what needs it: an id
 * added to `ids`, or one whose ticket changed. Changing `entityType` re-reads
 * nothing (image is the only type the host accepts today). After a write fails,
 * an image is read again if the write timed out or the image has no state.
 *
 * @example
 * const { byId, toggle, pending } = useReactions('image', images.map((i) => i.id), {
 *   tickets: Object.fromEntries(images.map((i) => [i.id, i.reactTicket])),
 * });
 */
export function useReactions(
  entityType: BlockReactionEntityType,
  ids: readonly number[],
  options: UseReactionsOptions,
): UseReactions {
  useTransportConnection();

  const [store, setStore] = useState<Store>({ byId: {}, unavailable: [] });
  // The latest committed store, read synchronously by `toggle` to decide whether
  // its optimistic move applies.
  const storeRef = useRef(store);
  storeRef.current = store;
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingCount, setLoadingCount] = useState(0);
  const [error, setError] = useState<ReactionError | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // In-flight writes, read synchronously so a second tap is refused before a
  // re-render could tell it the first one is pending.
  const inFlight = useRef(new Set<string>());

  // Keyed by CONTENT, so a fresh array with the same ids does not re-read.
  const idsKey = ids.join(',');
  const uniqueIds = useMemo(
    () => (idsKey === '' ? [] : [...new Set(idsKey.split(',').map(Number))]),
    [idsKey],
  );

  // The tickets the current ids need, as a stable key, so a fresh `tickets`
  // object with the same contents does not re-read.
  const ticketKey = uniqueIds.map((id) => `${id}=${options.tickets[id] ?? ''}`).join('&');
  const ticketsRef = useRef(options.tickets);
  ticketsRef.current = options.tickets;

  // ── Read bookkeeping ────────────────────────────────────────────────────
  //
  // Every read and every write start takes a tick of ONE monotonic clock, so
  // "which happened later" is a comparison of two numbers. Three rules decide
  // whether a read's answer for an image is applied, each pinned by a test in
  // `test/useReactions.test.tsx` ("read economy and ordering"):
  //
  //   1. NOT while a write on that image is in flight: the write owns the state
  //      until it settles (its revert or its result is the next truth).
  //   2. NOT if a write on that image STARTED after the read was issued: the
  //      read describes the state before the write, and applying it would
  //      overwrite a settled result (and its count reconciliation).
  //   3. NOT if a NEWER read for that image was issued: answers can arrive out
  //      of order, and only the latest one sent for an image is the truth.
  const clock = useRef(0);
  const writeStartedAt = useRef(new Map<number, number>());
  const latestReadAt = useRef(new Map<number, number>());
  // The ticket each image was last READ with ('' for none). An image is read
  // again only when it has never been read or its ticket changed, because the
  // host bills every read to the block instance's shared catalog budget.
  const readWithTicket = useRef(new Map<number, string>());
  // A newer pass supersedes an older one: the older pass sends no further
  // chunks. Its chunks already sent are still applied, under the rules above.
  const readGeneration = useRef(0);

  const readIds = useCallback(
    async (targetIds: readonly number[], generation: number): Promise<void> => {
      for (let start = 0; start < targetIds.length; start += READ_CHUNK) {
        // Superseded: the newer pass reads whatever this one has not sent.
        if (generation !== readGeneration.current) break;
        const chunk = targetIds.slice(start, start + READ_CHUNK);
        const tickets: Record<string, string> = {};
        clock.current += 1;
        const issuedAt = clock.current;
        for (const id of chunk) {
          const ticket = ticketsRef.current[id];
          if (ticket) tickets[String(id)] = ticket;
          readWithTicket.current.set(id, ticket ?? '');
          latestReadAt.current.set(id, issuedAt);
        }
        if (mountedRef.current) setLoadingCount((n) => n + 1);
        try {
          const reply = await sendTypedRequest(
            getTransport(),
            { type: 'GET_ENTITY_REACTIONS', payload: { entityType, ids: chunk, tickets } },
            'ENTITY_REACTIONS_RESULT',
          );
          if (reply.error || !reply.result) {
            throw new ReactionError(reply.error || 'entity-unavailable');
          }
          const result = reply.result;
          if (!mountedRef.current) return;
          const applicable = chunk.filter(
            (id) =>
              // Rule 1.
              !REACTIONS.some((r) => inFlight.current.has(pendingKey(id, r))) &&
              // Rule 2.
              (writeStartedAt.current.get(id) ?? 0) < issuedAt &&
              // Rule 3.
              latestReadAt.current.get(id) === issuedAt,
          );
          if (applicable.length === 0) continue;
          const unanswered = new Set(result.unavailable);
          setStore((prev) => {
            const byId = { ...prev.byId };
            const applied = new Set(applicable);
            for (const id of applicable) {
              const state = result.byId[String(id)];
              if (state) byId[id] = state;
              else delete byId[id];
            }
            const unavailable = [
              ...prev.unavailable.filter((id) => !applied.has(id)),
              ...applicable.filter((id) => unanswered.has(id)),
            ];
            return { byId, unavailable };
          });
        } catch (err: unknown) {
          // Only the LATEST read for an image speaks for it (rule 3 again): a
          // failed one leaves the image unread, so the next pass retries it,
          // and reports the failure. An older read failing after a newer one
          // answered does neither.
          const current = chunk.filter((id) => latestReadAt.current.get(id) === issuedAt);
          for (const id of current) readWithTicket.current.delete(id);
          if (current.length === 0) continue;
          const wrapped =
            err instanceof ReactionError
              ? err
              : new ReactionError(err instanceof Error ? err.message : String(err), {
                  timedOut: err instanceof RequestTimeoutError,
                });
          if (mountedRef.current) setError(wrapped);
        } finally {
          if (mountedRef.current) setLoadingCount((n) => n - 1);
        }
      }
    },
    [entityType],
  );

  // Read on mount and whenever the ids or their tickets change, but only the
  // images that need it: never read, or read with a different ticket. An image
  // that leaves the list needs nothing. `ticketKey` is a dependency so a ticket
  // arriving for an image already listed re-reads it.
  useEffect(() => {
    readGeneration.current += 1;
    const generation = readGeneration.current;
    const needed = uniqueIds.filter(
      (id) => readWithTicket.current.get(id) !== (ticketsRef.current[id] ?? ''),
    );
    if (needed.length === 0) return;
    setError(null);
    void readIds(needed, generation);
  }, [readIds, uniqueIds, ticketKey]);

  const toggle = useCallback(
    async (
      id: number,
      reaction: BlockAppReaction,
      reacted: boolean,
    ): Promise<BlockEntityReactionResult> => {
      const key = pendingKey(id, reaction);
      if (inFlight.current.has(key)) {
        const busy = new ReactionError(`a ${reaction} on ${entityType} ${id} is already in flight`, {
          busy: true,
        });
        // Rejects the CALL only; the hook-level `error` is left alone. A busy
        // refusal is not an outcome of the image: the write it collided with
        // is still running, and its settle re-renders the owner (it clears
        // `pending`), which is what rewrites a bound element.
        throw busy;
      }
      const ticket = ticketsRef.current[id];
      if (!ticket) {
        // Refused HERE, not by the host: the server checks the ticket after its
        // rate limit, so sending this would spend a reaction for nothing.
        const refusal = new ReactionError('entity-unavailable');
        if (mountedRef.current) setError(refusal);
        throw refusal;
      }

      inFlight.current.add(key);
      let reread = false;
      clock.current += 1;
      writeStartedAt.current.set(id, clock.current);
      // Optimistic only when the state is known and the request would change
      // it. An unread image, or one already in the asked-for state, waits for
      // the host's answer instead.
      const before = storeRef.current.byId[id];
      const applied = before !== undefined && withReaction(before, reaction, reacted) !== before;
      if (mountedRef.current) {
        setError(null);
        setPendingKeys((prev) => new Set(prev).add(key));
        if (applied) {
          setStore((prev) => {
            const state = prev.byId[id];
            if (!state) return prev;
            return { ...prev, byId: { ...prev.byId, [id]: withReaction(state, reaction, reacted) } };
          });
        }
      }

      try {
        const reply = await sendTypedRequest(
          getTransport(),
          {
            type: 'SET_ENTITY_REACTION',
            payload: { entityType, entityId: id, reaction, reacted, ticket },
          },
          'ENTITY_REACTION_RESULT',
        );
        if (reply.error || !reply.result) {
          throw new ReactionError(reply.error || 'entity-unavailable');
        }
        const result = reply.result;
        if (mountedRef.current) {
          setStore((prev) => {
            const current = prev.byId[id];
            const counts = { ...result.counts };
            // Counts come from an asynchronous metric store and can lag the
            // write. When the write held, keep the optimistic count unless the
            // server's has already moved past it in the same direction.
            if (applied && current && result.reacted === reacted) {
              const mine = current.counts[reaction] ?? 0;
              const theirs = counts[reaction] ?? 0;
              counts[reaction] = reacted ? Math.max(mine, theirs) : Math.min(mine, theirs);
            }
            const state: BlockEntityReactionState = {
              counts,
              viewerReactions: result.viewerReactions,
              statsUnknown: result.statsUnknown,
            };
            return {
              byId: { ...prev.byId, [id]: state },
              unavailable: prev.unavailable.filter((u) => u !== id),
            };
          });
        }
        return result;
      } catch (err: unknown) {
        const wrapped =
          err instanceof ReactionError
            ? err
            : new ReactionError(err instanceof Error ? err.message : String(err), {
                timedOut: err instanceof RequestTimeoutError,
              });
        if (mountedRef.current) {
          if (applied) {
            setStore((prev) => {
              const state = prev.byId[id];
              if (!state) return prev;
              return { ...prev, byId: { ...prev.byId, [id]: withReaction(state, reaction, !reacted) } };
            });
          }
          setError(wrapped);
          // A failed write leaves no truth behind it. Read the image again when
          // the write may have landed (a timeout) or when there is no state to
          // fall back on, which also covers a read discarded behind this write.
          reread = wrapped.timedOut || storeRef.current.byId[id] === undefined;
        }
        // 🔴 Thrown even when unmounted: the caller's `await` is not the
        // component, and an unmount must not read as a success.
        throw wrapped;
      } finally {
        inFlight.current.delete(key);
        if (mountedRef.current) {
          setPendingKeys((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          // After the in-flight mark is gone, so the answer is not discarded.
          if (reread) void readIds([id], readGeneration.current);
        }
      }
    },
    [entityType, readIds],
  );

  const pending = useCallback(
    (id: number, reaction: BlockAppReaction): boolean => pendingKeys.has(pendingKey(id, reaction)),
    [pendingKeys],
  );

  return {
    byId: store.byId,
    unavailable: store.unavailable,
    loading: loadingCount > 0,
    error,
    toggle,
    pending,
  };
}
