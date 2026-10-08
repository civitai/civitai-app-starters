import { useCallback, useEffect, useRef, useState } from 'react';

import { BLOCK_SCOPES } from '@civitai/app-sdk/blocks';

import { withConsentRetry } from '../internal/withConsentRetry.js';
import { getTransport } from '../transport/singleton.js';
import { resolveIdempotencyKey } from '../transport/transport.js';
import type { ConsentRetryOptions } from './consentRetryOptions.js';
import type { Entitlement } from './useEntitlements.js';
import { useBlockToken } from './useBlockToken.js';
import { useBuzzPurchase } from './useBuzzPurchase.js';
import { useHostOrigin } from './useHostOrigin.js';

/**
 * The consent-gated scope a purchase needs.
 *
 * 🔴 `goods:purchase:self`, NEVER `goods:read:self` — `BLOCK_SCOPES`' own
 * comment draws the line: the read is consent-EXEMPT (server-scoped to the
 * calling app's own goods, so there is nothing third-party to consent to) while
 * money out of the viewer's balance always needs an explicit grant. "Do not
 * collapse the two." Prompting for the read would ask for the wrong thing and
 * the wait below would never see it granted.
 */
const GOOD_PURCHASE_SCOPES = [BLOCK_SCOPES.GOODS_PURCHASE_SELF] as const;

/**
 * Backstop timeout for the direct REST purchase POST. Like {@link useTip} (and
 * unlike the postMessage hooks), this talks to the HTTP API directly, so it
 * needs its OWN bound — otherwise a hung request never rejects.
 */
const GOOD_PURCHASE_TIMEOUT_MS = 30_000;

/** Which good to buy, and optionally the price the app showed the viewer. */
export interface GoodPurchaseParams {
  /** The `id` of a good declared in this app's approved manifest. */
  goodId: string;
  /**
   * The price the app DISPLAYED. Optional, and worth passing: the server
   * charges its OWN price and refuses when this disagrees, so sending it turns
   * "the app showed a stale price" into a clean refusal instead of a viewer
   * being charged an amount they never saw.
   */
  expectedPriceBuzz?: number;
}

/** Optional per-purchase controls. */
export interface GoodPurchaseOptions extends ConsentRetryOptions {
  /**
   * A STABLE idempotency key for this logical purchase. Reuse the SAME value
   * when RETRYING a purchase whose response was lost (timeout / network drop)
   * so the server replays the first terminal result instead of charging twice.
   * Omit → a fresh key per `purchase()` call.
   *
   * 🔴 **FORMAT: `^[A-Za-z0-9_-]{1,64}$` — letters, digits, `_` and `-` only, at
   * most 64 characters, and NO COLONS.** `/api/v1/blocks/goods/purchase` rejects
   * anything else with a **400** (`"Invalid request body"` + a zod `flatten()` in
   * `details`), so a composite key like `good:extra-slots:1` fails every time.
   *
   * 🔴 A key that fails this is **REFUSED before the POST**, with
   * `InvalidIdempotencyKeyError` — nothing is sent and nothing is spent, and it
   * is NOT a {@link GoodPurchaseRefusal} (that would assert the server
   * considered and declined the purchase, which never happened). The key is
   * never sanitised for you: rewriting an idempotency key would break the
   * identity it exists to carry. Validate with `isValidBlockIdempotencyKey` from
   * `@civitai/app-sdk/blocks` if you compose keys dynamically.
   */
  idempotencyKey?: string;
  /**
   * When the viewer cannot afford the good, open the host's Buzz top-up modal
   * and — only if they actually bought Buzz — retry the purchase ONCE.
   * Default `false`, so the refusal surfaces and the app decides.
   *
   * ⚠️ PASS `expectedPriceBuzz` WITH THIS. It is what the modal is opened with,
   * so without it the viewer sees no suggested amount, may top up less than the
   * good costs, and the single retry re-refuses `insufficient_funds` after real
   * fiat was spent. The option works without it; it just works worse in the one
   * direction that costs the viewer money.
   *
   * 🔴 THE RETRY REUSES THE SAME IDEMPOTENCY KEY, DELIBERATELY. The server's
   * own comment on this path is that an `insufficient_funds` refusal leaves the
   * key FREE precisely because "an identical retry CAN reach a different
   * verdict — a top-up"; it caches terminal results, not this one. Minting a
   * fresh key here would work too, but it would make a lost response on the
   * retry unrecoverable, which is the thing idempotency keys exist to prevent.
   *
   * ⚠️ RECONCILED WITH THE POLICY NEXT DOOR, which a reader will hit.
   * `useBuzzWorkflow` says a resolved-failed generation is never a top-up cue
   * (those are caps Buzz does not raise) and that running out of Buzz there
   * rejects without a structural marker, so the APP decides a top-up from the
   * balance. This option does not contradict that: it defaults to `false`, and
   * it keys on the REASON (`insufficient_funds`, which a goods purchase DOES
   * report structurally) rather than on "the call failed", so it never offers
   * Buzz for a failure Buzz cannot fix. What it buys, and the only reason it is
   * in the library at all rather than left to each app, is the same-key retry
   * above — a server contract an app gets wrong in the expensive direction.
   */
  topUpOnInsufficientFunds?: boolean;
}

