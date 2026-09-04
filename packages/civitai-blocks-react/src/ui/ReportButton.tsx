import { useEffect, useRef, useState } from 'react';

import { Button } from './Button.js';
import { Group } from './Group.js';
import { useBlocksStyles } from './styles.js';

/** Shared by the two text renders so they cannot drift apart. */
const NOTE_STYLE = {
  whiteSpace: 'nowrap',
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--civitai-color-text-dimmed)',
} as const;

/**
 * The post-write abuse seam for a shared board: a two-step control that files a
 * row for PLATFORM moderator review via `useSharedStorage().report()`.
 *
 * 🔴 REPORTING IS ESCALATION, NOT REMOVAL, and this component exists so that
 * fact is stated identically in every block. `report()` files the row and its
 * own contract says filing does NOT hide it — a moderator decides. An app owner
 * has no server-side hide to offer instead either: `update` and `withdraw` are
 * author-scoped, so they reject for anyone but the row's author.
 *
 * 🔴 THE VISIBLE COPY IS NOT OVERRIDABLE — and that guarantee is exactly one
 * thing, so do not read it as more. What is fixed is the WORDING THIS COMPONENT
 * RENDERS: the confirm question, the failure line and the settled line are each
 * pinned whole by tests, so none of them can come to imply a deletion. It does
 * NOT constrain what {@link ReportButtonProps.onReport} actually does — a
 * consumer can wire a real delete behind it and this control will still settle
 * to "Reported for review" — and it cannot stop a host page restyling the
 * settled text out of view. The honest claim is that the wording cannot drift by
 * accident across blocks, which is what three divergent hand-rolled copies had
 * already produced.
 *
 * The caller decides WHO sees it. Render it only for a viewer who is signed in
 * and does not own the row: `report` rejects for an anonymous viewer, and an
 * author has a real Remove. Offering it otherwise is offering an error.
 *
 * @example
 * // 🔴 Key it by the ROW, not by index — the settled state belongs to the row,
 * // and a list that re-orders under an index key shows a settled report
 * // against a row nobody reported.
 * {!isOwn && viewerId != null && (
 *   <ReportButton
 *     key={item.key}
 *     noun="generator"
 *     reported={myReports.has(item.key)}
 *     onReport={() => shared.report(item.key)}
 *     data-testid={`gen-${item.key}-report`}
 *   />
 * )}
 */
export interface ReportButtonProps {
  /**
   * What the row is, lower-case and singular — "combination", "prompt",
   * "generator", "request". Appears in the confirm question and in both
   * accessible names.
   *
   * 🔴 It is spliced into an `aria-label`, so it is NOT a place for arbitrary
   * text: a sentence here becomes the control's accessible name and can say
   * whatever it likes to exactly the users the fixed wording exists to protect.
   * Pass a bare noun.
   */
  noun: string;
  /**
   * Files the report. Fires ONLY after the viewer confirms. Reject to surface
   * the failure — a rejected report keeps the control armed rather than
   * settling, because one that closed quietly would read as filed.
   */
  onReport: () => Promise<void>;
  /**
   * This viewer has ALREADY reported this row. Renders the settled state
   * directly and skips the handshake.
   *
   * 🔴 THE SHARED STORE CANNOT TELL YOU THIS. `SharedListItem` carries
   * `viewerVoted` and has no report equivalent, so unlike a vote there is no
   * server field to read — the only source is your own app's per-viewer
   * storage, recorded when `onReport` resolves. Supply it if you keep that
   * record: without it the settled state is local-only, so any remount (a
   * `list()` refresh, a tab switch, virtualized scroll) resets the control to
   * "Report" and the same viewer can file the same row again. `report()` is NOT
   * documented idempotent the way `vote` is, so that is a duplicate report
   * rather than a no-op.
   *
   * Flipping this to `true` settles the control silently — no focus move — which
   * is correct for the load-time case it is meant for; stealing focus on mount
   * would be wrong.
   */
  reported?: boolean;
  /**
   * Test hook for the TRIGGER. The other four hooks are DERIVED from it by
   * suffix, so two rows in one list stay distinguishable once armed or settled:
   * `<id>-confirm`, `<id>-cancel`, `<id>-done`, `<id>-prompt`.
   *
   * 🔴 Grep for the SUFFIX, never for the composed value: a composed testid
   * appears nowhere in source as a literal, so a search for `foo-confirm`
   * returns zero whether the selector works or has just been deleted.
   *
   * Omitted, the ids are `report-button`, `report-confirm`, `report-cancel`,
   * `report-done`, `report-confirm-prompt`.
   */
  'data-testid'?: string;
}

