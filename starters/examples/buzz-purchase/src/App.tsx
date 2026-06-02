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
 */
export function App() {
  const { ready, context, theme, token } = useBlockContext();
  const { submit } = useBuzzWorkflow();
  const { openPurchaseModal } = useBuzzPurchase();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const [status, setStatus] = useState<string | null>(null);
  const [needsTopUp, setNeedsTopUp] = useState<{ shortfall?: number } | null>(null);

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
    // Suggest at least the shortfall so the modal pre-fills a useful amount.
    const suggested = Math.max(needsTopUp?.shortfall ?? cost, cost);
    const { purchased, newBalance } = await openPurchaseModal(suggested);
    if (purchased) {
      setStatus(
        `purchased${newBalance != null ? ` (new balance ${newBalance})` : ''} — retrying…`,
      );
      setNeedsTopUp(null);
      await tryGenerate();
    } else {
      setStatus('purchase canceled');
    }
  }, [needsTopUp, openPurchaseModal, tryGenerate]);

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
          <button onClick={topUpAndRetry} style={buttonStyle}>
            Buy Buzz & retry
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