/** The successful purchase echo the endpoint returns. */
export interface GoodPurchaseResult {
  ok: true;
  purchase: { id: string; goodId: string; priceBuzz: number };
  entitlement: Entitlement;
}

/**
 * A refusal the server produced deliberately, as opposed to a transport
 * failure.
 *
 * `reason` is the machine-readable discriminator where one exists — branch on it
 * rather than on `message`, which is viewer-facing copy and will be reworded.
 *
 * 🔴 `reason` IS OFTEN `undefined`, AND A CONSUMER MUST HANDLE THAT. Only the
 * SERVICE-level refusals carry one (`insufficient_funds`, `ledger_conflict`,
 * `charge_failed`, `charge_unknown`, the price-disagreement and
 * already-owned cases). The ENDPOINT's own refusals return `{ error }` alone:
 * the 404 for an unavailable good, the 429 rate limit, the daily-cap 400 and
 * every idempotency refusal (409 / 422 / 503). So a `switch (reason)` with no
 * default silently swallows a material fraction of real failures — always fall
 * back to `status` plus `message`.
 */
export class GoodPurchaseRefusal extends Error {
  readonly status: number;
  readonly reason: string | undefined;
  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = 'GoodPurchaseRefusal';
    this.status = status;
    this.reason = reason;
  }
}

export interface UseGoodPurchase {
  /**
   * Buy a manifest-declared good for the viewer. Resolves with the server's
   * echo, including the entitlement it granted. REJECTS with a
   * {@link GoodPurchaseRefusal} on any 4xx/5xx — read `reason` to tell
   * `insufficient_funds` from a stale price or a rate limit.
   *
   * Two non-refusal rejections, distinguishable by `name`:
   * - the 30s bound elapsed → a plain `Error` naming the timeout. A REAL
   *   failure; the charge may have landed, so retry with the SAME
   *   `idempotencyKey`.
   * - the hook unmounted first → an `Error` with `name === 'AbortError'`, so a
   *   caller that ignores navigate-away rejections can keep doing so. The same
   *   same-key retry advice applies if the component comes back.
   *
   * 🔴 THAT CLASSIFICATION IS DECIDED BY THE ABORT STATE, NOT BY WHETHER A BODY
   * PARSED, and it holds wherever the abort lands — including DURING the body
   * read, which is the common shape when the headers arrive first. The one
   * documented exception is the opposite race: a refusal the server had already
   * delivered AND the hook had already parsed stays a {@link GoodPurchaseRefusal}
   * even if the abort fires in the same tick, because a refusal we actually read
   * is more informative than an abort, and `reason` is what the top-up branch
   * needs. So an `AbortError` here never hides a refusal, and a refusal here
   * never hides a timeout.
   */
  purchase: (
    params: GoodPurchaseParams,
    options?: GoodPurchaseOptions,
  ) => Promise<GoodPurchaseResult>;
  /** `true` while a purchase POST is in flight. */
  loading: boolean;
  /** The last purchase's failure, or `null`. Cleared at the start of the next call. */
  error: Error | null;
}

