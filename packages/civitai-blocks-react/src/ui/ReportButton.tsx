import { useEffect, useRef, useState } from 'react';

import { Button } from './Button.js';
import { Group } from './Group.js';

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
 *     reported={item.viewerReported}
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
   * Server truth: this viewer has ALREADY reported this row. Renders the settled
   * state directly and skips the handshake.
   *
   * 🔴 Supply it if your host can tell you. Without it the settled state is
   * local-only, so any remount — a `list()` refresh, a tab switch, virtualized
   * scroll — resets the control to "Report" and the same viewer can file the
   * same row again. `report()` is NOT documented idempotent (unlike `vote`),
   * so that is a duplicate report rather than a no-op.
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
  const doneRef = useRef<HTMLSpanElement>(null);
  const settled = done || reported;

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
  useEffect(() => {
    if (confirming && !busy) confirmRef.current?.focus();
  }, [confirming, busy]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

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
    setBusy(true);
    setFailed(false);
    try {
      await onReport();
      setDone(true);
      setConfirming(false);
    } catch {
      // Stay armed so the viewer can retry.
      setFailed(true);
    } finally {
      setBusy(false);
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
        size="sm"
        variant="subtle"
        // Disabled in flight. Cancel used to stay live while the request ran, so
        // cancelling mid-flight and then having the promise resolve settled the
        // control to "Reported for review" AFTER the viewer backed out — and a
        // rejection instead set `failed` behind an unmounted strip, dropping the
        // error silently.
        disabled={busy}
        onClick={() => {
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
