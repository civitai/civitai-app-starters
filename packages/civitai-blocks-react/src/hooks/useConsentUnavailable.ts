import { useCallback, useEffect, useState } from 'react';

import type { ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

import {
  armConsentRefusalLatch,
  clearConsentRefusalLatch,
  readConsentRefusalLatch,
} from '../internal/consentRefusalLatch.js';
import { getTransport } from '../internal/singleton.js';
import { subscribeTyped } from '../internal/transport.js';

export type { ConsentUnavailablePayload };

/** What {@link useConsentUnavailable} returns. */
export interface UseConsentUnavailable {
  /**
   * The most recent `CONSENT_UNAVAILABLE` push, or `null` if the host has not
   * refused (the normal case — nothing to render differently).
   *
   * 🔴 `refusal.scopes` CAN BE EMPTY and that is still a refusal. The host
   * decides to refuse on its own UNFILTERED un-grantable set, then filters the
   * names it puts on the wire down to the public block-scope vocabulary — so a
   * request naming nothing the platform recognises refuses with `scopes: []`.
   * Branch on `refusal !== null`; use `refusal.scopes` only to word the copy.
   */
  refusal: ConsentUnavailablePayload | null;
  /**
   * Clear the stored refusal — this hook's state AND the buffered copy.
   *
   * A refusal is scoped to the scopes that were asked for, not to the block, so
   * it must not latch forever: a block that is refused `ai:write:budgeted` may
   * still legitimately request something else later, and a long-lived block
   * whose host re-inits (sign-in, a new token) can find itself grantable again.
   * Call this when you move on from the refused action.
   *
   * Clearing the BUFFER too is load-bearing, not tidiness: the refusal is
   * retained across mounts (see the hook docblock), so a `reset()` that cleared
   * only local state would be silently undone the next time this hook mounted —
   * the documented "Try again" button would put the refusal straight back.
   */
  reset: () => void;
}

/**
 * Subscribe to the host's `CONSENT_UNAVAILABLE` push — the signal that a
 * `REQUEST_CONSENT` this block sent can **never** be granted in this
 * environment, because the scope was clamped or withheld at mint. Distinct from
 * "the viewer hasn't confirmed the dialog yet", which produces no message at
 * all.
 *
 * This is the whole point of the message: without it a block keeps telling the
 * user *"Confirm in the Civitai dialog. If you dismissed it, click Generate
 * again"* while the host says the permission is unavailable — two contradictory
 * messages on one screen, and the misleading one is the block's.
 *
 * 🔴 **PRECONDITION — pass `scopes` to `requestConsent()`, with a real scope
 * name in it.** The refusal is computed from the request's `scopes` hint, and
 * both dev hosts and the real host (`resolveUngrantableConsentNotice`) return
 * "no notice" unless that hint is an array holding AT LEAST ONE NON-EMPTY
 * STRING. Measured on this package's implementation: `undefined`, a non-array,
 * `[]`, `['']` and `[1, 2]` ALL yield `notify: false`, and the real host applies
 * the same `requested.length === 0` guard. So `requestConsent({ scopes: [] })`
 * follows the letter of "always pass scopes" and still produces silence — no
 * grant, no refusal, no error — and this hook sits at `null` forever. The reason
 * is that without a named scope proven un-grantable there is no way to
 * distinguish "never" from "not confirmed yet", and guessing is what produced
 * the contradictory screen. Call `requestConsent({ scopes: ['ai:write:budgeted'] })`.
 *
 * 🔴 **UNCORRELATED, AND THAT IS THE SHAPE OF THE PUBLIC API — not an oversight
 * that can be fixed later.** `REQUEST_CONSENT` carries no `requestId`, so
 * `CONSENT_UNAVAILABLE` is a fire-and-forget push and not a reply. Two
 * consequences a block author has to design around: EVERY mounted
 * `useConsentUnavailable()` observes EVERY refusal, and there is no reliable way
 * to filter one out — `scopes` cannot serve as a correlation key because it may
 * legitimately be `[]` and is in any case only advisory. If two independent
 * parts of your block request different scopes, both will see both refusals;
 * keep the request and its refusal UI in one component, or track which request
 * is outstanding yourself. Nothing here awaits anything — against a host that
 * never sends the message the hook simply stays `null`, which is today's
 * behaviour.
 *
 * 🔴 **A refusal is BUFFERED, so one that arrives while this hook is unmounted
 * is not lost.** The transport delivers an unsolicited push only to handlers
 * registered at the moment it arrives, so without a buffer a refusal that landed
 * before mount (or between unmount and remount) vanished — and a dropped refusal
 * puts back the two-message screen above. `requestConsent()` arms the buffer as
 * it sends, and a mounting hook seeds from it. The buffer holds at most the
 * LATEST refusal, is discarded when the block token changes (its premise is that
 * token's scopes), and is cleared by `reset()`. See
 * `internal/consentRefusalLatch.ts`.
 *
 * The subscription goes through the transport, so the handler runs only after
 * the message has cleared the origin allowlist AND the payload validator; the
 * hook never adds its own `window` listener behind that boundary.
 *
 * @example
 * const { requestConsent } = useRequestConsent();
 * const { refusal } = useConsentUnavailable();
 *
 * if (refusal) return <p>Generating isn't available on this page.</p>;
 * return <button onClick={() => requestConsent({ scopes: ['ai:write:budgeted'] })}>Generate</button>;
 */
export function useConsentUnavailable(): UseConsentUnavailable {
  const [refusal, setRefusal] = useState<ConsentUnavailablePayload | null>(null);

  useEffect(() => {
    const transport = getTransport();
    // Keep recording even while nothing is mounted, and seed from anything
    // recorded before this mount. Seeding in the effect (not lazy `useState`)
    // is deliberate: the latch is armed here too, so the read has to happen
    // after the arm, and an effect is the only place both can be ordered.
    armConsentRefusalLatch(transport);
    const buffered = readConsentRefusalLatch(transport);
    if (buffered) setRefusal(buffered);

    // `subscribeTyped` (not the raw `onMessage`) is what makes `payload` a
    // `ConsentUnavailablePayload` here instead of `unknown` + a cast at the call
    // site — the cast is unchecked, so a payload shape change would compile
    // straight through it in every consuming block.
    return subscribeTyped(transport, 'CONSENT_UNAVAILABLE', (payload) => {
      // Store the payload UNCONDITIONALLY. No `payload.scopes.length` gate: an
      // empty `scopes` is a legitimate refusal (see `UseConsentUnavailable`),
      // and gating on it would drop the message this hook exists to deliver.
      setRefusal(payload);
    });
  }, []);

  const reset = useCallback(() => {
    clearConsentRefusalLatch();
    setRefusal(null);
  }, []);

  return { refusal, reset };
}