/**
 * Buy a DIGITAL GOOD for the viewer through the block-token-gated
 * `POST /api/v1/blocks/goods/purchase` REST endpoint (scope
 * `goods:purchase:self`).
 *
 * Direct-fetch against the VALIDATED host origin (`useHostOrigin()`) with the
 * block bearer token, the same security-reviewed pattern as {@link useTip}. The
 * BUYER is always the token subject — the server self-binds it and the block
 * never supplies a user id, so there is no client-supplied value on the money
 * path.
 *
 * 🔴 BUYING A GOOD AND BUYING BUZZ ARE OPPOSITE DIRECTIONS, AND THIS HOOK
 * TOUCHES BOTH. A good is Buzz flowing FROM the viewer TO the app owner. The
 * top-up modal this hook can open ({@link useBuzzPurchase}) is fiat flowing INTO
 * the viewer's balance. They are different rails with different ledgers; the
 * only thing they share is that one can unblock the other.
 *
 * ⚠️ THE PLATFORM RENDERS NO CONFIRMATION FOR THE PURCHASE ITSELF. This is a
 * plain authed POST, so whatever confirm UI the viewer sees is the APP's. Spend
 * is bounded by the good's manifest-reviewed price and the viewer's daily cap,
 * but a good can be priced near that cap where a tip cannot — so show the price
 * and get an explicit action before calling this.
 *
 * @example
 * const { purchase, loading, error } = useGoodPurchase();
 * const { entitlement } = await purchase(
 *   { goodId: 'extra-slots', expectedPriceBuzz: 250 },
 *   { topUpOnInsufficientFunds: true },
 * );
 */
