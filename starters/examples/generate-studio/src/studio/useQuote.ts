import { useEffect, useState } from 'react';

import { useBuzzWorkflow, WorkflowEstimateError } from '@civitai/blocks-react';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

import { estimateFailureMessage } from './copy.js';

export interface Quote {
  /** The server's price for exactly `body`, or `null` while unknown. */
  price: number | null;
  /** App-owned copy for why there is no price. */
  note: string | null;
  pending: boolean;
}

/**
 * Re-price the body whenever it changes, debounced so typing a prompt is not a
 * request per keystroke.
 *
 * 🔴 `estimate()` NEVER PROMPTS FOR CONSENT (unlike `submit()`): it runs from an
 * effect with no user gesture behind it. Without the spend scope it simply
 * rejects — show no price and let the first Generate click do the asking.
 *
 * 🔴 It REJECTS for an unusable reply (`WorkflowEstimateError`), including while
 * the app is in moderator review preview. The catch is not optional.
 */
export function useQuote(body: WorkflowBody | null, enabled: boolean): Quote {
  const { estimate } = useBuzzWorkflow();
  const [quote, setQuote] = useState<Quote>({ price: null, note: null, pending: false });

  // One string per distinct body, so a re-render with an equal body does not re-price.
  const key = body ? JSON.stringify(body) : '';

  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    setQuote((q) => ({ ...q, pending: true }));
    const timer = window.setTimeout(() => {
      estimate(JSON.parse(key) as WorkflowBody)
        .then((snap) => {
          if (!cancelled) setQuote({ price: snap.cost?.total ?? null, note: null, pending: false });
        })
        .catch((err: unknown) => {
          // Branch on `code`; log the server's own words, never render them.
          if (err instanceof WorkflowEstimateError) {
            console.warn(`[generate-studio] estimate ${err.code}:`, err.snapshot.error ?? '(no reason given)');
          } else {
            console.warn('[generate-studio] estimate did not complete:', err);
          }
          if (!cancelled) setQuote({ price: null, note: estimateFailureMessage(err), pending: false });
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, key, estimate]);

  return quote;
}
