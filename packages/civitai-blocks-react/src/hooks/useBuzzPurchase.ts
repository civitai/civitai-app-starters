import { useCallback } from 'react';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * Opens the Civitai Buzz purchase modal on the host. Resolves with the
 * outcome when the user closes the modal — `purchased: true` means the
 * balance increased; the new balance is included if the host reports it.
 */
export function useBuzzPurchase(): {
  openPurchaseModal: (suggestedAmount?: number) => Promise<{ purchased: boolean; newBalance?: number }>;
} {
  const openPurchaseModal = useCallback(async (suggestedAmount?: number) => {
    const { purchased, newBalance } = await sendTypedRequest(
      getTransport(),
      { type: 'OPEN_BUZZ_PURCHASE', payload: { suggestedAmount } },
      'BUZZ_PURCHASE_RESULT',
    );
    return { purchased, newBalance };
  }, []);
  return { openPurchaseModal };
}
