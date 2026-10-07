import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useBlockContext,
  useBlockResize,
  useBuzzBalance,
  useDomainMaturity,
  useBuzzPurchase,
  useBuzzWorkflow,
  WorkflowSubmitError,
} from '@civitai/blocks-react';
import { Alert, Button, Card, Stack } from '@civitai/blocks-react/ui';
import { isModelSlotContext, isSfwCeiling } from '@civitai/app-sdk/blocks';
import { resolvedFailureMessage, walletShortfall } from './outcome.js';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

/**
 * buzz-purchase — top up Buzz when the viewer's WALLET can't cover a generation.
 *
 * TWO LIMITS, AND A PURCHASE MOVES ONLY ONE OF THEM:
 *
 *  - the WALLET — the viewer's Buzz balance (`useBuzzBalance()`, which needs the
 *    `buzz:read:self` scope). Buying Buzz raises it.
 *  - the PER-GENERATION BUDGET — `token.buzzBudget`, the ceiling the host signs
 *    into the block token from the install's `buzz_budget_per_gen` setting.
 *    Buying Buzz does NOT raise it: the host's purchase reply is
 *    `{ purchased }` and nothing else, and the budget is re-derived from the
 *    install settings on every mint. A generation priced above it is refused
 *    whatever the wallet holds, so this example never offers a top-up for it.
 *
 * The flow: price the generation with `estimate()` (never a hard-coded number —
 * the server prices it, author fee included), then check the budget, then the
 * wallet, and only then spend. The budget is only known once the viewer has
 * granted the spend scope, so the FIRST generation goes straight to `submit()`
 * (which asks for that consent) and the refusal, if any, is explained after.
 *
 * 🔴 THE GUARDING AROUND THE RETRY IS THE PATTERN TO COPY, NOT JUST THE CALL.
 * `openPurchaseModal` waits on a human (up to 10 minutes), so the retry it feeds
 * is a PAID submit triggered by an event whose timing you do not control:
 *   1. guard re-entry with a REF, not state — two clicks in one frame both read
 *      the stale state; the `disabled` prop is UX, not the lock;
 *   2. catch the rejection — an abandoned modal eventually times out;
 *   3. before auto-spending, check the viewer is still THERE —
 *      `document.visibilityState` when the promise resolves, not elapsed time (a
 *      card payment with 3-D Secure legitimately takes minutes).
 */
