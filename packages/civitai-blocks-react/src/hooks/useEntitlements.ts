import { useCallback, useEffect, useRef, useState } from 'react';

import { isSignedIn } from '@civitai/app-sdk/blocks';

import { useBlockContext } from './useBlockContext.js';
import { useBlockToken } from './useBlockToken.js';
import { useHostOrigin } from './useHostOrigin.js';
import { useRequestSequencer } from './useRequestSequencer.js';

/**
 * Backstop timeout for the direct REST entitlements GET (see {@link useTip} /
 * {@link useGenerationResources} for why direct-fetch hooks need their own bound).
 */
const ENTITLEMENTS_TIMEOUT_MS = 30_000;

/**
 * How long the hook waits for `useHostOrigin()` before declaring the block
 * un-embedded. A BOUND, not an immediate error: the host origin is absent on
 * EVERY boot and lands a tick or two after mount with `BLOCK_INIT`, so erroring
 * on the first `!host` would flash a spurious error on every healthy block.
 * Only its CONTINUED absence is the fault.
 *
 * Equal to {@link ENTITLEMENTS_TIMEOUT_MS} by coincidence, not derivation: this
 * bounds a wait for the HOST to introduce itself, that one bounds a request
 * already in flight. Two constants so tuning either cannot retune the other.
 */
const HOST_ORIGIN_WAIT_MS = 30_000;

/** One thing the viewer owns, as the platform recorded it. */
export interface Entitlement {
  /** The `id` of the good from this app's manifest. */
  goodId: string;
  /** `good` for an ordinary purchase, `app_unlock` for a paid-app unlock. */
  kind: string;
  /** The opaque payload the manifest declared. The platform never interprets it. */
  payload: Record<string, unknown>;
  grantedAt: string;
}

export interface UseEntitlements {
  /**
   * What the viewer owns, or `null` until the first successful fetch.
   *
   * Stays `null` for an anonymous viewer, who is never asked: see
   * {@link UseEntitlements.unauthenticated}. `owns()` is `false` either way,
   * which is the right answer for someone with no account to own anything on.
   */
  entitlements: Entitlement[] | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure, or `null`. Cleared at the start of the next fetch.
   * Also carries the NO-HOST-ORIGIN terminal state: if `BLOCK_INIT` never lands,
   * `loading` drops to `false` and this becomes a named `Error` after
   * {@link HOST_ORIGIN_WAIT_MS} rather than the hook spinning forever.
   */
  error: Error | null;
  /** Re-read entitlements (e.g. immediately after a successful purchase). */
  refetch: () => void;
  /**
   * `true` when there is NO SIGNED-IN VIEWER, so there is nobody for this app
   * to have sold anything to.
   *
   * 🔴 THIS IS THE ONE CASE WHERE "you own nothing" IS THE RIGHT ANSWER, and
   * without it the guidance on `error` produces the wrong screen. A page App
   * Block is a PUBLIC surface: a logged-out viewer's block token carries an
   * anonymous subject and the endpoint refuses it — so rendering a retry notice
   * on `error` alone would show every anonymous first paint a button that can
   * never succeed. Branch on this first: show the unpurchased/sign-in state,
   * not a failure.
   *
   * 🔴 DERIVED FROM THE VIEWER, NOT FROM A RESPONSE, and that is the whole
   * point. It is `isSignedIn(useBlockContext().viewer) === false` once
   * `BLOCK_INIT` has landed — `null` viewer means anonymous, the one wire value
   * every host version agrees on (`ViewerInfo` / `isSignedIn` in
   * `@civitai/app-sdk/blocks` carry the adjudication). Three consequences worth
   * knowing:
   *
   *   - It is knowable BEFORE any request fires, so an anonymous viewer costs
   *     no round trip: the hook SKIPS the GET entirely (see `refetch`).
   *   - `error` stays `null` for an anonymous viewer. Nothing failed; we never
   *     asked. A retry notice would be wrong twice over.
   *   - It is `false` until `BLOCK_INIT` lands, because before that the viewer
   *     is UNKNOWN rather than absent (the pre-init snapshot's `viewer` is also
   *     `null`). A block that never gets init therefore reaches its terminal
   *     `error` with this flag `false` — an unembedded block is not a sign-in
   *     problem, and `test/hostOriginAbsent.test.tsx` pins exactly that.
   *
   * 🔴 IT IS NOT "the status was 403", AND A RESPONSE-DERIVED PREDICATE CANNOT
   * WORK HERE. A 403 on this route has seven producers, and the anonymous case
   * is NOT one of the uncoded ones: `withBlockScope` puts `goods:read:self` in
   * its `:self` arm, so an anonymous subject is rejected as
   * `code: 'context_binding'` — the same code a wrong `modelId` produces. There
   * is no reachable uncoded 403 on this route, so an earlier
   * `status === 403 && code == null` predicate could never fire, and keying on
   * `context_binding` would conflate "not signed in" with a context mismatch.
   * Every 403 now reaches `error` with the server's own wording, which is where
   * a developer can read the cause — including the likeliest one in practice, a
   * manifest missing `goods:read:self` (`insufficient_scope`).
   */
  unauthenticated: boolean;
  /**
   * `true` if the viewer owns `goodId`. 🔴 Returns `false` while
   * `entitlements` is still `null`, which is ALSO what a failed read looks
   * like — so never gate paid content on this alone without checking
   * `loading` and `error`. A refused read renders as "you own nothing", and
   * treating that as authoritative takes away something the viewer paid for.
   */
  owns: (goodId: string) => boolean;
}

