import { useCallback, useRef, useState } from 'react';

import {
  useBlockContext,
  useBlockResize,
  useBuzzPurchase,
  useBuzzWorkflow,
} from '@civitai/blocks-react';
import type { ModelSlotContext, WorkflowBody } from '@civitai/app-sdk/blocks';

/**
 * buzz-purchase — top up Buzz when a generation can't be afforded.
 *
 * `useBuzzPurchase().openPurchaseModal()` asks the host to open the Civitai
 * Buzz purchase modal and resolves when the user closes it
 * (`{ purchased, newBalance }`). The canonical use is the insufficient-budget
 * path: when `useBuzzWorkflow().submit()` rejects because the cost exceeds the
 * viewer's balance / the token's `buzzBudget`, offer a top-up and retry.
 *
 * 🔴 THE PATTERN TO COPY IS THE GUARDING AROUND THAT RETRY, NOT JUST THE CALL.
 * `openPurchaseModal` is human-gated: it resolves whenever the viewer closes the
 * modal, which may be many minutes later. So the retry it feeds is a PAID submit
 * triggered by an event you do not control the timing of. Three consequences,
 * all handled below and all worth keeping in your own app:
 *   1. guard re-entry — a second click while the modal is open starts a second
 *      purchase and a second queued retry;
 *   2. catch the rejection — an abandoned modal eventually times out, and an
 *      uncaught rejection leaves your UI stuck in a pending state;
 *   3. don't auto-spend on stale intent — past a short grace window, ask again
 *      rather than submitting a paid workflow at nobody in particular.
 */
/**
 * How long after opening the purchase modal an AUTOMATIC paid retry still
 * plainly reflects what the viewer asked for. Past this, the app asks again
 * instead of spending on their behalf. Tune it for your own flow — the point is
 * that some bound exists, not this particular number.
 */
const AUTO_RETRY_GRACE_MS = 60_000;

export function App() {
  const { ready, context, theme, token } = useBlockContext();
  const { submit } = useBuzzWorkflow();
  const { openPurchaseModal } = useBuzzPurchase();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const [status, setStatus] = useState<string | null>(null);
  const [needsTopUp, setNeedsTopUp] = useState<{ shortfall?: number } | null>(null);
  const [topUpPending, setTopUpPending] = useState(false);

  const model = ready ? (context as ModelSlotContext) : null;
  const cost = 120; // pretend this is the quoted cost from an estimate

  const tryGenerate = useCallback(async () => {
    if (!model) return;
    setStatus(null);
    setNeedsTopUp(null);
    const body: WorkflowBody = {
      kind: 'textToImage',
      modelId: model.modelId,
      modelVersionId: model.modelVersionId,
      params: { prompt: 'a cozy reading nook', steps: 25 },
    };
    try {
      const snap = await submit(body);
      // The host surfaces an under-budget submit as a RESOLVED snapshot with
      // `status: 'failed'` + an `error` string (the transport resolves the
      // reply; it doesn't throw on a failed snapshot). A throw happens only on
      // transport-level failures (timeout, malformed reply).
      if (snap.status === 'failed' && isInsufficientFunds(snap.error ?? '')) {
        setNeedsTopUp({ shortfall: cost - (token.buzzBudget ?? 0) });
      } else if (snap.status === 'failed') {
        setStatus(snap.error ?? 'generation failed');
      } else {
        setStatus(`submitted: ${snap.workflowId} (${snap.status})`);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [model, submit, token.buzzBudget]);

  const topUpAndRetry = useCallback(async () => {
    // IN-FLIGHT GUARD: the modal can stay open for minutes, and every click
    // during that window would open another one and queue another paid retry.
    if (topUpPending) return;
    // Suggest at least the shortfall so the modal pre-fills a useful amount.
    const suggested = Math.max(needsTopUp?.shortfall ?? cost, cost);
    const openedAt = Date.now();
    setTopUpPending(true);
    try {
      const { purchased, newBalance } = await openPurchaseModal(suggested);
      if (!purchased) {
        setStatus('purchase canceled');
        return;
      }
      setNeedsTopUp(null);
      const bought = `purchased${newBalance != null ? ` (new balance ${newBalance})` : ''}`;

      // 🔴 DON'T AUTO-SPEND ON STALE INTENT. `openPurchaseModal` is human-gated
      // and waits up to 10 minutes for the viewer to close the modal, so a
      // resolved promise says the purchase finished — NOT that the viewer is
      // still at the keyboard expecting a generation. Auto-submitting a paid
      // workflow after a long-open modal charges someone who wandered off.
      // Inside the grace window the retry is plainly what they asked for;
      // outside it, hand the decision back and let them press Generate.
      if (Date.now() - openedAt > AUTO_RETRY_GRACE_MS) {
        setStatus(`${bought} — press Generate when you're ready`);
        return;
      }

      setStatus(`${bought} — retrying…`);
      await tryGenerate();
    } catch (err) {
      // A rejection is reachable (an abandoned modal eventually hits the
      // human-interaction timeout). Uncaught, it would surface as an unhandled
      // rejection and leave the button stuck pending.
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setTopUpPending(false);
    }
  }, [needsTopUp, openPurchaseModal, topUpPending, tryGenerate]);

  if (!ready) {
    return (
      <div ref={rootRef} data-theme={theme} className="hw-root">
        Loading…
      </div>
    );
  }

  return (
    <div ref={rootRef} data-theme={theme} className="hw-root">
      <strong>Buzz purchase</strong>
      <div className="hw-card">
        Quoted cost: <strong>{cost} Buzz</strong> · your per-gen budget:{' '}
        <strong>{token.buzzBudget ?? 0} Buzz</strong>
      </div>

      <button onClick={tryGenerate} style={buttonStyle}>
        Generate ({cost} Buzz)
      </button>

      {needsTopUp ? (
        <div className="hw-card" style={{ borderColor: '#e8a33d' }}>
          <div style={{ fontWeight: 600 }}>Not enough Buzz</div>
          <div style={{ fontSize: 13, opacity: 0.85, margin: '4px 0' }}>
            You're {needsTopUp.shortfall && needsTopUp.shortfall > 0 ? `${needsTopUp.shortfall} ` : ''}
            Buzz short. Top up to generate.
          </div>
          <button onClick={topUpAndRetry} disabled={topUpPending} style={buttonStyle}>
            {topUpPending ? 'Purchase window open…' : 'Buy Buzz & retry'}
          </button>
        </div>
      ) : null}

      {status ? <div style={{ fontSize: 13, opacity: 0.85 }}>{status}</div> : null}
    </div>
  );
}

/**
 * The host surfaces insufficient-funds as an error string. Match loosely —
 * the exact wording isn't a stable contract, so key off the recognizable
 * tokens and fall back to showing the raw message.
 */
function isInsufficientFunds(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('insufficient') || m.includes('budget') || m.includes('not enough');
}

const buttonStyle = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: 6,
  background: '#1971c2',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  alignSelf: 'flex-start',
} as const;
