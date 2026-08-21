import { useCallback } from 'react';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../internal/requestTimeouts.js';
import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * Opens the Civitai Buzz purchase modal on the host. Resolves with the
 * outcome when the user closes the modal — `purchased: true` means the
 * balance increased; the new balance is included if the host reports it.
 * The insufficient-budget recovery path for {@link useBuzzWorkflow}.
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
export function useBuzzPurchase(): {
  openPurchaseModal: (suggestedAmount?: number) => Promise<{ purchased: boolean; newBalance?: number }>;
} {
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
