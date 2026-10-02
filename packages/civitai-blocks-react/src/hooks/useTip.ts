import { useCallback, useEffect, useRef, useState } from 'react';

import { BLOCK_SCOPES } from '@civitai/app-sdk/blocks';

import { withConsentRetry } from '../internal/withConsentRetry.js';
import { getTransport } from '../transport/singleton.js';
import type { ConsentRetryOptions } from './consentRetryOptions.js';
import { useHostOrigin } from './useHostOrigin.js';
import { useBlockToken } from './useBlockToken.js';
import { resolveIdempotencyKey } from '../transport/transport.js';

/** The consent-gated scope a tip needs (`social:tip:self`). */
const TIP_SCOPES = [BLOCK_SCOPES.SOCIAL_TIP_SELF] as const;

/**
 * Backstop timeout for the direct REST tip POST. Like {@link useGenerationResources}
 * (and unlike the postMessage hooks), this talks to the HTTP API directly, so it
 * needs its OWN bound — otherwise a hung request never rejects.
 */
const TIP_REQUEST_TIMEOUT_MS = 30_000;

/** The tip target + amount. `entityType`/`entityId` are optional context. */
export interface TipParams {
  toUserId: number;
  amount: number;
  entityType?: 'Image' | 'Collection' | 'User';
  entityId?: number;
}

/** Optional per-tip controls. */
export interface TipOptions extends ConsentRetryOptions {
  /**
   * A STABLE idempotency key for this logical tip. Reuse the SAME value when
   * RETRYING a tip whose response was lost (timeout / network drop) so the host
   * collapses it to ONE transfer instead of DOUBLE-TIPPING. Omit → the hook mints
   * a fresh key per `tip()` call (each call is a new logical tip).
   *
   * 🔴 **FORMAT: `^[A-Za-z0-9_-]{1,64}$` — letters, digits, `_` and `-` only, at
   * most 64 characters, and NO COLONS.** `/api/v1/blocks/tip` rejects anything
   * else with a **400** (`"Invalid request body"` + a zod `flatten()` in
   * `details`), so a composite key like `user:image:nonce` fails every time. The
   * colon is excluded deliberately, not cosmetically: the host composes its
   * per-`(user, app, key)` tip dedupe key with `:` as the delimiter and relies on
   * the key being colon-free for that to stay injective.
   *
   * 🔴 A key that fails this is **REFUSED before the POST**, with
   * `InvalidIdempotencyKeyError` — nothing is sent and nothing is spent. It is
   * never sanitised for you: rewriting an idempotency key would break the
   * identity it exists to carry. Validate with `isValidBlockIdempotencyKey` from
   * `@civitai/app-sdk/blocks` if you compose keys dynamically.
   */
  idempotencyKey?: string;
}

/** The successful tip echo the endpoint returns. */
export interface TipResult {
  ok: true;
  tip: {
    toUserId: number;
    amount: number;
    entityType: string | null;
    entityId: number | null;
  };
}

export interface UseTip {
  /**
   * Send a Buzz tip from the viewer to `toUserId`. Resolves with the server's
   * echo on success; REJECTS with an `Error` (carrying the server message) on any
   * 4xx/5xx — including a `409` if a tip with the same idempotency key is still in
   * flight. A lost-response retry with the SAME `options.idempotencyKey` is
   * collapsed server-side to the first result (no double-tip).
   */
  tip: (params: TipParams, options?: TipOptions) => Promise<TipResult>;
  /** `true` while a tip POST is in flight. */
  loading: boolean;
  /** The last tip's failure, or `null`. Cleared at the start of the next `tip()`. */
  error: Error | null;
}

