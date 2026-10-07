import type { BuzzBalance } from '@civitai/blocks-react';
import { isSfwCeiling } from '@civitai/app-sdk/blocks';

/**
 * TWO LIMITS, AND BUYING BUZZ MOVES ONLY ONE (the `buzz-purchase` rule).
 *
 * - the per-generation BUDGET — `token.buzzBudget`, minted from this manifest's
 *   `page.buzzBudgetPerGen` (default 10 when absent, clamped to 1000). A purchase
 *   never raises it; only a new manifest version does. Never offer a top-up for it.
 * - the WALLET — `useBuzzBalance()` (needs `buzz:read:self`). A purchase raises it.
 *
 * Decided from the NUMBERS, never from a refusal's wording.
 */
export type Blocker =
  | { kind: 'over-budget'; price: number; budget: number }
  | { kind: 'wallet-short'; price: number; wallet: number; shortfall: number }
  | null;

export function findBlocker(
  price: number,
  budget: number | undefined,
  balance: BuzzBalance | null,
  maxBrowsingLevel: number | undefined,
): Blocker {
  if (budget !== undefined && price > budget) return { kind: 'over-budget', price, budget };
  const wallet = walletTotal(balance, maxBrowsingLevel);
  if (wallet !== null && wallet < price) return { kind: 'wallet-short', price, wallet, shortfall: price - wallet };
  return null;
}

/**
 * The Buzz this app can actually SPEND: blue plus its domain's pool — green
 * under an SFW ceiling, yellow under a mature one. The host spends nothing else,
 * so summing all three over-counts, and that is NOT safe: a viewer whose only
 * Buzz is in the other pool would never be offered the top-up they need.
 *
 * Keyed on the DOMAIN ceiling (`useDomainMaturity().maxBrowsingLevel`), as the
 * server keys it — not on `isSfw`, which the viewer's own setting narrows. An
 * unknown ceiling counts as SFW, as it does on the server.
 */
export function walletTotal(balance: BuzzBalance | null, maxBrowsingLevel: number | undefined): number | null {
  if (!balance) return null;
  return balance.blue + (isSfwCeiling(maxBrowsingLevel) ? balance.green : balance.yellow);
}

export function blockerMessage(b: NonNullable<Blocker>): string {
  return b.kind === 'over-budget'
    ? `This setup costs ${b.price} Buzz, over this app's ${b.budget}-Buzz limit per generation. ` +
        "Buying Buzz can't raise that limit — try fewer images or steps."
    : `You're ${b.shortfall} Buzz short (this costs ${b.price}, you have ${b.wallet}).`;
}