export function ReportButton({
  noun,
  onReport,
  reported = false,
  'data-testid': testId,
}: ReportButtonProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  /**
   * Monotonic id of the CURRENT attempt. Every settle compares against it and
   * no-ops if it has moved on.
   *
   * 🔴 A single "abandoned" BOOLEAN is not enough, and the difference is not
   * theoretical — it was measured. A boolean reset at the top of each attempt
   * protects exactly one abandoned request and only until the next confirm, so
   * cancel → re-arm → confirm let the FIRST request settle the control
   * ("Reported for review" for a report the viewer withdrew from, while a second
   * was still in flight) and, on the rejecting path, clear the shared `busy` so
   * Confirm re-enabled mid-flight — three `onReport` calls for one row, against
   * a `report()` that is not idempotent. An id per attempt cannot do that:
   * anything that ends an attempt bumps it, and a superseded settle is inert.
   */
  const attemptRef = useRef(0);
  const settled = done || reported;
  useBlocksStyles();

  const ids = testId
    ? {
        trigger: testId,
        confirm: `${testId}-confirm`,
        cancel: `${testId}-cancel`,
        done: `${testId}-done`,
        prompt: `${testId}-prompt`,
      }
    : {
        trigger: 'report-button',
        confirm: 'report-confirm',
        cancel: 'report-cancel',
        done: 'report-done',
        prompt: 'report-confirm-prompt',
      };

  // 🔴 Move focus with the control, at BOTH transitions. Each step replaces the
  // element the viewer just activated, so without this a keyboard user is
  // dropped to <body> and must Tab from the top of the document to reach the
  // second half of a two-step confirm.
  //
  // Focusing the settled note also does the announcing that `role="status"`
  // alone cannot be relied on for here: that region is INSERTED already
  // carrying its text, and a live region generally has to exist before its
  // content changes to be announced. Moving focus to it is what makes the
  // outcome reach a screen-reader user rather than hoping.
  //
  // 🔴 Keyed on `confirming` ALONE, deliberately. Keying it on `busy` too meant
  // the effect re-fired when a request finished, so a viewer who pressed Confirm
  // and then moved focus elsewhere had it YANKED BACK on rejection. `busy` is a
  // request-lifecycle flag, not a "the control moved" transition.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  // 🔴 Confirm carries `loading`, which sets the native `disabled`, so the
  // browser BLURS it the moment a request starts. Move focus to Cancel — which
  // stays enabled precisely so the in-flight state has a live control — or the
  // viewer is dropped to <body> with nothing tabbable, which is the failure this
  // component's own focus handling exists to prevent.
  useEffect(() => {
    if (busy) cancelRef.current?.focus();
  }, [busy]);
  // 🔴 Server truth ENDS the handshake rather than hiding it. Without this the
  // strip stays mounted underneath: a later `reported: false` resurrected a
  // stale "Could not send" against a control the viewer had seen settle, and a
  // rejection arriving after the flip landed behind an unmounted strip — the
  // same dropped-error state the Cancel handling above exists to prevent.
  useEffect(() => {
    if (reported) {
      // 🔴 Bump the attempt too, or an in-flight request keeps writing into a
      // control that has already settled: measured, a rejection arriving after
      // this flip set `failed` behind the settled note, and withdrawing
      // `reported` then surfaced "Could not send — try again?" for a report that
      // was never submitted.
      //
      // 🔴 Neither `setBusy(false)` nor `setFailed(false)` is redundant here, and
      // each went a full round with NO coverage on either tier before a case was
      // written for it — see "a withdrawn `reported` leaves Confirm USABLE" and
      // "does not leave a stale FAILURE behind either". Both now fail on the
      // unit tier if their line is deleted.
      //
      // What they prevent, and note it surfaces on the NEXT ARM, not on the
      // withdraw itself (this effect has already cleared `confirming`, so the
      // viewer lands on the trigger): the attempt is superseded, so its
      // `finally` never clears the shared `busy` and its rejection never clears
      // `failed`. Re-arm and you get Confirm disabled with a spinner, or "Could
      // not send" for a report never submitted in that attempt. Clearing both
      // here is what ends the attempt completely rather than half-way.
      attemptRef.current += 1;
      setConfirming(false);
      setFailed(false);
      setBusy(false);
    }
  }, [reported]);

  if (settled) {
    return (
      <span
        ref={doneRef}
        tabIndex={-1}
        data-testid={ids.done}
        role="status"
        style={{ ...NOTE_STYLE, outline: 'none' }}
      >
        Reported for review
      </span>
    );
  }

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="subtle"
        onClick={() => setConfirming(true)}
        data-testid={ids.trigger}
        aria-label={`Report this ${noun} to moderators`}
      >
        Report
      </Button>
    );
  }

  const confirm = async () => {
    const attempt = (attemptRef.current += 1);
    /** This attempt is still the one on screen. */
    const current = () => attemptRef.current === attempt;
    setBusy(true);
    setFailed(false);
    try {
      await onReport();
      // 🔴 Superseded — the viewer cancelled, or the parent settled us. (A
      // newer attempt cannot be started without one of those first, since
      // Confirm is natively disabled while busy; the check is depth, not a
      // reachable third case.) Settling here would report an action this viewer
      // withdrew from.
      if (!current()) return;
      setDone(true);
      setConfirming(false);
    } catch {
      // Same on the failure side: a rejection belonging to an abandoned or
      // superseded attempt must not resurrect a strip, nor mark a live attempt
      // failed.
      if (!current()) return;
      setFailed(true);
    } finally {
      // 🔴 Load-bearing, not defensive. A superseded attempt clearing the shared
      // `busy` is what re-enabled Confirm while a newer request was still
      // running, which is how one row got filed three times.
      if (current()) setBusy(false);
    }
  };

  return (
    <Group gap={6} align="center" wrap={false} data-testid={ids.prompt}>
      {/* 🔴 `role="alert"` on the FAILURE text. Success is announced by the
          focus move above; without this a screen-reader user who presses
          Confirm and is REJECTED receives nothing at all — focus still on a
          button whose accessible name has not changed. That is "a failed report
          reads as a filed one", in the accessibility axis. */}
      <span style={NOTE_STYLE} {...(failed ? { role: 'alert' as const } : {})}>
        {failed ? 'Could not send — try again?' : `Send this ${noun} to moderators for review?`}
      </span>
      <Button
        ref={confirmRef}
        size="sm"
        loading={busy}
        onClick={confirm}
        data-testid={ids.confirm}
        aria-label={`Confirm reporting this ${noun} to moderators`}
      >
        Report
      </Button>
      <Button
        ref={cancelRef}
        size="sm"
        variant="subtle"
        // 🔴 DELIBERATELY NOT disabled in flight. It was, briefly, to stop a late
        // resolve settling a cancelled report — but `onReport` here is
        // `shared.report()` over a postMessage bridge with no timeout, so a
        // reply that never arrives left BOTH buttons disabled and the control
        // wedged with no way back short of a remount. Trading a rare race for a
        // permanent dead end is the wrong side of that trade; the attempt token
        // closes the race without taking the escape hatch away.
        onClick={() => {
          attemptRef.current += 1;
          setBusy(false);
          setFailed(false);
          setConfirming(false);
        }}
        data-testid={ids.cancel}
        aria-label="Cancel the report"
      >
        Cancel
      </Button>
    </Group>
  );
}
