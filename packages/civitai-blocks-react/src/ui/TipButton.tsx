import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useTip } from '../hooks/useTip.js';
import type { TipParams } from '../hooks/useTip.js';
import { Button } from './Button.js';
import type { ButtonSize, ButtonVariant } from './Button.js';
import { Group } from './Group.js';
import { useBlocksStyles } from './styles.js';

const NOTE_STYLE = {
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--civitai-color-text-dimmed)',
} as const;

export interface TipButtonProps {
  /** The recipient. The SENDER is always the token subject — server-self-bound. */
  toUserId: number;
  /** Buzz to send. Must be a positive integer. */
  amount: number;
  /** Optional context recorded on the transaction. */
  entityType?: TipParams['entityType'];
  entityId?: number;
  /**
   * What the viewer is tipping FOR, lower-case and singular — "creator",
   * "curator", "post". Appears in the confirm question and both accessible
   * names.
   *
   * 🔴 It is spliced into an `aria-label`, so pass a bare noun, not a sentence.
   */
  noun: string;
  /**
   * This viewer has ALREADY tipped this target in this session. Renders the
   * settled state and skips the handshake.
   *
   * 🔴 THERE IS NO SERVER FIELD FOR THIS. `useTip` returns the transaction echo
   * and nothing reads back "has this viewer tipped X?" — so without a value
   * here the settled state is local-only and any remount re-arms the control.
   * That is not a no-op the way a duplicate vote would be: a second press is a
   * SECOND TRANSFER. Record it in your own per-viewer storage when the tip
   * resolves and feed it back.
   */
  tipped?: boolean;
  /**
   * The viewer's remaining daily tip allowance, in Buzz. When supplied and
   * smaller than `amount`, the control refuses locally with a note instead of
   * sending a request the server would reject.
   *
   * 🔴 DELIBERATELY A PROP, NOT AN INTERNAL `useTipAllowance()`. This control is
   * rendered per card / per rail, so fetching inside it would fan one screen out
   * into N identical HTTP reads. Hold ONE `useTipAllowance()` in the view and
   * pass `allowance?.remaining` down; call its `refetch()` from `onTipped`.
   *
   * Omitted → no local ceiling check, and the server's own limit is the only
   * gate. That is correct, just later and less legible.
   */
  remaining?: number;
  /**
   * Why tipping is unavailable, e.g. "You can't tip your own collection."
   * Present ⇒ the control is disabled and this is shown as its `title` and
   * appended to its accessible name.
   *
   * 🔴 USE THIS FOR THE SELF-TIP CASE. The server answers a self-tip with a 403,
   * so without it the viewer presses, confirms, and is told a transfer failed —
   * for something that was never going to be allowed.
   */
  disabledReason?: string;
  /** Disable for any other reason (view still loading, no target resolved yet). */
  disabled?: boolean;
  /**
   * Called after a SUCCESSFUL transfer, with the amount sent. Refetch your
   * allowance and record the `tipped` flag here.
   */
  onTipped?: (amount: number) => void;
  /** Button size preset. Defaults to `'md'`. */
  size?: ButtonSize;
  /** Variant for the trigger. Defaults to `'light'`. */
  variant?: ButtonVariant;
  /**
   * Test hook for the TRIGGER. The other four are DERIVED by suffix:
   * `<id>-confirm`, `<id>-cancel`, `<id>-done`, `<id>-prompt`. Omitted, the ids
   * are `tip-button`, `tip-confirm`, `tip-cancel`, `tip-done`,
   * `tip-confirm-prompt`.
   *
   * 🔴 Grep for the SUFFIX, never the composed value.
   */
  'data-testid'?: string;
}

