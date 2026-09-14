import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockCreatePostHostError,
  BlockCreatePostRequest,
  BlockCreatePostResult,
  BlockPostSource,
} from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../internal/requestTimeouts.js';
import { getTransport } from '../internal/singleton.js';
import { RequestTimeoutError, sendTypedRequest } from '../internal/transport.js';

export type {
  BlockCreatePostHostError,
  BlockCreatePostRequest,
  BlockCreatePostResult,
  BlockPostSource,
};

/**
 * The closed set of HOST refusal codes, as a runtime Set.
 *
 * 🔴 THIS EXISTS BECAUSE THE ERROR CHANNEL IS NOT AN ENUM. The host sends either
 * one of these codes or a free-text server message (a rate limit, a blocked
 * title, a refused gallery attach), so "is this a code?" is a MEMBERSHIP
 * question at runtime, not a type-level one — a `switch` over the union type
 * would silently treat `"You do not have permission…"` as unmatched prose while
 * a typo'd literal compiled fine. Derived from the array below so the two cannot
 * drift, and mirrored from civitai/civitai's `CREATE_POST_HOST_ERRORS`.
 */
export const CREATE_POST_ERROR_CODES = [
  'review-mode',
  'block is not ready',
  'sign in to post',
  'no images to post',
  'no block token',
  'declined',
] as const satisfies readonly BlockCreatePostHostError[];

const CODE_SET: ReadonlySet<string> = new Set(CREATE_POST_ERROR_CODES);

/**
 * `true` when `error` is one of the host's CLOSED refusal codes rather than a
 * free-text server message.
 *
 * Use it before comparing against a code — see {@link CREATE_POST_ERROR_CODES}
 * for why equality alone is not enough.
 */
export function isCreatePostErrorCode(error: string): error is BlockCreatePostHostError {
  return CODE_SET.has(error);
}

/**
 * A post-creation failure.
 *
 * `.code` is the host's refusal code when the host refused, and `undefined`
 * otherwise.
 *
 * 🔴 `.code === undefined` IS NOT BY ITSELF "A SERVER MESSAGE WORTH SHOWING".
 * TWO different failures land there: a server message the host forwarded
 * verbatim, and a TRANSPORT TIMEOUT whose `.message` is an SDK-internal string.
 * **Check `.timedOut` first**; `.code === undefined && !timedOut` is the branch
 * whose `.message` is meant to be rendered.
 */
export class CreatePostError extends Error {
  /** The closed host refusal code, or `undefined` for a server/transport error. */
  readonly code?: BlockCreatePostHostError;
  /**
   * The SDK transport gave up waiting — no reply ever arrived.
   *
   * 🔴 CHECK THIS BEFORE SHOWING `.message`, and 🔴 DO NOT PRESENT IT AS
   * "NOTHING HAPPENED". A timeout also has `code === undefined`, so "no code ⇒ a
   * server message worth rendering" is false and acting on it puts an
   * SDK-internal string in front of a viewer. More importantly the write may
   * have LANDED and only the reply failed to arrive — and here the write is a
   * PUBLIC POST under the viewer's name. Tell the viewer to check their profile;
   * never retry automatically, which is how a duplicate post happens.
   */
  readonly timedOut: boolean;
  /**
   * The viewer DISMISSED the host's consent confirm, so NO POST WAS CREATED.
   *
   * 🔴 Not an error condition to shout about, and it is trustworthy in the one
   * direction that matters: the host takes its consent latch SYNCHRONOUSLY
   * before the write, so `declined` can never be reported for a post that
   * landed. Revert optimistic state and render nothing.
   */
  readonly declined: boolean;
  /**
   * There is no session. Route this into `useRequestSignIn()` rather than
   * showing an error — the viewer's next step is signing in, not retrying.
   */
  readonly signInRequired: boolean;

  constructor(error: string, opts?: { timedOut?: boolean }) {
    super(error);
    this.name = 'CreatePostError';
    this.timedOut = opts?.timedOut === true;
    if (isCreatePostErrorCode(error)) this.code = error;
    this.declined = error === 'declined';
    this.signInRequired = error === 'sign in to post';
  }
}

/** What {@link useCreatePostFromApp} returns. */
export interface UseCreatePostFromApp {
  /**
   * Ask the host to publish a REAL Post on the viewer's profile from this app's
   * OWN outputs, and resolve with the created post.
   *
   * REJECTS with a {@link CreatePostError} on every non-success — including
   * `declined`, which means the viewer dismissed the confirm and NO POST EXISTS.
   * Check `.declined` before rendering a failure.
   */
  createPost: (args: BlockCreatePostRequest) => Promise<BlockCreatePostResult>;
  /** `true` while a request is in flight (including the viewer's confirm). */
  pending: boolean;
  /**
   * The last request's failure, or `null`. Cleared at the start of the next
   * `createPost`. A dismissal lands here too — read `.declined`.
   */
  error: CreatePostError | null;
}