/**
 * Read what the viewer owns FROM THIS APP through the block-token-gated
 * `GET /api/v1/blocks/entitlements` REST endpoint (scope `goods:read:self`).
 *
 * The reply is scoped server-side to the calling app's own `appBlockId`, so an
 * app can only ever see what it itself sold — which is why this scope is
 * consent-EXEMPT: there is no third-party data to consent to. A read-only app
 * that just wants to render "you own this" therefore needs no purchase power
 * and triggers no re-consent prompt; only `goods:purchase:self` does.
 *
 * Revoked entitlements are excluded by the server — "what do I own" must not
 * include what was taken back.
 *
 * Only the LATEST request may write state: a reply superseded by a newer
 * `refetch`, or one landing after unmount, is dropped.
 *
 * An ANONYMOUS viewer is answered without a request: `unauthenticated` is read
 * off `BLOCK_INIT`'s viewer, so the hook settles to `loading: false` with no
 * `error` and never issues the GET the server would refuse anyway.
 *
 * @example
 * const { owns, loading, error, unauthenticated, refetch } = useEntitlements();
 * if (loading) return <Spinner />;
 * // Order matters. `unauthenticated` is the state no retry can clear — a
 * // logged-out viewer of a public page block — and it is NOT an `error`.
 * if (unauthenticated) return <SignInToBuy />;
 * if (error) return <RetryNotice onRetry={refetch} />;   // NOT "you own nothing"
 * return owns('extra-slots') ? <Unlocked /> : <BuyButton onDone={refetch} />;
 */
