import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockCollectionFollowErrorCode,
  BlockCollectionFollowResult,
} from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../internal/requestTimeouts.js';
import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

export type { BlockCollectionFollowErrorCode, BlockCollectionFollowResult };

/**
 * The closed set of HOST refusal codes, as a runtime Set.
 *
 * 🔴 THIS EXISTS BECAUSE THE ERROR CHANNEL IS NOT AN ENUM. The host sends either
 * one of these codes or a free-text server message, so "is this a code?" is a
 * MEMBERSHIP question at runtime, not a type-level one — a `switch` over the
 * union type would silently treat `"You do not have permission…"` as unmatched
 * prose while a typo'd literal compiled fine. Derived from the array below so
 * the two cannot drift.
 */
export const COLLECTION_FOLLOW_ERROR_CODES = [
  'invalid-request',
  'sign-in-required',
  'review-mode',
  'not-ready',
  'declined',
  'collection-unavailable',
] as const satisfies readonly BlockCollectionFollowErrorCode[];

const CODE_SET: ReadonlySet<string> = new Set(COLLECTION_FOLLOW_ERROR_CODES);

/**
 * `true` when `error` is one of the host's CLOSED refusal codes rather than a
 * free-text server message.
 *
 * Use it before comparing against a code — see
 * {@link COLLECTION_FOLLOW_ERROR_CODES} for why equality alone is not enough.
 */
export function isCollectionFollowErrorCode(
  error: string,
): error is BlockCollectionFollowErrorCode {
  return CODE_SET.has(error);
}

/**
 * A collection follow/unfollow failure.
 *
 * `.code` is the host's refusal code when the host refused, and `undefined` when
 * the failure was a SERVER error the host forwarded verbatim (or a transport
 * timeout) — in that case read `.message`. 🔴 Do not treat `.code === undefined`
 * as "unknown refusal": it is the positive signal that the string in `.message`
 * came from the collection service and is meant to be shown.
 */
export class CollectionFollowError extends Error {
  /** The closed host refusal code, or `undefined` for a server/transport error. */
  readonly code?: BlockCollectionFollowErrorCode;
  /**
   * The viewer DISMISSED the host's consent confirm, so NO WRITE OCCURRED.
   *
   * 🔴 Not an error condition to shout about, and it is trustworthy in the one
   * direction that matters: the host takes its consent latch synchronously
   * before the write, so `declined` can never be reported for a follow that
   * landed. Revert optimistic state and render nothing.
   */
  readonly declined: boolean;
  /**
   * There is no session. Route this into `useRequestSignIn()` rather than
   * showing an error — the viewer's next step is signing in, not retrying.
   */
  readonly signInRequired: boolean;

  constructor(error: string) {
    super(error);
    this.name = 'CollectionFollowError';
    if (isCollectionFollowErrorCode(error)) this.code = error;
    this.declined = error === 'declined';
    this.signInRequired = error === 'sign-in-required';
  }
}

/** What {@link useCollectionFollow} returns. */
export interface UseCollectionFollow {
  /**
   * Ask the host to follow (`follow: true`) or unfollow (`false`) `collectionId`
   * for the viewer, and resolve with the host's echo of what it wrote.
   *
   * REJECTS with a {@link CollectionFollowError} on every non-success — including
   * `declined`, which means the viewer dismissed the confirm and nothing was
   * written. Check `.declined` before rendering a failure.
   */
  setFollow: (args: {
    collectionId: number;
    follow: boolean;
  }) => Promise<BlockCollectionFollowResult>;
  /** `true` while a follow request is in flight (including the viewer's confirm). */
  pending: boolean;
  /**
   * The last request's failure, or `null`. Cleared at the start of the next
   * `setFollow`. A dismissal lands here too — read `.declined`.
   */
  error: CollectionFollowError | null;
}