/**
 * Send a Buzz tip, behind an in-block two-step confirm.
 *
 * 🔴 THE CONFIRM IS THIS COMPONENT'S, NOT HOST CHROME — state that honestly
 * rather than implying platform mediation. `useTip` posts to the block-token-
 * gated tip endpoint directly (scope `social:tip:self`), so unlike the
 * collection-follow bridge NOTHING outside the iframe asks the viewer anything.
 * A one-press money spend is therefore reachable by construction, and the
 * two-step handshake here is the only thing between a stray tap and a transfer.
 * Do not add a prop to skip it.
 *
 * 🔴 IT MINTS ONE IDEMPOTENCY KEY PER LOGICAL TIP AND REUSES IT ON RETRY. That
 * is the property a hand-rolled button most reliably misses: `useTip` mints a
 * FRESH key per call when you do not pass one, so retrying after a timeout
 * whose response was merely LOST sends a SECOND transfer. Here the key is
 * minted when the control arms and rotates only after a tip actually settles,
 * so "try again" on a failed press is collapsed server-side to one transfer.
 *
 * The caller decides who sees it: `tip` rejects for an anonymous viewer and a
 * self-tip 403s. Pass `disabledReason` for the self case rather than offering an
 * error.
 *
 * @example
 * // ONE allowance read for the whole view, passed down.
 * const { allowance, refetch } = useTipAllowance();
 * <TipButton
 *   noun="curator"
 *   toUserId={collection.curator.id}
 *   amount={50}
 *   entityType="Collection"
 *   entityId={collection.id}
 *   remaining={allowance?.remaining}
 *   tipped={tippedCurators.has(collection.id)}
 *   disabledReason={isSelf ? "You can't tip your own collection." : undefined}
 *   onTipped={() => { refetch(); markTipped(collection.id); }}
 *   data-testid="tip-curator"
 * />
 */