export function useEntitlements(): UseEntitlements {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
  const { ready, viewer } = useBlockContext();
  const [entitlements, setEntitlements] = useState<Entitlement[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 🔴 DERIVED, NOT STATE. `ready` is load-bearing and is the whole reason this
  // is not a bare `!isSignedIn(viewer)`: the pre-`BLOCK_INIT` snapshot also
  // carries `viewer: null`, so without the gate every block would report
  // "signed out" for the first frames of every healthy boot — and a block whose
  // init NEVER lands would report it forever, sending an embedded block's
  // terminal host-origin error to a sign-in screen it cannot act on.
  const anonymous = ready && !isSignedIn(viewer);

  // Not a sequencing guard: drained only by the unmount cleanup, so it exists
  // to abort on unmount and let a superseded request's socket close.
  // `useRequestSequencer` supplies the latest-wins predicate.
  const inFlight = useRef<Set<AbortController>>(new Set());
  const seq = useRequestSequencer();
  useEffect(() => {
    const controllers = inFlight.current;
    return () => {
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, []);

  // Bounded wait for the host origin. Re-armed whenever `host` changes and
  // cleared the moment one arrives, so the terminal error is reachable ONLY
  // when the origin is still absent a full HOST_ORIGIN_WAIT_MS after mount.
  useEffect(() => {
    if (host) return;
    const id = setTimeout(() => {
      setLoading(false);
      setError(
        new Error(
          `useEntitlements: host origin not established after ${HOST_ORIGIN_WAIT_MS}ms (no BLOCK_INIT — the block is probably not embedded).`,
        ),
      );
    }, HOST_ORIGIN_WAIT_MS);
    return () => clearTimeout(id);
  }, [host, seq]);

  const refetch = useCallback(() => {
    if (!host) return;
    // 🔴 ANONYMOUS VIEWERS ARE ANSWERED WITHOUT A REQUEST — a deliberate choice,
    // not an omission. Entitlements are bound to the token SUBJECT, and an
    // anonymous subject can hold none, so the server's answer is knowable and
    // constant (a `context_binding` 403 from `withBlockScope`'s `:self` arm).
    // A page block is a PUBLIC surface, so this is the common path rather than
    // an edge: firing the GET would spend a round trip per anonymous paint to
    // learn something `BLOCK_INIT` already said, and would leave a 403 in every
    // developer's network tab that reads as a bug in their manifest.
    //
    // `error` is left NULL on purpose. Nothing failed — `unauthenticated` is
    // the terminal state, and it is the one the documented render order checks
    // before `error`.
    if (anonymous) {
      seq.begin(); // invalidate any in-flight read from a previous signed-in state
      setEntitlements(null);
      setError(null);
      setLoading(false);
      return;
    }
    const token = seq.begin();
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    inFlight.current.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), ENTITLEMENTS_TIMEOUT_MS);
    fetch(`${host}/api/v1/blocks/entitlements`, {
      headers: { Authorization: `Bearer ${raw}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { entitlements?: Entitlement[]; error?: string; code?: string }
          | null;
        if (!seq.isCurrent(token)) return;
        if (!res.ok || body == null || !Array.isArray(body.entitlements)) {
          // 🔴 NO RESPONSE IS EVER CLASSIFIED AS "NOT SIGNED IN" HERE, AND THAT
          // IS THE FIX RATHER THAN AN OVERSIGHT. `unauthenticated` is derived
          // from the viewer (see the field's doc); by the time a reply lands we
          // already know a viewer was signed in, because otherwise no request
          // was issued at all.
          //
          // The predicate that used to live here — `status === 403 && code ==
          // null` — was DEAD. `src/pages/api/v1/blocks/entitlements.ts` wraps
          // the handler in `withBlockScope(…, { requiredScope: 'goods:read:self'
          // })`, and that middleware puts a `:self` scope with an anonymous
          // subject in its `context_binding` arm, so the anonymous 403 arrives
          // CODED. No uncoded 403 is reachable on this route, so the flag could
          // never fire for the one case it exists for. Re-keying it on
          // `context_binding` would be worse: that code is also what a wrong
          // `modelId` and an array-form query param produce, so a signed-in
          // viewer would be told to sign in.
          //
          // So every 403 — coded or not, parseable or not — surfaces on `error`
          // with the server's own wording, which is where a developer can read
          // the real cause. Pinned by the CONTROL cases in
          // `test/useEntitlements.test.tsx`.
          throw new Error(body?.error ?? `entitlements request failed (${res.status})`);
        }
        setEntitlements(body.entitlements);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!seq.isCurrent(token)) return;
        setError(
          controller.signal.aborted
            ? new Error(
                `useEntitlements: request aborted (timed out after ${ENTITLEMENTS_TIMEOUT_MS}ms or the hook unmounted).`,
              )
            : err instanceof Error
              ? err
              : new Error(String(err)),
        );
        setLoading(false);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        inFlight.current.delete(controller);
      });
  }, [anonymous, host, raw, seq]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const owns = useCallback(
    (goodId: string) => (entitlements ?? []).some((e) => e.goodId === goodId),
    [entitlements],
  );

  return { entitlements, loading, error, unauthenticated: anonymous, refetch, owns };
}