/**
 * Send a Buzz TIP from the viewer through the block-token-gated
 * `POST /api/v1/blocks/tip` REST endpoint (scope `social:tip:self`).
 *
 * Direct-fetch (bypasses the postMessage bridge) against the VALIDATED host
 * origin (`useHostOrigin()`) with the block bearer token (`useBlockToken().raw`)
 * — the same security-reviewed pattern as {@link useGenerationResources}. The
 * SENDER is always the token subject (server self-binds it); the block never
 * supplies a `fromUserId`.
 *
 * IDEMPOTENCY: pass a stable `options.idempotencyKey` to make a retry-after-
 * timeout safe (the server replays the first terminal result). Omitting it mints
 * a fresh key per call, so each call is a distinct logical tip.
 *
 * 🔴 THE KEY'S FORMAT IS CONSTRAINED — see
 * {@link TipOptions.idempotencyKey}. Letters, digits, `_` and `-` only, at most
 * 64 characters, **no colons**; the host 400s anything else, and this hook now
 * refuses it before the POST.
 *
 * 🔴 THIS EXAMPLE USED TO RECOMMEND `React.useId()`, AND THAT WAS A LIVE DEFECT:
 * `useId()` wraps its value in characters outside the allowed class on most of
 * the React versions this package's peer range admits (`^18.0.0 || ^19.0.0`) —
 * React 18.3.1 returns `":R0:"` and early React 19 a guillemet-wrapped id, both
 * of which 400. (React 19.2.6, resolved in this repo today, happens to return
 * `_r_0_`, which does clear the charset — so the bug was INVISIBLE here while
 * being guaranteed for a consumer on 18.) Anyone copying that line shipped a
 * guaranteed rejection. Prefer a stable id you already have, which is also
 * better idempotency: it is tied to the THING being tipped rather than to a
 * component instance, so it survives a remount.
 *
 * @example
 * const { tip, loading, error } = useTip();
 * // A stable id from your own data — the best key, because it identifies the
 * // logical tip rather than the component that rendered it.
 * const key = `tip-${imageId}-${amount}`;
 * await tip({ toUserId: 123, amount: 50, entityType: 'Image', entityId: 99 }, { idempotencyKey: key });
 *
 * @example
 * // No natural id to hand? Mint one with the SDK's generator and persist it
 * // for as long as the logical tip lives. Do NOT post-process `useId()` into
 * // shape: rewriting a key is exactly what this SDK refuses to do, because a
 * // silently-rewritten key breaks the identity the key exists to carry.
 * import { generateIdempotencyKey } from '@civitai/blocks-react';
 * const keyRef = React.useRef(generateIdempotencyKey());
 * await tip({ toUserId: 123, amount: 50 }, { idempotencyKey: keyRef.current });
 */