export function TipButton({
  toUserId,
  amount,
  entityType,
  entityId,
  noun,
  tipped = false,
  remaining,
  disabledReason,
  disabled = false,
  onTipped,
  size = 'md',
  variant = 'light',
  'data-testid': testId,
}: TipButtonProps): React.JSX.Element {
  useBlocksStyles();
  const { tip } = useTip();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  /** Monotonic id of the current attempt — see `ReportButton` for the measured why. */
  const attemptRef = useRef(0);
  /**
   * The idempotency key for THIS logical tip. Stable across retries, which is
   * the point; `useId()` seeds it so two TipButtons mounted in one tree never
   * collide, and the target + amount are folded in so that changing either (an
   * amount preset switcher) correctly starts a NEW logical tip rather than
   * colliding with the abandoned one.
   *
   * 🔴 EVERY FIELD OF THE TIP'S IDENTITY IS IN THE KEY, and the earlier version
   * omitted two. `entityType`/`entityId` are sent in the POST body and recorded
   * on the transaction, so they are part of WHICH tip this is — leaving them out
   * meant that changing the entity after a failed attempt reused the same key,
   * and if the first attempt had actually landed (the lost-response case this
   * mechanism exists for) the second, deliberate tip to a DIFFERENT object was
   * collapsed into it and the block was told it succeeded. Under-charge rather
   * than double-charge, but wrong either way.
   *
   * 🔴 NOT ROTATED AFTER A SUCCESS, and what licenses that is narrower than it
   * first appears. `done` is never cleared, so a control that has settled
   * THROUGH ITS OWN SUCCESS PATH cannot send again from this mount. `settled` is
   * `done || tipped`, and the `tipped` half is a PROP — a parent can withdraw it
   * — so terminality is a property of `done`, not of `settled`. That distinction
   * is why the success path above reports unconditionally: it is what guarantees
   * `done` is set whenever money actually moved, which is in turn what makes this
   * key safe to keep. Change either and rotate the key.
   */
  const keySeed = useId();
  const idempotencyKey = `${keySeed}:${toUserId}:${amount}:${entityType ?? '-'}:${entityId ?? '-'}`;

  const settled = done || tipped;
  // 🔴 Both guards are about a NUMBER reaching a money path, and both were
  // missing. `amount` is documented a positive integer and was unchecked, so
  // `amount={0}` rendered "Tip 0" and posted it. And `remaining={NaN}` makes
  // `amount > remaining` FALSE, so a NaN allowance did not merely fail to
  // block — it silently REMOVED the ceiling, which is the wrong direction for
  // an unusable value. `Number.isFinite` first, so a non-number can never
  // decide a comparison.
  const amountValid = Number.isFinite(amount) && amount > 0;
  const overAllowance =
    remaining !== undefined && (!Number.isFinite(remaining) || amount > remaining);
  const blocked = disabled || disabledReason !== undefined || !amountValid;

  const ids = testId
    ? {
        trigger: testId,
        confirm: `${testId}-confirm`,
        cancel: `${testId}-cancel`,
        done: `${testId}-done`,
        prompt: `${testId}-prompt`,
      }
    : {
        trigger: 'tip-button',
        confirm: 'tip-confirm',
        cancel: 'tip-cancel',
        done: 'tip-done',
        prompt: 'tip-confirm-prompt',
      };

  // Move focus with the control at both transitions — each step REPLACES the
  // element the viewer just activated, so without this a keyboard user is
  // dropped to <body>. Same three effects, and the same reasoning, as
  // `ReportButton`; keyed on the transition, never on the request lifecycle.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  useEffect(() => {
    if (busy) cancelRef.current?.focus();
  }, [busy]);
  // Server/app truth ENDS the handshake rather than leaving it mounted beneath
  // the settled note, where a late rejection could resurrect a stale failure
  // against a tip the viewer has already seen settle.
  useEffect(() => {
    if (tipped) {
      attemptRef.current += 1;
      setConfirming(false);
      setFailure(null);
      setBusy(false);
    }
  }, [tipped]);

  const confirm = useCallback(async () => {
    const attempt = (attemptRef.current += 1);
    const current = () => attemptRef.current === attempt;
    setBusy(true);
    setFailure(null);
    try {
      await tip({ toUserId, amount, ...(entityType ? { entityType } : {}), ...(entityId !== undefined ? { entityId } : {}) }, { idempotencyKey });
      // 🔴 A LANDED TRANSFER IS REPORTED UNCONDITIONALLY — no `current()` check
      // on this path, deliberately, and the earlier version's check here was the
      // defect rather than the safety.
      //
      // Buzz has MOVED by the time this line runs. Nothing the viewer or the
      // parent did in the meantime can un-send it: Cancel resets this control's
      // UI but does not abort the POST, and a parent flipping `tipped` mid-flight
      // bumps the attempt for its own reasons. Suppressing the settle in either
      // case left the app never learning the transfer succeeded — so `onTipped`
      // never fired, the allowance was never refetched, and no `tipped` record
      // was written, which re-armed the control over money that was already gone.
      //
      // Showing "Tipped" for a transfer that happened is correct even if the
      // viewer pressed Cancel a moment earlier; showing "Tip 50" again is what
      // invites the second one. Only the FAILURE path below respects supersession
      // — there, nothing moved, so an abandoned attempt has nothing to report.
      setDone(true);
      setConfirming(false);
      setFailure(null);
      onTipped?.(amount);
    } catch (err: unknown) {
      if (!current()) return;
      // Show the SERVER's message. Unlike a report, a failed tip has real and
      // varied causes the viewer can act on (insufficient balance, over the
      // daily cap, self-tip) and a fixed "could not send" throws all of them
      // away.
      setFailure(err instanceof Error && err.message ? err.message : 'Could not send the tip.');
    } finally {
      if (current()) setBusy(false);
    }
  }, [amount, entityId, entityType, idempotencyKey, onTipped, tip, toUserId]);

  if (settled) {
    return (
      <span
        ref={doneRef}
        tabIndex={-1}
        data-testid={ids.done}
        role="status"
        style={{ ...NOTE_STYLE, outline: 'none' }}
      >
        {`Tipped ${noun}`}
      </span>
    );
  }

  if (!confirming) {
    const reason = disabledReason ?? (overAllowance ? 'Over your remaining daily tip allowance.' : undefined);
    return (
      <Button
        size={size}
        variant={variant}
        disabled={blocked || overAllowance}
        onClick={() => setConfirming(true)}
        data-testid={ids.trigger}
        {...(reason ? { title: reason } : {})}
        aria-label={reason ? `Tip the ${noun} — unavailable: ${reason}` : `Tip the ${noun} ${amount} Buzz`}
      >
        {`Tip ${amount}`}
      </Button>
    );
  }

  return (
    <Group gap={6} align="center" wrap={false} data-testid={ids.prompt}>
      <span style={NOTE_STYLE} {...(failure ? { role: 'alert' as const } : {})}>
        {failure ?? `Send ${amount} Buzz to the ${noun}?`}
      </span>
      <Button
        ref={confirmRef}
        size="sm"
        loading={busy}
        onClick={() => void confirm()}
        data-testid={ids.confirm}
        aria-label={`Confirm sending ${amount} Buzz to the ${noun}`}
      >
        Send
      </Button>
      <Button
        ref={cancelRef}
        size="sm"
        variant="subtle"
        // 🔴 NOT disabled in flight, for the reason `ReportButton` records: a
        // reply that never arrives would otherwise leave both controls dead with
        // no way back short of a remount. The attempt token closes the race
        // without taking the escape hatch away.
        onClick={() => {
          attemptRef.current += 1;
          setBusy(false);
          setFailure(null);
          setConfirming(false);
        }}
        data-testid={ids.cancel}
        aria-label="Cancel the tip"
      >
        Cancel
      </Button>
    </Group>
  );
}