export function useGoodPurchase(): UseGoodPurchase {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
  const { openPurchaseModal } = useBuzzPurchase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const inFlight = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    mountedRef.current = true;
    const controllers = inFlight.current;
    return () => {
      mountedRef.current = false;
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, []);

  const postOnce = useCallback(
    async (
      params: GoodPurchaseParams,
      idempotencyKey: string,
    ): Promise<GoodPurchaseResult> => {
      const controller = new AbortController();
      inFlight.current.add(controller);
      // Which abort fired is not recoverable from the signal — both a timeout
      // and the unmount cleanup set `aborted` — so record it at the source.
      // The two need OPPOSITE handling below, and conflating them is how a
      // money-path timeout gets swallowed by an unmount-ignoring caller.
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, GOOD_PURCHASE_TIMEOUT_MS);
      // 🔴 THE BEARER IS READ LIVE, NOT OUT OF THE RENDER CLOSURE — WITHOUT THIS
      // THE AUTOMATIC CONSENT RETRY CANNOT WORK. A consent grant re-mints the
      // token and pushes `TOKEN_REFRESH`; React then re-renders and `raw` gets a
      // new value, but the in-flight `purchase` call is still holding the
      // closure created at call time, whose `raw` is the PRE-grant token. Retry
      // with that and the server sees the same scope-less token and refuses
      // again — a retry that could never succeed, for a grant that did.
      //
      // ⚠️ `|| raw` CANNOT SUBSTITUTE A DIFFERENT VALUE, and an earlier version
      // of this comment claimed it covered "the pre-init case" as though it
      // could. `raw` comes from `useBlockToken()`, which returns
      // `useTransportSnapshot().token` — the SAME snapshot this line reads, one
      // render older. The token only ever goes sentinel-empty → real, so
      // whenever the live read is empty the closure's `raw` is empty too. It is
      // an equal-valued default, not a second source; the LIVE READ is the part
      // that does the work.
      const bearer = getTransport().getSnapshot().token.raw || raw;
      try {
        const res = await fetch(`${host}/api/v1/blocks/goods/purchase`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goodId: params.goodId,
            ...(params.expectedPriceBuzz != null
              ? { expectedPriceBuzz: params.expectedPriceBuzz }
              : {}),
            idempotencyKey,
          }),
          signal: controller.signal,
        });
        // 🔴 AN ABORT DURING THE BODY READ MUST NOT BE SWALLOWED AS "no body".
        // With a real `fetch` the response headers can arrive and the BODY still
        // be in flight; aborting then rejects `res.json()` with an `AbortError`.
        // A blanket `.catch(() => null)` turned that into `bodyJson === null`,
        // and the classification below — which reads the BODY rather than the
        // abort state — then produced exactly the wrong answer twice:
        //
        //   200 + unmount mid-body → a `malformed_success` refusal saying "the
        //   charge may have landed", reported to a caller the docs told to
        //   IGNORE navigate-away aborts. A purchase that SUCCEEDED, surfaced as
        //   a possible-charge failure.
        //
        //   4xx + timeout mid-body → `purchase request failed (<status>)` with
        //   `reason` lost, so the documented timeout error and its same-key
        //   retry advice never reached the caller.
        //
        // So a parse failure is only "no body" when the request was NOT aborted;
        // otherwise it is rethrown and the `catch` below classifies it by the
        // abort state, which is the only thing that can tell a timeout from an
        // unmount. A genuinely unparseable body on a live request still yields
        // `null` and the malformed/refusal handling below is unchanged.
        const bodyJson = (await res.json().catch((err: unknown) => {
          if (controller.signal.aborted) throw err;
          return null;
        })) as (Partial<GoodPurchaseResult> & { error?: string; reason?: string }) | null;
        if (!res.ok) {
          throw new GoodPurchaseRefusal(
            bodyJson?.error ?? `purchase request failed (${res.status})`,
            res.status,
            bodyJson?.reason,
          );
        }
        // 🔴 VALIDATE THE 2xx, because the declared return type promises an
        // entitlement. Without this an unparseable 200 resolved as `null` and a
        // wrong-shaped one resolved with `entitlement === undefined` — and the
        // documented usage destructures it, so both surfaced as a TypeError in
        // the app rather than as a failed purchase. On this hook the body IS the
        // granted entitlement, so a caller cannot recover from a silent absence.
        // `useEntitlements` in this same package performs the equivalent check.
        //
        // 🔴 `purchase` IS CHECKED TOO, and for the same reason `entitlement` is:
        // `GoodPurchaseResult` declares it REQUIRED, so `result.purchase.id` is
        // typed as safe and a body of `{ ok: true, entitlement }` alone would
        // resolve and then TypeError at the dereference. The live 200 path
        // (`src/pages/api/v1/blocks/goods/purchase.ts`) always sends all three,
        // so this is the type's promise being kept rather than a reachable
        // server bug — but an `as`-cast past an unvalidated required field is
        // exactly how the `entitlement` case reached an app in the first place.
        if (
          bodyJson == null ||
          bodyJson.ok !== true ||
          bodyJson.entitlement == null ||
          bodyJson.purchase == null
        ) {
          throw new GoodPurchaseRefusal(
            `purchase succeeded (${res.status}) but the response was not a purchase result — the charge may have landed; do not retry without the same idempotency key`,
            res.status,
            'malformed_success',
          );
        }
        return bodyJson as GoodPurchaseResult;
      } catch (err) {
        // A timeout or an unmount surfaces as a bare `AbortError`, which on a
        // money path is the least informative wording available: the caller
        // cannot tell it from a refusal, and the charge may have landed. Named
        // and bounded, as `useTip` and `useEntitlements` both do.
        //
        // 🔴 THE `!(err instanceof GoodPurchaseRefusal)` HALF IS NOT DEFENSIVE
        // PADDING — but it does NOT cover a refusal cut off mid-parse, which an
        // earlier version of this comment claimed. That case no longer reaches
        // here at all: an abort during the body read is rethrown above and
        // classified as an abort, because a body nobody could read carries no
        // `reason` to preserve.
        //
        // What it does cover is the race the other way round: the body had
        // ALREADY ARRIVED and parsed into an `insufficient_funds` 400 when the
        // abort fired underneath it — the 30s bound elapsing in the same tick
        // the refusal was thrown, or an unmount landing there. `signal.aborted`
        // is then true while we hold a complete, deliberate server refusal.
        // Rewriting it into the abort `Error` would strip `reason`, so the
        // top-up branch in `purchase` below would stop recognising it and the
        // viewer would be shown a raw failure instead of the Buzz modal. A
        // refusal we actually read always wins over an abort that raced it.
        if (controller.signal.aborted && !(err instanceof GoodPurchaseRefusal)) {
          if (timedOut) {
            // The BOUND fired. This is a real failure the caller must handle,
            // so it deliberately does NOT get the `AbortError` name below:
            // callers routinely ignore `AbortError` as "we navigated away", and
            // a silently-ignored money-path timeout is the worst outcome here.
            throw new Error(
              `useGoodPurchase: request aborted (timed out after ${GOOD_PURCHASE_TIMEOUT_MS}ms). The charge may or may not have landed — retry with the SAME idempotencyKey to find out safely.`,
            );
          }
          // 🔴 UNMOUNT. `name` stays `AbortError` on purpose: that is the
          // discriminator a caller uses to IGNORE a rejection its component no
          // longer cares about, and flattening it to a plain `Error` turns every
          // navigate-away into a reported failure. The MESSAGE still says what
          // happened — informative wording and a usable `name` are not a
          // trade-off. `useBuzzWorkflow`'s `watch()` does the same.
          const aborted = new Error(
            'useGoodPurchase: request aborted (the hook unmounted before the response arrived). The charge may or may not have landed — retry with the SAME idempotencyKey to find out safely.',
          );
          aborted.name = 'AbortError';
          throw aborted;
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
        inFlight.current.delete(controller);
      }
    },
    [host, raw],
  );

  const purchase = useCallback(
    async (
      params: GoodPurchaseParams,
      options?: GoodPurchaseOptions,
    ): Promise<GoodPurchaseResult> => {
      if (!host) {
        throw new Error(
          'useGoodPurchase: host origin not established yet (wait for BLOCK_INIT).',
        );
      }
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      // 🔴 MINTED ONCE, OUTSIDE BOTH RETRY MECHANISMS. The top-up retry below
      // and the consent retry wrapped around it BOTH re-post with this exact
      // value, so however many attempts a single `purchase()` makes, the server
      // sees ONE logical purchase. Moving it inside either closure turns an
      // automatic retry into a second charge.
      // 🔴 VALIDATED AND REFUSED, NOT SANITISED — see
      // `InvalidIdempotencyKeyError`. `/api/v1/blocks/goods/purchase` enforces
      // the same `^[A-Za-z0-9_-]{1,64}$` as the submit and tip paths.
      const idempotencyKey = resolveIdempotencyKey(
        'useGoodPurchase.purchase',
        options?.idempotencyKey,
      );
      try {
        return await withConsentRetry(
          getTransport(),
          GOOD_PURCHASE_SCOPES,
          async () => {
            try {
              return await postOnce(params, idempotencyKey);
            } catch (first) {
              const canTopUp =
                options?.topUpOnInsufficientFunds === true &&
                first instanceof GoodPurchaseRefusal &&
                first.reason === 'insufficient_funds';
              if (!canTopUp) throw first;

              // Only retry if the viewer ACTUALLY bought Buzz. `purchased: false`
              // is the ordinary "they closed the modal" case, and retrying it would
              // just reproduce the same refusal — so the original refusal is what
              // the app should see.
              const { purchased } = await openPurchaseModal(params.expectedPriceBuzz);
              if (!purchased) throw first;
              return await postOnce(params, idempotencyKey);
            }
          },
          options,
          // 🔴 RULE 3 IN THE TIME AXIS, AND IT IS NOT COVERED BY THE UNMOUNT
          // ABORT IN `postOnce`. During the 60s consent wait there is no
          // in-flight request for the cleanup to abort, so no `AbortError` is
          // produced and the grant drove a SECOND CHARGE against a component
          // that no longer exists. `withConsentRetry` reads this immediately
          // before the retry.
          () => mountedRef.current,
        );
      } catch (err) {
        const e =
          err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
        throw e;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [host, openPurchaseModal, postOnce],
  );

  return { purchase, loading, error };
}
