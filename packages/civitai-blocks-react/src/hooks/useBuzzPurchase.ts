import { useCallback } from 'react';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';

/** What {@link useBuzzPurchase} returns. */
export interface UseBuzzPurchase {
  openPurchaseModal: (
    suggestedAmount?: number,
  ) => Promise<{ purchased: boolean; newBalance?: number }>;
}

/**
 * Opens the Civitai Buzz purchase modal on the host. Resolves with the
 * outcome when the user closes the modal — `purchased: true` means the
 * balance increased; the new balance is included if the host reports it.
 * Raises the viewer's WALLET, never a spend cap: offer it when the viewer's
 * spendable Buzz is below a quoted cost, never on a resolved `failed` submit
 * from {@link useBuzzWorkflow} (see its `submit` docs for why).
 *
 * 🔴 HUMAN-GATED: the reply comes when the viewer closes the modal, and a
 * payment flow is nowhere near a ~30s round-trip — so this passes
 * {@link HUMAN_INTERACTION_TIMEOUT_MS}. On the default the promise rejected
 * mid-checkout, which reads to the block as "purchase failed" for a purchase
 * that may well have SUCCEEDED (same defect class as civitai/civitai#4158).
 *
 * @example
 * const { openPurchaseModal } = useBuzzPurchase();
 * const { purchased, newBalance } = await openPurchaseModal(suggestedAmount);
 * if (purchased) { /* retry the generation *\/ }
 */
export function useBuzzPurchase(): UseBuzzPurchase {
  const openPurchaseModal = useCallback(async (suggestedAmount?: number) => {
    const { purchased, newBalance } = await sendTypedRequest(
      getTransport(),
      { type: 'OPEN_BUZZ_PURCHASE', payload: { suggestedAmount } },
      'BUZZ_PURCHASE_RESULT',
      { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
    );
    return { purchased, newBalance };
  }, []);
  return { openPurchaseModal };
}
