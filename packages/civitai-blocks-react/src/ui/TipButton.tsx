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
   * The idempotency keys this mount has already reported a landed transfer for.
   *
   * 🔴 KEYED, NOT A BOOLEAN — and the boolean it replaces was wrong in the
   * OPPOSITE direction from the bug it fixed. "At most once per mount" collapses
   * two transfers that are genuinely distinct: Cancel does not abort POST #1, so
   * if the parent then moves `amount` or the entity a NEW key is minted, the
   * server does NOT collapse them, and 150 Buzz moves while the app is told 50.
   * `onTipped` is where a caller refetches the allowance and records its
   * `tipped` flag, so the second transfer left no record — re-creating on
   * remount the very harm the previous round cited. The correct scope is once
   * per KEY: same key ⇒ the server saw one transfer ⇒ report once; different
   * key ⇒ two transfers ⇒ report both.
   *
   * 🔴 A REF, NOT STATE. The success path reads it in the same tick it would
   * write it, so two promises resolving in one turn both see stale state and
   * both report; a ref is written synchronously, so the second sees the first.
   */
  const reportedKeysRef = useRef<Set<string>>(new Set());
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
   * — so terminality is a property of `done`, not of `settled`.
   *
   * ⚠️ An earlier revision continued "…which is why the success path reports
   * UNCONDITIONALLY". It no longer does — it reports once per KEY — and the
   * sentence is corrected rather than deleted because it was load-bearing. The
   * invariant that actually licenses keeping the key is unchanged: `done` is set
   * on the first landed transfer for a given key, and a repeat under the SAME
   * key is that same transfer. Change either and rotate.
   */
  const keySeed = useId();
  const idempotencyKey = `${keySeed}:${toUserId}:${amount}:${entityType ?? '-'}:${entityId ?? '-'}`;

  const settled = done || tipped;
  // Both guards are about a NUMBER reaching a money path, and both were once
  // missing: `amount={0}` rendered "Tip 0" and posted it, and an unusable
  // `remaining` silently REMOVED the ceiling rather than blocking.
  //
  // `amount` must be a real, positive number. `Infinity` is not a tippable
  // quantity, so `isFinite` is load-bearing on its own rather than a longer
  // spelling of `> 0` — and it does not coerce, so a non-number is rejected too.
  const amountValid = Number.isFinite(amount) && amount > 0;
  // 🔴 THREE cases for `remaining`, not two, and a previous revision lost one
  // while fixing another. `NaN` is an UNUSABLE reading — every comparison
  // against it is false — so it must BLOCK. `Infinity` is a MEANINGFUL reading,
  // an unlimited allowance, so blocking it refuses a viewer who is allowed
  // everything; sweeping the two together under `!Number.isFinite` got that
  // wrong. And a NON-NUMBER must block for the same reason as `NaN`: 🔴
  // `Number.isNaN` does NOT coerce, so the `!isFinite` → `isNaN` fix silently
  // dropped the type check and let `remaining: 'abc'` through — removing the
  // ceiling, the wrong direction, and precisely what the comment it replaced
  // claimed could not happen.
  const overAllowance =
    remaining !== undefined &&
    (typeof remaining !== 'number' || Number.isNaN(remaining) || amount > remaining);
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
    // 🔴 RE-CHECK AT THE SPEND, NOT ONLY AT THE ARM. `blocked` gates the trigger,
    // but the prompt stays mounted across a re-render — so a parent moving
    // `amount` to 0 (or NaN) AFTER the viewer armed the control left an enabled
    // Send that posted it. An amount switcher mid-handshake is a flow this
    // component's own JSDoc contemplates, so this is reachable, not theoretical.
    if (!amountValid || overAllowance || blocked) {
      setFailure('That amount cannot be sent.');
      return;
    }
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
      //
      // 🔴 BUT AT MOST ONCE, and "unconditionally" without this was a REGRESSION
      // the previous revision introduced. Cancel-then-retry sends a SECOND POST
      // carrying the SAME idempotency key, so the server collapses the pair into
      // ONE transfer while both promises resolve — and an unguarded report then
      // called `onTipped(amount)` twice for money that moved once. `onTipped` is
      // handed the amount precisely so a caller can decrement an allowance with
      // it, so double-firing double-counts. The answer is "once per mount",
      // which is neither the old "never after supersession" nor a bare "always".
      if (!reportedKeysRef.current.has(idempotencyKey)) {
        reportedKeysRef.current.add(idempotencyKey);
        setDone(true);
        setConfirming(false);
        setFailure(null);
        onTipped?.(amount);
      }
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
    // 🔴 `amountValid`, `overAllowance` and `blocked` MUST be here. The gate at
    // the top of this callback reads all three, and the previous revision listed
    // none of them — so they were frozen at whatever render last recreated the
    // callback, and the gate decided a SPEND on stale values. It failed in both
    // directions and there is no eslint in this repo to catch it:
    //
    //   • STALE-RESTRICTIVE, and permanent: a parent that tops up `remaining`,
    //     or clears `disabled` / `disabledReason` (the "view still loading"
    //     usage this component's own JSDoc names), left Send refusing a
    //     perfectly good tip with a message that is false about the amount —
    //     for the life of the mount, since nothing else moved a dep.
    //   • STALE-PERMISSIVE: the mirror case the gate's own comment claims to
    //     cover — `remaining` dropping, or `disabledReason` appearing, AFTER
    //     arming — sailed straight through.
    //
    // 🔴 IT WAS ALSO CONSUMER-DEPENDENT, which is why no test caught it: an
    // INLINE `onTipped={() => {}}` (the shape the @example uses) recreates the
    // callback every render and hides the whole thing, while a consumer doing
    // the idiomatic `useCallback` gets the wedge. Listing the derived booleans
    // rather than the raw props keeps this honest — add an input to the gate and
    // the dep is already named.
  }, [
    amount,
    amountValid,
    blocked,
    entityId,
    entityType,
    idempotencyKey,
    onTipped,
    overAllowance,
    tip,
    toUserId,
  ]);

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
