import { useRef, useState } from 'react';

import { useBuzzPurchase, type UseBuzzBalance } from '@civitai/blocks-react';
import { Alert, Badge, Button, Card, Group, Stack } from '@civitai/blocks-react/ui';

import { blockerMessage, findBlocker, walletTotal } from '../studio/blocker.js';
import type { Quote } from '../studio/useQuote.js';

interface Props {
  quote: Quote;
  /** `token.buzzBudget` — present once the viewer has granted the spend scope. */
  budget: number | undefined;
  wallet: UseBuzzBalance;
  canGenerate: boolean;
  onGenerate: () => void;
}

/**
 * Price → budget → wallet → Generate.
 *
 * The budget is only on the token after consent, so the FIRST Generate goes
 * straight to `submit()` (which opens the host's consent dialog and re-sends
 * once). From then on a click that cannot land is stopped here, from the
 * numbers, and only a WALLET shortfall is offered a top-up.
 *
 * 🔴 No automatic retry after a purchase. `openPurchaseModal` waits on a human
 * for up to ten minutes, so a retry fired from its promise is a paid submit at a
 * moment nobody chose. The viewer presses Generate again (`buzz-purchase` shows
 * the guarded auto-retry, if you want one).
 */
export function SpendBar({ quote, budget, wallet, canGenerate, onGenerate }: Props) {
  const { openPurchaseModal } = useBuzzPurchase();
  const [topUpNote, setTopUpNote] = useState<string | null>(null);
  const inFlight = useRef(false); // the real re-entry lock; `disabled` is UX

  const blocker = quote.price === null ? null : findBlocker(quote.price, budget, wallet.balance);
  const total = walletTotal(wallet.balance);

  const topUp = async (amount: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setTopUpNote(null);
    try {
      const { purchased } = await openPurchaseModal(amount);
      wallet.refetch();
      setTopUpNote(purchased ? 'Buzz added. Press Generate when you are ready.' : null);
    } catch (err) {
      console.warn('[generate-studio] purchase:', err);
      setTopUpNote('The purchase could not be completed. Please try again.');
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Card>
      <Stack gap={8}>
        <Group justify="space-between" align="center" wrap>
          <Group gap={8} wrap>
            <Badge variant="light" data-testid="price">
              {quote.price === null ? (quote.pending ? 'Pricing…' : 'No price') : `${quote.price} Buzz`}
            </Badge>
            {budget !== undefined ? (
              <Badge variant="outline" data-testid="budget">
                limit {budget} / generation
              </Badge>
            ) : null}
            <Badge variant="outline" data-testid="wallet">
              {total !== null ? `wallet ${total}` : wallet.loading ? 'wallet …' : 'wallet unavailable'}
            </Badge>
          </Group>
          <Button
            onClick={onGenerate}
            // A price is required; a known blocker stops the click. Before consent
            // the budget is unknown, so the first click is allowed through.
            disabled={!canGenerate || quote.price === null || blocker !== null}
            data-testid="generate"
          >
            Generate
          </Button>
        </Group>
        {quote.note ? <small role="status">{quote.note}</small> : null}
        {blocker ? (
          <Alert color="warning" title={blocker.kind === 'over-budget' ? 'Over the per-generation limit' : 'Not enough Buzz'}>
            <Stack gap={8}>
              <span>{blockerMessage(blocker)}</span>
              {blocker.kind === 'wallet-short' ? (
                <div>
                  <Button size="sm" onClick={() => topUp(blocker.shortfall)}>
                    Buy {blocker.shortfall} Buzz
                  </Button>
                </div>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
        {topUpNote ? <small role="status">{topUpNote}</small> : null}
      </Stack>
    </Card>
  );
}
