import type { ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

import type { BlockTransport } from './transport.js';
import { subscribeTyped } from './transport.js';

/**
 * A one-slot buffer for the host's `CONSENT_UNAVAILABLE` push.
 *
 * 🔴 WHY THIS EXISTS — WITHOUT IT THE HOOK DROPS REFUSALS, AND A DROPPED
 * REFUSAL REPRODUCES THE EXACT TWO-MESSAGE SCREEN THE MESSAGE WAS ADDED TO
 * REMOVE. `CONSENT_UNAVAILABLE` is an uncorrelated fire-and-forget push, and the
 * transport delivers a push only to handlers registered AT THE MOMENT IT
 * ARRIVES — an unsolicited message with no listeners falls through to
 * `IframeTransport.handleMessage`'s no-op tail and is gone. So a refusal that
 * lands while no `useConsentUnavailable()` is mounted was lost forever, and both
 * orderings were measured to yield `null`: push-then-mount, and
 * mount → unmount → push → remount. That is reachable whenever the component
 * that CALLS `requestConsent()` and the one that RENDERS the refusal are
 * different components, or the consumer is conditionally rendered.
 *
 * The sibling push consumer in this package already solves the same problem the
 * same way: `useImageUpload` BUFFERS an `IMAGE_SCAN_RESOLVED` verdict that
 * arrives before anyone calls `scanStatus()` rather than dropping it.
 *
 * TWO THINGS ARM THE LATCH, and the first is the one that closes the gap:
 *
 *  1. `requestConsent()` — a refusal can only ever FOLLOW a `REQUEST_CONSENT`,
 *     so arming at send time guarantees a listener exists before the message
 *     that provokes the refusal goes out, whether or not any consumer is
 *     mounted. (A block that posts `REQUEST_CONSENT` through the raw transport
 *     instead of the hook does not arm it; that path is unchanged.)
 *  2. `useConsentUnavailable()` on mount — so a hook used on its own still
 *     records for its own later remounts.
 *
 * 🔴 STALENESS — the hazard buffering buys, and how it is bounded. A latched
 * refusal replayed to an unrelated later mount is a block telling a user
 * "unavailable" about something it never asked for. Two bounds:
 *
 *  - The latch is stamped with the block token in force when it was recorded,
 *    and a stamp that no longer matches is discarded on read. A refusal means
 *    "the scopes THIS token was minted with can never be extended here"; the
 *    grant path re-mints and pushes a `TOKEN_REFRESH` (and the SDK documents
 *    routine host rotation at roughly every 13 minutes on that same message), so
 *    the premise of a refusal does not outlive its token. The bias is
 *    deliberate: a discarded-but-still-true refusal costs one more
 *    request/refusal round-trip, while a retained-but-now-false one tells the
 *    user a granted permission is unavailable.
 *  - `reset()` clears the latch, not just the calling hook's state — otherwise
 *    the documented "Try again" button would be undone by the next remount.
 *
 * Keyed on the transport INSTANCE: `getTransport()` returns one transport for
 * the life of a page, so in production this installs exactly once. Tests call
 * `resetTransport()`, which mints a new instance — the identity check then
 * re-installs and drops the previous latch, so no state leaks between tests and
 * nothing has to remember to clear it.
 */
interface LatchedRefusal {
  payload: ConsentUnavailablePayload;
  /** `BlockSnapshot.token.raw` at the moment the refusal was recorded. */
  tokenRaw: string;
}

let latched: LatchedRefusal | null = null;
let installedOn: BlockTransport | null = null;

/**
 * Install the latch's subscription on `transport` if it is not already the
 * transport we are latching for. Idempotent per transport instance.
 */
export function armConsentRefusalLatch(transport: BlockTransport): void {
  if (installedOn === transport) return;
  installedOn = transport;
  latched = null;
  subscribeTyped(transport, 'CONSENT_UNAVAILABLE', (payload) => {
    latched = { payload, tokenRaw: transport.getSnapshot().token.raw };
  });
}

/**
 * The buffered refusal, or `null`.
 *
 * Discards (and forgets) a refusal recorded against a token that is no longer
 * the current one — see the staleness note above. Reading is idempotent
 * otherwise: two hooks mounting together both get the same refusal, matching the
 * "every mounted consumer sees every refusal" shape of the underlying push.
 */
export function readConsentRefusalLatch(
  transport: BlockTransport,
): ConsentUnavailablePayload | null {
  if (!latched) return null;
  if (latched.tokenRaw !== transport.getSnapshot().token.raw) {
    latched = null;
    return null;
  }
  return latched.payload;
}

/** Drop the buffered refusal. Called by `useConsentUnavailable().reset()`. */
export function clearConsentRefusalLatch(): void {
  latched = null;
}
