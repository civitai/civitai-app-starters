import { useCallback, useEffect, useRef, useState } from 'react';

import { CollectionFollowError, useCollectionFollow } from '../hooks/useCollectionFollow.js';
import { useRequestSignIn } from '../hooks/useRequestSignIn.js';
import { Button } from './Button.js';
import type { ButtonSize, ButtonVariant } from './Button.js';
import { useBlocksStyles } from './styles.js';

const NOTE_STYLE = {
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--civitai-color-text-dimmed)',
} as const;

export interface FollowButtonProps {
  /** The collection to follow / unfollow. A positive integer. */
  collectionId: number;
  /**
   * Whether the VIEWER currently follows it, as your app's own data says. This
   * is the source of truth; the control only overrides it while its own write
   * is settling.
   */
  followed: boolean;
  /**
   * Called with the state the HOST echoed after a successful write — adopt it
   * into whatever `followed` is read from.
   *
   * 🔴 Not calling it is safe but leaves the control as the only thing that
   * knows: it holds the echoed value until `followed` catches up, so a remount
   * (a list refresh, a tab switch) shows the stale server value again.
   */
  onChange?: (followed: boolean) => void;
  /**
   * What the collection is called, for the accessible names only — "Follow
   * <name>". Omitted → the generic "Follow this collection".
   *
   * 🔴 THIS IS A LABEL, NOT A CLAIM, and it is deliberately not on the wire.
   * The host resolves the collection's real name server-side from
   * `collectionId` and renders THAT in its consent dialog, so a wrong or
   * malicious value here is contradicted where it counts. Passing a sentence
   * still makes it this control's accessible name — pass a title.
   */
  collectionName?: string;
  /** Disable the control (e.g. while the surrounding view is loading). */
  disabled?: boolean;
  /** Button size preset. Defaults to `'md'`. */
  size?: ButtonSize;
  /**
   * Variant when NOT following. Defaults to `'filled'`. The following state is
   * always `'light'` so the two are distinguishable without reading the label.
   */
  variant?: ButtonVariant;
  /**
   * Test hook. The status note is `<id>-note`; omitted, the ids are
   * `follow-button` and `follow-button-note`.
   *
   * 🔴 Grep for the SUFFIX, never the composed value — a composed testid
   * appears nowhere in source as a literal.
   */
  'data-testid'?: string;
}

/**
 * Follow / unfollow a collection for the viewer, through the host bridge.
 *
 * 🔴 EVERY PRESS OPENS A HOST-CHROME CONSENT CONFIRM naming the collection the
 * HOST resolved from `collectionId`. That click is the only consent this path
 * has ever had (the HTTP predecessor's `collections:write:self` scope was
 * consent-exempt server-side and prompted nobody), so this control TIGHTENS the
 * flow rather than loosening it. There is no way to suppress the confirm and no
 * option should be added for one.
 *
 * 🔴 WHY THIS IS SHARED RATHER THAN HAND-ROLLED. Three outcomes of that bridge
 * are easy to get wrong in a way that looks fine:
 *  - `declined` is NOT a failure. The viewer dismissed the confirm and NOTHING
 *    was written, so the control reverts and says nothing. A hand-rolled button
 *    that renders every rejection shows "Could not follow" to someone who chose
 *    not to.
 *  - `sign-in-required` is not a failure either — it is a missing session, so it
 *    routes into `REQUEST_SIGN_IN` instead of an error line.
 *  - the optimistic flip must be reverted on EVERY other rejection, and then
 *    replaced by the host's ECHO on success rather than by the guess.
 *
 * The `followed` prop stays the source of truth. While a write settles the
 * control shows its optimistic value; on success it holds the host's echo until
 * `followed` agrees, so it never blinks back to a stale server value while the
 * parent catches up.
 *
 * @example
 * <FollowButton
 *   collectionId={collection.id}
 *   collectionName={collection.name}
 *   followed={collection.followed}
 *   onChange={(f) => setCollection((c) => ({ ...c, followed: f }))}
 *   data-testid="collection-follow"
 * />
 */