/**
 * Follow / unfollow a collection for the viewer through the host-mediated
 * `SET_COLLECTION_FOLLOW` → `COLLECTION_FOLLOW_RESULT` bridge.
 *
 * TOKEN-INDEPENDENT — this needs NO block scope and sends no token. The host
 * calls the session-authed `collection.follow` / `collection.unfollow`
 * procedures, which self-bind to the viewer server-side, so `collectionId` is
 * the only thing a block influences.
 *
 * 🔴 EVERY CALL OPENS A HOST-CHROME CONSENT CONFIRM NAMING THE COLLECTION, and
 * that click is the ONLY consent this path has ever had. The HTTP predecessor's
 * `collections:write:self` scope was consent-exempt server-side and prompted
 * nobody, so moving to this bridge TIGHTENS the path — it does not loosen it.
 * What it costs is the manifest `scopes` declaration a moderator reads before
 * install. Do not add a "skip the confirm" option; there is nothing behind it.
 *
 * Because the reply waits on a person, the request carries
 * {@link HUMAN_INTERACTION_TIMEOUT_MS} (10 min) rather than the ~30s protocol
 * default — it resolves the instant the viewer acts, and the ceiling only bounds
 * an abandoned dialog.
 *
 * 🔴 THE HOST RESOLVES THE COLLECTION'S NAME ITSELF and bounds that to 20
 * DISTINCT ids per block instance. Past the cap it refuses with
 * `collection-unavailable` — the SAME code a collection the viewer cannot see
 * gets — so a block driving many ids degrades into "we cannot act on this",
 * never into an enumeration oracle. Repeats of an already-admitted id are free
 * forever, so re-following a collection the viewer has already been asked about
 * keeps working.
 *
 * @example
 * const { setFollow, pending } = useCollectionFollow();
 * const { requestSignIn } = useRequestSignIn();
 *
 * const toggle = async () => {
 *   setFollowed((f) => !f); // optimistic
 *   try {
 *     const r = await setFollow({ collectionId, follow: !followed });
 *     setFollowed(r.followed); // adopt the host's echo, not the guess
 *   } catch (e) {
 *     setFollowed(followed); // roll back
 *     if (e instanceof CollectionFollowError) {
 *       if (e.signInRequired) return requestSignIn();
 *       if (e.declined) return; // the viewer said no — say nothing
 *       showToast(e.message);
 *     }
 *   }
 * };
 */
export function useCollectionFollow(): UseCollectionFollow {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CollectionFollowError | null>(null);

  // Same guard as `useTip`/`useWildcardPack`: this request can outlive the
  // component by up to ten minutes (the viewer may leave the confirm open), so
  // it is the LONGEST-lived state write in the package. Writing after unmount
  // is not merely a warning here — a `pending` toggled on an unmounted control
  // is state nobody can clear.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setFollow = useCallback(
    async (args: {
      collectionId: number;
      follow: boolean;
    }): Promise<BlockCollectionFollowResult> => {
      if (mountedRef.current) {
        setPending(true);
        setError(null);
      }
      try {
        const reply = await sendTypedRequest(
          getTransport(),
          {
            type: 'SET_COLLECTION_FOLLOW',
            payload: { collectionId: args.collectionId, follow: args.follow },
          },
          'COLLECTION_FOLLOW_RESULT',
          // See the `'human'` bucketing in `internal/requestTimeouts.ts`: the
          // host answers only when the viewer clicks or dismisses its confirm.
          { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
        );
        if (reply.error || !reply.result) {
          // 🔴 `||`, NOT `??` — the opposite of `useWildcardPack`, and for the
          // opposite reason. `isValidCollectionFollowResult` gates `error` on
          // SHAPE only (it has to: the channel carries free-text server
          // messages), so a host `error: ''` is a VALID reply that reaches here.
          // `??` would then throw an Error with an EMPTY message for an account
          // write, which renders as a blank failure. Fall through to a code that
          // at least names a real outcome.
          throw new CollectionFollowError(reply.error || 'collection-unavailable');
        }
        return reply.result;
      } catch (err: unknown) {
        // A transport timeout arrives as a plain Error; wrap it so callers have
        // ONE error type to test, with `.code` left undefined (it is not a host
        // refusal). Re-wrapping our own error would lose `.code`, so pass it
        // through.
        const wrapped =
          err instanceof CollectionFollowError
            ? err
            : new CollectionFollowError(err instanceof Error ? err.message : String(err));
        if (mountedRef.current) setError(wrapped);
        // 🔴 THROWN UNCONDITIONALLY, even when unmounted. The caller's `await`
        // is not the component — an app that persists the result (a toast queue,
        // a store) must still learn the write failed, and swallowing it here
        // would make an unmount look like a success.
        throw wrapped;
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [],
  );

  return { setFollow, pending, error };
}
