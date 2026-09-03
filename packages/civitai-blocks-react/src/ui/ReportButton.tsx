import { useState } from 'react';

import { Button } from './Button.js';
import { Group } from './Group.js';

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
 * 🔴 THE SETTLED COPY IS DELIBERATELY NOT OVERRIDABLE. Only {@link ReportButtonProps.noun}
 * varies. Three blocks reached for this control independently and the risk each
 * time was the same one — wording that lets a viewer believe they deleted
 * something. Making the strings a prop would hand that risk back to every
 * consumer and defeat the reason this was promoted out of app code.
 *
 * The caller decides WHO sees it. Render it only for a viewer who is signed in
 * and does not own the row: `report` rejects for an anonymous viewer, and an
 * author has a real Remove. Offering it otherwise is offering an error.
 *
 * @example
 * {!isOwn && viewerId != null && (
 *   <ReportButton noun="generator" onReport={() => shared.report(item.key)} />
 * )}
 */
export interface ReportButtonProps {
  /**
   * What the row is, lower-case and singular — "combination", "prompt",
   * "generator", "request". Used in the accessible names and the confirm copy.
   */
  noun: string;
  /**
   * Files the report. Fires ONLY after the viewer confirms. Reject to surface
   * the failure — a rejected report keeps the control armed rather than
   * settling, because one that closed quietly would read as filed.
   */
  onReport: () => Promise<void>;
  'data-testid'?: string;
}

export function ReportButton({
  noun,
  onReport,
  'data-testid': testId,
}: ReportButtonProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  // Settled. Inert, and deliberately NOT phrased as a removal — the row is
  // still on the board and stays there unless a moderator acts.
  if (done) {
    return (
      <span
        data-testid="report-done"
        role="status"
        style={{
          whiteSpace: 'nowrap',
          fontSize: 12,
          lineHeight: 1.45,
          color: 'var(--civitai-color-text-dimmed)',
        }}
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
        onClick={() => {
          setFailed(false);
          setConfirming(true);
        }}
        data-testid={testId ?? 'report-button'}
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
    <Group gap={6} align="center" wrap={false} data-testid="report-confirm-prompt">
      <span
        style={{
          whiteSpace: 'nowrap',
          fontSize: 12,
          lineHeight: 1.45,
          color: 'var(--civitai-color-text-dimmed)',
        }}
      >
        {failed ? 'Could not send — try again?' : 'Send to moderators for review?'}
      </span>
      <Button
        size="sm"
        loading={busy}
        onClick={confirm}
        data-testid="report-confirm"
        aria-label={`Confirm reporting this ${noun} to moderators`}
      >
        Report
      </Button>
      <Button
        size="sm"
        variant="subtle"
        onClick={() => {
          setFailed(false);
          setConfirming(false);
        }}
        data-testid="report-cancel"
        aria-label="Cancel the report"
      >
        Cancel
      </Button>
    </Group>
  );
}