/**
 * Publish a REAL, PUBLISHED Post on the VIEWER'S profile from the calling app's
 * OWN outputs, through the host-mediated `CREATE_POST_FROM_APP` →
 * `CREATE_POST_RESULT` bridge.
 *
 * The strictly-more-consequential sibling of `usePublishGenerationOutputs()`:
 * that one makes a bare `Image` row with no post, no feed presence, no reward
 * and no notification; this one makes public, feed-visible, reward-earning
 * content under the viewer's byline.
 *
 * 🔴 REQUIRES THE `posts:write:self` SCOPE, which is SENSITIVE and
 * CONSENT-GATED. Declare it in your manifest WITH a `scopeJustifications` entry
 * — the server rejects the manifest at submit without one — and expect the
 * viewer to be prompted to grant it before the first call succeeds.
 *
 * 🔴 THE SCOPE GRANT IS NOT THE CONSENT. Every call additionally opens a
 * host-chrome confirm, and what that confirm shows is the SERVER'S resolution of
 * your request, never your strings: the tag names that will ACTUALLY be applied,
 * host-fetched model and version names for a gallery attach, and real
 * thumbnails. A block cannot show one post and publish another.
 *
 * 🔴 NO ARM OF `sources` TAKES A URL. Name a workflow from this app's own
 * subqueue plus indexes into its outputs, or `Image` ids from a previous
 * `usePublishGenerationOutputs()` publish. The server re-verifies both.
 *
 * ⚠️ POSTING A PUBLISHED IMAGE REMOVES IT FROM THIS APP'S OWN GRID. The
 * app-scoped read behind `useGatedImages()` is conjoined with `postId IS NULL`,
 * so an image that joins a post stops resolving there. An app cannot both keep
 * an image in its shared grid and let the viewer post it.
 *
 * Because the reply waits on a person, the request carries
 * {@link HUMAN_INTERACTION_TIMEOUT_MS} (10 min) rather than the ~30s protocol
 * default — it resolves the instant the viewer acts, and the ceiling only bounds
 * an abandoned dialog.
 *
 * @example
 * const { createPost, pending } = useCreatePostFromApp();
 * const { requestSignIn } = useRequestSignIn();
 *
 * const share = async () => {
 *   try {
 *     const post = await createPost({
 *       sources: [{ kind: 'workflow', workflowId: w.workflowId, imageIndexes: [0, 2] }],
 *       title: 'Made with Sticker Studio',
 *     });
 *     showToast(`Posted! ${post.url}`);
 *   } catch (e) {
 *     if (e instanceof CreatePostError) {
 *       if (e.signInRequired) return requestSignIn();
 *       if (e.declined) return;                    // the viewer said no — say nothing
 *       if (e.timedOut) return showToast('Still working — check your profile.');
 *       showToast(e.message);                      // a real server message, safe to render
 *     }
 *   }
 * };
 */
export function useCreatePostFromApp(): UseCreatePostFromApp {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CreatePostError | null>(null);

  // Same guard as `useCollectionFollow`: this request can outlive the component
  // by up to ten minutes (the viewer may leave the confirm open), so a `pending`
  // toggled on an unmounted control is state nobody can clear.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const createPost = useCallback(
    async (args: BlockCreatePostRequest): Promise<BlockCreatePostResult> => {
      if (mountedRef.current) {
        setPending(true);
        setError(null);
      }
      try {
        const reply = await sendTypedRequest(
          getTransport(),
          {
            type: 'CREATE_POST_FROM_APP',
            payload: {
              sources: args.sources,
              ...(args.title !== undefined ? { title: args.title } : {}),
              ...(args.detail !== undefined ? { detail: args.detail } : {}),
              ...(args.tags !== undefined ? { tags: args.tags } : {}),
              ...(args.modelVersionId !== undefined
                ? { modelVersionId: args.modelVersionId }
                : {}),
            },
          },
          'CREATE_POST_RESULT',
          // See the `'human'` bucketing in `internal/requestTimeouts.ts`: the
          // host answers only when the viewer clicks or dismisses its confirm.
          { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
        );
        if (reply.error || !reply.result) {
          // 🔴 `||`, NOT `??`. `isValidCreatePostResult` gates `error` on SHAPE
          // only (it has to: the channel carries free-text server messages), so
          // a host `error: ''` is a VALID reply that reaches here. `??` would
          // then throw an Error with an EMPTY message for a public post, which
          // renders as a blank failure. Fall through to a code that at least
          // names a real outcome.
          throw new CreatePostError(reply.error || 'no images to post');
        }
        return reply.result;
      } catch (err: unknown) {
        // A transport timeout arrives as a plain Error; wrap it so callers have
        // ONE error type to test, with `.code` left undefined (it is not a host
        // refusal). Re-wrapping our own error would lose `.code`, so pass it
        // through.
        const wrapped =
          err instanceof CreatePostError
            ? err
            : new CreatePostError(err instanceof Error ? err.message : String(err), {
                // Structural, not a message match — see `RequestTimeoutError`.
                timedOut: err instanceof RequestTimeoutError,
              });
        if (mountedRef.current) setError(wrapped);
        // 🔴 THROWN UNCONDITIONALLY, even when unmounted. The caller's `await`
        // is not the component — an app that persists the result must still
        // learn the write failed, and swallowing it here would make an unmount
        // look like a success.
        throw wrapped;
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [],
  );

  return { createPost, pending, error };
}