export function useTip(): UseTip {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
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

  /**
   * ONE tip POST + its result contract. Re-invoked verbatim on a consent retry.
   *
   * 🔴 `idempotencyKey` IS A PARAMETER. `tip()` mints it once, above the retry,
   * and hands the SAME value to both attempts — the property that turns a retry
   * into a replay instead of a second transfer.
   */
  const postTipOnce = useCallback(
    async (params: TipParams, idempotencyKey: string): Promise<TipResult> => {
      const controller = new AbortController();
      inFlight.current.add(controller);
      // 🔴 WHICH ABORT FIRED IS NOT RECOVERABLE FROM THE SIGNAL — the bound and
      // the unmount cleanup both set `aborted` — so record it at the source.
      // The two need OPPOSITE handling below, exactly as in `useGoodPurchase`:
      // an unmount is a cancellation nothing may resurrect, while the bound
      // elapsing is a real failure whose recovery IS the same-key retry.
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TIP_REQUEST_TIMEOUT_MS);
      // 🔴 THE BEARER IS READ LIVE, NOT OUT OF THE RENDER CLOSURE — WITHOUT THIS
      // THE AUTOMATIC CONSENT RETRY CANNOT WORK. A consent grant re-mints the
      // token and pushes `TOKEN_REFRESH`; React then re-renders and `raw` gets a
      // new value, but the in-flight `purchase`/`tip` call is still holding the
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
        const res = await fetch(`${host}/api/v1/blocks/tip`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toUserId: params.toUserId,
            amount: params.amount,
            ...(params.entityType ? { entityType: params.entityType } : {}),
            ...(params.entityId != null ? { entityId: params.entityId } : {}),
            idempotencyKey,
          }),
          signal: controller.signal,
        });
        const bodyJson = (await res.json().catch(() => null)) as
          | (Partial<TipResult> & { error?: string })
          | null;
        if (!res.ok) {
          throw new Error(bodyJson?.error ?? `tip request failed (${res.status})`);
        }
        return bodyJson as TipResult;
      } catch (err) {
        // The `!… startsWith('tip')` half keeps a server refusal that was
        // ALREADY read from being rewritten by an abort that raced it — the
        // same precedence `useGoodPurchase` gives a `GoodPurchaseRefusal`.
        if (
          controller.signal.aborted &&
          !(err instanceof Error && err.message.startsWith('tip'))
        ) {
          if (timedOut) {
            // 🔴 THE BOUND FIRED, AND THIS ERROR IS DELIBERATELY RETRYABLE.
            // `name` stays `Error` (callers routinely ignore `AbortError` as
            // "we navigated away", and a silently-ignored money-path timeout is
            // the worst outcome here) and it carries NO `timedOut` flag, so the
            // automatic consent retry may re-send it. That is safe for exactly
            // one reason: this hook mints an `idempotencyKey` above the retry
            // and both POSTs carry it, so the server collapses them to ONE
            // transfer. See rule 4 in `internal/withConsentRetry.ts` — the flag
            // marks bridges with NO key to dedupe with, and this is not one.
            throw new Error(
              `useTip: request aborted (timed out after ${TIP_REQUEST_TIMEOUT_MS}ms). The transfer may or may not have landed — retry with the SAME idempotencyKey to find out safely.`,
            );
          }
          // 🔴 UNMOUNT. `name = 'AbortError'` is what a caller discriminates on
          // to IGNORE a rejection its component no longer cares about, and it
          // is also what makes `withConsentRetry` rule 3 re-throw rather than
          // resurrect work that was cancelled on purpose.
          const aborted = new Error(
            'useTip: request aborted (the hook unmounted before the response arrived). The transfer may or may not have landed — retry with the SAME idempotencyKey to find out safely.',
          );
          aborted.name = 'AbortError';
          throw aborted;
        }
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timeoutId);
        inFlight.current.delete(controller);
      }
    },
    [host, raw],
  );

  const tip = useCallback(
    async (params: TipParams, options?: TipOptions): Promise<TipResult> => {
      if (!host) {
        throw new Error('useTip: host origin not established yet (wait for BLOCK_INIT).');
      }
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      // 🔴 MINTED ONCE, OUTSIDE the closure the consent retry re-invokes, so
      // both POSTs carry the SAME key and the host collapses them to ONE
      // transfer. Minting it inside would DOUBLE-TIP a real person.
      // 🔴 VALIDATED AND REFUSED, NOT SANITISED — see
      // `InvalidIdempotencyKeyError`. `/api/v1/blocks/tip` enforces the same
      // `^[A-Za-z0-9_-]{1,64}$` the submit path does, and the tip endpoint's
      // redis key composes `<userId>:<appBlockId>:<key>` with ':' as the
      // delimiter, so a colon-bearing key is an injectivity hazard and not just
      // a format violation.
      const idempotencyKey = resolveIdempotencyKey('useTip.tip', options?.idempotencyKey);
      try {
        return await withConsentRetry(
          getTransport(),
          TIP_SCOPES,
          () => postTipOnce(params, idempotencyKey),
          options,
          // 🔴 RULE 3 IN THE TIME AXIS, AND IT IS NOT COVERED BY THE UNMOUNT
          // ABORT ABOVE. During the 60s consent wait there is no in-flight
          // request for the cleanup to abort, so no `AbortError` is produced and
          // the grant drove a SECOND POST against a component that no longer
          // exists — Buzz leaving the viewer's balance with no UI left to report
          // it, and with `inFlight` already cleared that POST is not even
          // abortable. `withConsentRetry` reads this immediately before the retry.
          () => mountedRef.current,
        );
      } catch (err) {
        if (mountedRef.current) setError(err as Error);
        throw err;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [host, postTipOnce],
  );

  return { tip, loading, error };
}