export function App() {
  const { ready, context, theme, token } = useBlockContext();
  const { estimate, submit } = useBuzzWorkflow();
  const { openPurchaseModal } = useBuzzPurchase();
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useBuzzBalance();
  const { maxBrowsingLevel } = useDomainMaturity();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const [cost, setCost] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** How much Buzz to suggest buying, when the wallet is what's short. */
  const [topUp, setTopUp] = useState<number | null>(null);
  /** A REJECTED (`'exception'`) attempt waiting on a fresh balance read to say whether the wallet is short. */
  const [refused, setRefused] = useState<{ cost: number; otherwise: string } | null>(null);
  const [topUpPending, setTopUpPending] = useState(false);
  const topUpInFlight = useRef(false);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  // NARROW, don't cast: on any slot that is not a complete model context this is
  // null and nothing is priced or submitted.
  const model = ready && isModelSlotContext(context) ? context : null;
  const body = useMemo<WorkflowBody | null>(
    () =>
      model && {
        kind: 'textToImage',
        modelId: model.modelId,
        modelVersionId: model.modelVersionId,
        params: { prompt: 'a cozy reading nook', steps: 25 },
      },
    [model],
  );

  // The price comes from the server. A rejected estimate leaves it unknown,
  // and Generate stays disabled: there is nothing to compare against.
  useEffect(() => {
    if (!body) return;
    let cancelled = false;
    estimate(body)
      .then((snap) => !cancelled && setCost(snap.cost?.total ?? null))
      .catch((err: unknown) => {
        console.warn('[buzz-purchase] estimate failed:', err);
        if (!cancelled) setCost(null);
      });
    return () => {
      cancelled = true;
    };
  }, [body, estimate]);

  // Spendable Buzz: blue plus this app's domain pool — green under an SFW
  // ceiling, yellow under a mature one. The host spends nothing else, so summing
  // all three over-counts, and that is NOT safe: a viewer whose only Buzz is in
  // the other pool would never be offered the top-up they need. Keyed on the
  // DOMAIN ceiling, as the server keys it — not on `isSfw`, which the viewer's
  // own setting narrows. An unknown ceiling counts as SFW, as on the server.
  const wallet = balance
    ? balance.blue + (isSfwCeiling(maxBrowsingLevel) ? balance.green : balance.yellow)
    : null;
  const budget = token.buzzBudget; // present once the spend scope is granted

  /**
   * Explain why a generation of `price` can't run — from the NUMBERS, never
   * from a refusal's wording. `true` when it showed something.
   */
  const explainBlocker = useCallback(
    (price: number) => {
      if (budget !== undefined && price > budget) {
        setStatus(
          `This generation costs ${price} Buzz, over this app's ${budget}-Buzz limit per generation. ` +
            "Buying Buzz can't change that limit; the app's installer sets it.",
        );
        return true;
      }
      const short = walletShortfall(price, wallet);
      if (short !== null) {
        setTopUp(short);
        return true;
      }
      return false;
    },
    [budget, wallet],
  );

  // A rejected attempt waits for the balance it asked for, then gets explained.
  useEffect(() => {
    if (!refused || balanceLoading) return;
    if (!explainBlocker(refused.cost)) setStatus(refused.otherwise);
    setRefused(null);
  }, [refused, balanceLoading, explainBlocker]);

  const runSubmit = useCallback(async () => {
    if (!body || cost === null) return;
    try {
      // No `idempotencyKey`, deliberately: the only retry here is the one after
      // a top-up, which is a NEW attempt under preconditions the viewer just paid
      // to change. Reuse a key only to retry the SAME attempt (see README).
      const snap = await submit(body);
      if (snap.status !== 'failed') {
        setStatus(`submitted: ${snap.workflowId} (${snap.status})`);
        return;
      }
      // RESOLVED failure — never a top-up (see outcome.ts): a cap refused it before
      // the wallet was even looked at, or a real run failed and may have spent.
      // `snap.error` is server-authored — log it, never render it.
      console.warn('[buzz-purchase] submit failed:', snap.error);
      setStatus(resolvedFailureMessage(snap));
    } catch (err) {
      // 🔴 NEVER RENDER `err.message`; branch on `err.code`. A short wallet is
      // the orchestrator refusing to debit, which reaches the block as
      // `'exception'` — so that arm, and ONLY that arm, re-reads the wallet and
      // may offer a top-up (decided by spendable Buzz vs the quote).
      console.warn('[buzz-purchase] submit failed:', err);
      if (err instanceof WorkflowSubmitError && err.code === 'exception') {
        refetchBalance();
        setRefused({ cost, otherwise: 'Could not start the generation. Please try again.' });
      } else if (err instanceof WorkflowSubmitError) {
        // 'workflow-failed': a workflow probably exists and Buzz may already be
        // committed. Don't call it free, and don't auto-retry (a second reserve).
        setStatus('The generation was submitted but failed. Check your generation history before retrying.');
      } else {
        // Transport-level, most likely the timeout: it may well have been queued
        // and charged, so the most cautious copy.
        setStatus('We lost contact before the generation was confirmed. Check your generation history before trying again.');
      }
    }
  }, [body, cost, submit, refetchBalance]);

  const tryGenerate = useCallback(() => {
    setStatus(null);
    setTopUp(null);
    if (cost === null) return;
    // With the budget known, don't send a submit that cannot land. Without it
    // (no consent yet), submit: that asks for consent and the reply decides.
    if (budget !== undefined && explainBlocker(cost)) return;
    void runSubmit();
  }, [cost, budget, explainBlocker, runSubmit]);

  const topUpAndRetry = useCallback(async () => {
    if (topUpInFlight.current || topUp === null) return; // the real lock (see header)
    topUpInFlight.current = true;
    setTopUpPending(true);
    try {
      const { purchased } = await openPurchaseModal(topUp);
      if (!purchased) {
        setStatus('purchase canceled');
        return;
      }
      setTopUp(null);
      refetchBalance();
      // Tab visibility propagates into the iframe; `document.hasFocus()` would
      // not — focus usually stays in the host document after its modal closes.
      if (document.visibilityState !== 'visible') {
        setStatus("Buzz purchased — press Generate when you're ready");
        return;
      }
      setStatus('Buzz purchased — retrying…');
      await runSubmit();
    } catch (err) {
      console.warn('[buzz-purchase] top-up flow error:', err);
      setStatus('The purchase could not be completed. Please try again.');
    } finally {
      topUpInFlight.current = false;
      setTopUpPending(false);
    }
  }, [topUp, openPurchaseModal, refetchBalance, runSubmit]);

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
      <Stack gap={8}>
        <strong>Buzz purchase</strong>
        <Card>
          Quoted cost: <strong>{cost ?? '…'} Buzz</strong>
          {budget !== undefined ? <> · per-generation limit: <strong>{budget} Buzz</strong></> : null}
        </Card>

        <div>
          <Button onClick={tryGenerate} disabled={cost === null || refused !== null}>
            Generate ({cost ?? '…'} Buzz)
          </Button>
        </div>

        {topUp !== null ? (
          <Alert color="warning" title="Not enough Buzz">
            <Stack gap={8}>
              <span>You're {topUp} Buzz short. Top up to generate.</span>
              <div>
                <Button onClick={topUpAndRetry} loading={topUpPending}>
                  Buy Buzz &amp; retry
                </Button>
              </div>
            </Stack>
          </Alert>
        ) : null}

        {status ? <small role="status">{status}</small> : null}
      </Stack>
    </div>
  );
}
