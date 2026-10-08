import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  useBlockContext,
  useBlockResize,
  useBuzzBalance,
  useDomainMaturity,
  useBuzzPurchase,
  useBuzzWorkflow,
  useConsentUnavailable,
  useRequestConsent,
  useRequestSignIn,
  WorkflowSubmitError,
} from '@civitai/blocks-react';
import { Alert, Button, Card, Stack } from '@civitai/blocks-react/ui';
import { BLOCK_SCOPES, isModelSlotContext, isSfwCeiling, isSignedIn } from '@civitai/app-sdk/blocks';
import { consentStep } from './consent.js';
import { overLimitMessage, resolvedFailureMessage, walletShortfall } from './outcome.js';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

/** The consent-gated scopes this app declares. The host grants the whole missing set in one dialog. */
const SPEND = BLOCK_SCOPES.AI_WRITE_BUDGETED;
const BALANCE = BLOCK_SCOPES.BUZZ_READ_SELF;

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
 * The flow: get consent, price the generation with `estimate()` (never a
 * hard-coded number — the server prices it, author fee included), then check
 * the budget, then the wallet, and only then spend.
 *
 * 🔴 CONSENT COMES FIRST, BECAUSE PRICING NEEDS IT. The host refuses an estimate
 * from a token without `ai:write:budgeted`, and `estimate()` never asks for
 * consent itself. So a viewer who hasn't granted the scope sees an "Allow
 * generations" step (`consent.ts` handles granted / unavailable / dismissed /
 * failed-to-send), and nothing is priced until the token carries the scope.
 * By the time Generate is enabled the budget is on the token, so a price above
 * it is caught before any submit, and never offered a top-up.
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
  const { ready, context, theme, token, viewer } = useBlockContext();
  const { estimate, submit } = useBuzzWorkflow();
  const { openPurchaseModal } = useBuzzPurchase();
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useBuzzBalance();
  const { maxBrowsingLevel } = useDomainMaturity();
  const { requestConsent } = useRequestConsent();
  const { refusal } = useConsentUnavailable();
  const { requestSignIn } = useRequestSignIn();
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
  /** Allow was pressed and the request went out — nothing replies to a dismissed dialog. */
  const [consentAsked, setConsentAsked] = useState(false);
  /** The last Allow press threw before the request went out. */
  const [consentSendFailed, setConsentSendFailed] = useState(false);

  // What the CURRENT token carries. Consent re-mints it, and these flip.
  const canSpend = token.scopes.includes(SPEND);
  const canReadBalance = token.scopes.includes(BALANCE);
  const step = consentStep({
    signedIn: isSignedIn(viewer),
    canSpend,
    refused: refusal !== null,
    asked: consentAsked,
    sendFailed: consentSendFailed,
  });

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

  // The balance read is refused until its scope is granted, and it fetches on
  // mount — so read it again once the token gains the scope.
  useEffect(() => {
    if (canReadBalance) refetchBalance();
  }, [canReadBalance, refetchBalance]);

  // The price comes from the server, and only once the token can spend: the
  // host refuses an estimate without the spend scope. A rejected estimate leaves
  // the price unknown, and Generate stays disabled: there is nothing to compare
  // against.
  useEffect(() => {
    if (!body || !canSpend) return;
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
  }, [body, canSpend, estimate]);

  const allow = useCallback(() => {
    setConsentSendFailed(false);
    try {
      // Name the scopes: the host computes "this can never be granted here"
      // from the hint, and an empty hint gets no refusal at all.
      requestConsent({ scopes: [SPEND, BALANCE] });
      setConsentAsked(true);
    } catch (err) {
      console.warn('[buzz-purchase] consent request failed:', err);
      setConsentSendFailed(true);
    }
  }, [requestConsent]);

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
  // The budget as of NOW, for code that runs after an await: the token can be
  // re-minted while a submit is in flight, and the callback closes over the
  // value from before the click. Synced at commit (a layout effect), not during
  // render.
  const budgetRef = useRef(budget);
  useLayoutEffect(() => {
    budgetRef.current = budget;
  }, [budget]);

  /**
   * Explain why a generation of `price` can't run — from the NUMBERS, never
   * from a refusal's wording. `true` when it showed something.
   */
  const explainBlocker = useCallback(
    (price: number) => {
      if (budget !== undefined && price > budget) {
        setStatus(overLimitMessage(price, budget));
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
      // RESOLVED failure — never a top-up (see outcome.ts): a cap or limit refused
      // it before the wallet was looked at, or a real run failed and may have
      // spent. The budget is read through the ref, so a token re-minted during the
      // submit is what explains the refusal: over the budget → the limit message.
      // `snap.error` is server-authored — log it, never render it.
      console.warn('[buzz-purchase] submit failed:', snap.error);
      setStatus(resolvedFailureMessage(snap, cost, budgetRef.current));
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
    // A price only exists once consent is granted, so the budget is known here:
    // don't send a submit that cannot land.
    if (explainBlocker(cost)) return;
    void runSubmit();
  }, [cost, explainBlocker, runSubmit]);

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

        {step.kind === 'sign-in' ? (
          // Anonymous viewers get no consent-gated scope at all.
          <Alert color="info" title="Sign in to generate">
            <Button size="sm" onClick={() => requestSignIn()}>
              Sign in
            </Button>
          </Alert>
        ) : step.kind === 'unavailable' ? (
          <Alert color="warning" title="Generating isn't available">
            {step.message}
          </Alert>
        ) : step.kind === 'ask' ? (
          <Alert color="info" title="Allow generations">
            <Stack gap={8}>
              <span>This app spends your Buzz, within a per-generation limit, and reads your balance.</span>
              <div>
                <Button size="sm" onClick={allow}>
                  Allow
                </Button>
              </div>
              {step.message ? <small role="status">{step.message}</small> : null}
            </Stack>
          </Alert>
        ) : null}

        <Card>
          Quoted cost: <strong>{canSpend ? (cost ?? '…') : '—'} Buzz</strong>
          {budget !== undefined ? <> · per-generation limit: <strong>{budget} Buzz</strong></> : null}
        </Card>

        <div>
          <Button onClick={tryGenerate} disabled={!canSpend || cost === null || refused !== null}>
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
