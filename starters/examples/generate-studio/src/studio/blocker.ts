import type { BuzzBalance } from '@civitai/blocks-react';

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

export function findBlocker(price: number, budget: number | undefined, balance: BuzzBalance | null): Blocker {
  if (budget !== undefined && price > budget) return { kind: 'over-budget', price, budget };
  const wallet = walletTotal(balance);
  if (wallet !== null && wallet < price) return { kind: 'wallet-short', price, wallet, shortfall: price - wallet };
  return null;
}

/**
 * Spendable Buzz summed over the pools the host reports. The host spends only
 * the pools the app's content rating allows, so this can OVER-count — the safe
 * direction for a top-up prompt: it never asks anyone to buy Buzz they don't need.
 */
export function walletTotal(balance: BuzzBalance | null): number | null {
  return balance ? balance.blue + balance.green + balance.yellow : null;
}

export function blockerMessage(b: NonNullable<Blocker>): string {
  return b.kind === 'over-budget'
    ? `This setup costs ${b.price} Buzz, over this app's ${b.budget}-Buzz limit per generation. ` +
        "Buying Buzz can't raise that limit — try fewer images or steps."
    : `You're ${b.shortfall} Buzz short (this costs ${b.price}, you have ${b.wallet}).`;
}
