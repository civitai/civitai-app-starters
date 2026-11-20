import { useRef, useState } from 'react';

import { GoodPurchaseRefusal, generateIdempotencyKey, useGoodPurchase } from '@civitai/blocks-react';
import type { Entitlement } from '@civitai/blocks-react';
import { Button, Group } from '@civitai/blocks-react/ui';

/**
 * Buy ONE manifest-declared good, behind an in-block confirm.
 *
 * 🔴 THE CONFIRM IS THIS COMPONENT'S. `useGoodPurchase` is a plain authed POST
 * (`/api/v1/blocks/goods/purchase`); the platform renders no confirmation for
 * the purchase itself, so without the second press a stray click spends Buzz.
 * (The host DOES show its consent dialog the first time, for the
 * `goods:purchase:self` scope — once per app, not per purchase.)
 *
 * The pattern, from https://developer.civitai.com/apps/guide/earning.md:
 *  - send `expectedPriceBuzz` — the server charges ITS price and refuses
 *    `price_changed` rather than charging a number the viewer never saw;
 *  - ONE idempotency key per logical purchase, held in a ref across retries
 *    and only dropped where this purchase is finished or its payload must change;
 *  - branch on `reason`, with a `default` arm: `reason` is absent on the 404,
 *    the 429, the daily-cap 400 and every idempotency refusal.
 */
export function BuyButton({
  goodId,
  title,
  priceBuzz,
  onPurchased,
}: {
  goodId: string;
  title: string;
  /** The price this block SHOWS — sent as `expectedPriceBuzz`. */
  priceBuzz: number;
  /** Called with the granted entitlement. Re-read entitlements here. */
  onPurchased: (entitlement: Entitlement | null) => void;
}) {
  const { purchase, loading } = useGoodPurchase();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // ONE key per logical purchase, minted on the first attempt, never per render.
  // `generateIdempotencyKey()` is a UUID: inside the host's ^[A-Za-z0-9_-]{1,64}$.
  const keyRef = useRef<string | null>(null);

  async function buy() {
    if (!keyRef.current) keyRef.current = generateIdempotencyKey();
    setNotice(null);
    try {
      const result = await purchase(
        { goodId, expectedPriceBuzz: priceBuzz },
        // Not enough Buzz → the host's top-up modal opens (pre-filled with the
        // price), and the SAME key is retried once if — and only if — Buzz was
        // actually bought. Fiat bought there is attributed to this app (rail 3).
        { idempotencyKey: keyRef.current, topUpOnInsufficientFunds: true },
      );
      keyRef.current = null; // settled — a later re-buy gets a new key
      setConfirming(false);
      onPurchased(result.entitlement);
    } catch (err) {
      // KEEPING the key is the safe default (an unknown outcome is exactly when
      // the same key protects the viewer); drop it only where this purchase is
      // over, or where the next attempt must carry a different payload (a key is
      // pinned to one payload — reuse with a new one is a 422).
      if (
        err instanceof GoodPurchaseRefusal &&
        (err.status === 422 ||
          err.reason === 'price_changed' ||
          err.reason === 'already_owned' ||
          err.reason === 'duplicate' ||
          err.reason === 'self_purchase')
      ) {
        keyRef.current = null;
      }
      if (err instanceof GoodPurchaseRefusal) {
        setConfirming(false);
        switch (err.reason) {
          case 'already_owned':
          case 'duplicate':
            onPurchased(null); // they have it: re-read and render the owned state
            return;
          case 'price_changed':
            // The new price is only in the message, so show it verbatim — and
            // STOP. Re-reading the catalog on a pinned install returns the old
            // price forever, so this block never re-submits on its own.
            setNotice(`${err.message} Reload this block to see the current price.`);
            return;
          case 'self_purchase':
            setNotice("This is your own app — buy from a different account to test a purchase.");
            return;
          case 'insufficient_funds':
            // Only reached when the viewer closed the top-up without buying.
            setNotice(`Not enough Buzz for ${title}. Nothing was charged.`);
            return;
          case 'charge_unknown':
            setNotice(`${err.message} Press Buy again to check — it will not charge twice.`);
            return;
          default:
            // 🔴 REQUIRED: `reason` is undefined for the 404, the 429, the
            // daily-cap 400, every idempotency refusal, and a declined consent
            // (the original 403). `message` is the server's viewer-facing copy.
            setNotice(
              err.status === 403
                ? 'Purchases need your permission. Press Buy again to allow them.'
                : err.status === 404
                  ? `${title} is no longer available.`
                  : err.message,
            );
            return;
        }
      }
      // Not a refusal. An unmount (AbortError) needs no UI; anything else is
      // most likely the 30 s bound: the charge MAY have landed, so the key is
      // kept and pressing again is a safe, same-key check.
      if (err instanceof Error && err.name === 'AbortError') return;
      setNotice('We lost contact before the purchase was confirmed. Press Buy again to check — it will not charge twice.');
    }
  }

  return (
    <div>
      {confirming ? (
        <Group gap={6} align="center" data-testid={`buy-${goodId}-prompt`}>
          <span>{`Spend ${priceBuzz} Buzz on ${title}?`}</span>
          <Button size="sm" loading={loading} onClick={() => void buy()} data-testid={`buy-${goodId}-confirm`}>
            Confirm
          </Button>
          <Button size="sm" variant="subtle" onClick={() => setConfirming(false)} disabled={loading}>
            Cancel
          </Button>
        </Group>
      ) : (
        <Button size="sm" onClick={() => setConfirming(true)} data-testid={`buy-${goodId}`}>
          {`Buy · ${priceBuzz} Buzz`}
        </Button>
      )}
      {notice ? (
        <p role="status" data-testid={`buy-${goodId}-notice`} style={{ margin: '6px 0 0', fontSize: 13 }}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