export function FollowButton({
  collectionId,
  followed,
  onChange,
  collectionName,
  disabled = false,
  size = 'md',
  variant = 'filled',
  'data-testid': testId,
}: FollowButtonProps): React.JSX.Element {
  useBlocksStyles();
  const { setFollow, pending } = useCollectionFollow();
  const { requestSignIn } = useRequestSignIn();
  /** The value this control is asserting over `followed`, or `null`. */
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * The `collectionId` the in-flight write is FOR.
   *
   * 🔴 THIS IS THE CORRELATION GUARD, AND IT REPLACES AN ATTEMPT COUNTER THAT
   * GUARDED NOTHING. A counter incremented only inside `toggle()` cannot see the
   * parent change anything, so the case its comment claimed to close — a settle
   * arriving after the parent moved the row — went straight through it; deleting
   * all three of its lines left this file's suite fully green, which is how the
   * false claim survived review.
   *
   * The reachable bug it was pretending to cover: a single mounted instance whose
   * `collectionId` prop CHANGES mid-flight (a rail showing "the currently
   * selected collection", or an unkeyed recycled list row). The host's reply for
   * the OLD collection then lands, and without this the control adopts it as the
   * NEW one's state and reports it through `onChange` — so the app records a
   * follow the viewer never made, on an account-write control.
   *
   * Correlating on the id is possible because the host ECHOES it:
   * `BlockCollectionFollowResult.collectionId` exists for exactly this, and
   * `isValidCollectionFollowResult` already pins it to a positive integer so a
   * malformed echo cannot reach this comparison.
   */
  const inFlightForRef = useRef<number | null>(null);

  const shown = optimistic ?? followed;

  // 🔴 THE OPTIMISTIC VALUE BELONGS TO A COLLECTION, NOT TO THIS COMPONENT.
  // When the prop moves, whatever this control was asserting is about the id it
  // has just stopped showing — keeping it paints the OLD collection's state onto
  // the NEW one, which is the same wrong-row bug as an uncorrelated settle and
  // needs no network round trip to happen. Drop it, drop any failure note, and
  // release the in-flight marker so a reply for the old id can never re-adopt.
  useEffect(() => {
    setOptimistic(null);
    setFailed(false);
    inFlightForRef.current = null;
  }, [collectionId]);

  // The parent has caught up — stop asserting. Kept as an effect rather than
  // clearing on success, because clearing there is only correct if the parent
  // adopts `onChange` synchronously, and `onChange` is optional.
  useEffect(() => {
    if (optimistic !== null && optimistic === followed) setOptimistic(null);
  }, [optimistic, followed]);

  const ids = testId
    ? { trigger: testId, note: `${testId}-note` }
    : { trigger: 'follow-button', note: 'follow-button-note' };

  const toggle = useCallback(async () => {
    const target = collectionId;
    inFlightForRef.current = target;
    /**
     * This settle still belongs to the collection on screen. Both halves are
     * load-bearing: the ECHO comparison catches a reply for a collection this
     * control has moved off, and the REF comparison catches the case where the
     * prop moved away and back again while a write was in flight.
     */
    const stillOurs = (echoedId: number) =>
      echoedId === target && inFlightForRef.current === target;
    const next = !shown;
    setOptimistic(next);
    setFailed(false);
    try {
      const result = await setFollow({ collectionId: target, follow: next });
      // 🔴 Correlate on the HOST'S echoed id, not on a counter. A reply for a
      // collection this control no longer shows must change nothing and must
      // NOT be reported through `onChange` — adopting it records a follow the
      // viewer never made against whatever row is on screen now.
      if (!stillOurs(result.collectionId)) return;
      // 🔴 Adopt the ECHO, not `next`. They agree today; reading the host's
      // answer is what keeps this correct if one ever settles differently, and
      // it costs nothing.
      setOptimistic(result.followed);
      onChange?.(result.followed);
    } catch (err: unknown) {
      // A rejection carries no echoed id, so correlate on the ref alone: a
      // failure belonging to a collection this control has moved off must not
      // revert or announce anything about the one now on screen.
      if (inFlightForRef.current !== target) return;
      // Revert first, unconditionally: every path below this line is one where
      // no write occurred.
      setOptimistic(null);
      if (err instanceof CollectionFollowError) {
        // No session. The viewer's next step is signing in, not retrying — and
        // a "could not follow" line here would be actively misleading.
        if (err.signInRequired) {
          requestSignIn();
          return;
        }
        // The viewer dismissed the host's confirm. Say NOTHING: they answered,
        // and the answer was no.
        if (err.declined) return;
      }
      setFailed(true);
    }
  }, [collectionId, onChange, requestSignIn, setFollow, shown]);

  const name = collectionName ? `"${collectionName}"` : 'this collection';

  return (
    <>
      <Button
        size={size}
        // The following state is always `light` so the two states differ
        // visually and not only in wording — the label alone is a poor signal at
        // a glance, and this control is often rendered small in a card corner.
        variant={shown ? 'light' : variant}
        loading={pending}
        disabled={disabled}
        onClick={() => void toggle()}
        data-testid={ids.trigger}
        aria-pressed={shown}
        aria-label={shown ? `Unfollow ${name}` : `Follow ${name}`}
      >
        {shown ? 'Following' : 'Follow'}
      </Button>
      {failed && (
        // 🔴 `role="alert"`. `aria-pressed` reverts on failure, but a reverted
        // toggle state is indistinguishable from never having pressed it — a
        // screen-reader user would be told nothing at all. Success needs no
        // equivalent: `aria-pressed` changing IS the announcement.
        <span role="alert" style={NOTE_STYLE} data-testid={ids.note}>
          Could not update — try again?
        </span>
      )}
    </>
  );
}
