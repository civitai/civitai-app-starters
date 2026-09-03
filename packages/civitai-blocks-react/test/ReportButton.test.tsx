import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportButton } from '../src/ui/ReportButton.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

/** A promise this test resolves/rejects by hand, to inspect the in-flight state. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ReportButton', () => {
  it('does NOT file on the trigger — only from the armed confirm', async () => {
    const onReport = vi.fn(async () => {});
    render(<ReportButton noun="generator" onReport={onReport} />);

    fireEvent.click(screen.getByTestId('report-button'));
    expect(screen.getByTestId('report-confirm-prompt')).toBeTruthy();
    expect(onReport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('report-confirm'));
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('cancel disarms without filing', async () => {
    const onReport = vi.fn(async () => {});
    render(<ReportButton noun="request" onReport={onReport} />);

    fireEvent.click(screen.getByTestId('report-button'));
    fireEvent.click(screen.getByTestId('report-cancel'));

    expect(screen.getByTestId('report-button')).toBeTruthy();
    expect(onReport).not.toHaveBeenCalled();
  });

  // 🔴 THE REASON THIS COMPONENT EXISTS IN THIS PACKAGE AT ALL. `report()` files
  // a row for moderator review and explicitly does NOT hide it, so any of these
  // three strings coming to imply a deletion is the app lying about what the
  // platform did. Three blocks reached for this control independently; promoting
  // it only pays if the copy cannot drift per app.
  //
  // 🔴 ALL THREE are pinned as WHOLE normalised strings, not substrings. An
  // earlier version pinned only the settled line and asserted the failure line
  // by the fragment /could not send/i — an audit then showed BOTH the confirm
  // copy and the failure copy could be replaced with deletion-implying text
  // while the whole suite stayed green.
  describe('the visible copy is pinned whole — no branch may imply a deletion', () => {
    const DELETION = /remov|delet|hidden|hid|gone|erase/i;

    it('the CONFIRM question', () => {
      render(<ReportButton noun="combination" onReport={async () => {}} />);
      fireEvent.click(screen.getByTestId('report-button'));

      const strip = screen.getByTestId('report-confirm-prompt');
      const note = strip.querySelector('span')!;
      expect(note.textContent).toBe('Send this combination to moderators for review?');
      expect(note.textContent).not.toMatch(DELETION);
    });

    it('the FAILURE line', async () => {
      render(
        <ReportButton
          noun="prompt"
          onReport={async () => {
            throw new Error('REPORT_FAILED');
          }}
        />,
      );
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));

      await waitFor(() => {
        const note = screen.getByTestId('report-confirm-prompt').querySelector('span')!;
        expect(note.textContent).toBe('Could not send — try again?');
      });
      const note = screen.getByTestId('report-confirm-prompt').querySelector('span')!;
      expect(note.textContent).not.toMatch(DELETION);
    });

    it('the SETTLED line', async () => {
      render(<ReportButton noun="combination" onReport={async () => {}} />);
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));

      const done = await screen.findByTestId('report-done');
      expect(done.textContent).toBe('Reported for review');
      expect(done.textContent).not.toMatch(DELETION);
      expect(done.getAttribute('role')).toBe('status');
    });
  });

  it('🔴 a REJECTED report stays armed, says so, and ANNOUNCES it', async () => {
    const onReport = vi.fn(async () => {
      throw new Error('REPORT_FAILED');
    });
    render(<ReportButton noun="prompt" onReport={onReport} />);

    fireEvent.click(screen.getByTestId('report-button'));
    fireEvent.click(screen.getByTestId('report-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('report-confirm-prompt').textContent).toMatch(/could not send/i),
    );
    expect(screen.queryByTestId('report-done')).toBeNull();
    // 🔴 Success is announced by the focus move; a rejection reaches a screen
    // reader ONLY through this. Without it the failure is silent to exactly the
    // users the fixed wording exists to protect.
    const note = screen.getByTestId('report-confirm-prompt').querySelector('span')!;
    expect(note.getAttribute('role')).toBe('alert');
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE CONTROL: the settled state IS reachable when the call resolves', async () => {
    // Without this, the rejection case above cannot distinguish "stayed armed
    // because it was refused" from "can never settle at all".
    render(<ReportButton noun="prompt" onReport={async () => {}} />);
    fireEvent.click(screen.getByTestId('report-button'));
    fireEvent.click(screen.getByTestId('report-confirm'));
    expect(await screen.findByTestId('report-done')).toBeTruthy();
  });

  describe('in flight', () => {
    it('🔴 cannot be double-submitted', async () => {
      const d = deferred();
      const onReport = vi.fn(() => d.promise);
      render(<ReportButton noun="prompt" onReport={onReport} />);

      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      // Still in flight — a second and third press must not file again. Two rows
      // filed from one row is the cost, and `report()` is not documented
      // idempotent the way `vote`/`unvote` are.
      fireEvent.click(screen.getByTestId('report-confirm'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      expect(onReport).toHaveBeenCalledTimes(1);

      d.resolve();
      expect(await screen.findByTestId('report-done')).toBeTruthy();
    });

    it('🔴 CANCEL is disabled, so a late resolve cannot settle a cancelled report', async () => {
      const d = deferred();
      render(<ReportButton noun="prompt" onReport={() => d.promise} />);

      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));

      const cancel = screen.getByTestId('report-cancel') as HTMLButtonElement;
      expect(cancel.disabled).toBe(true);
      // The click is inert, so the strip is still mounted when the promise lands
      // and the outcome is the one the viewer actually caused.
      fireEvent.click(cancel);
      expect(screen.getByTestId('report-confirm-prompt')).toBeTruthy();

      d.resolve();
      expect(await screen.findByTestId('report-done')).toBeTruthy();
    });
  });

  describe('focus moves with the control', () => {
    // 🔴 Each step REPLACES the element just activated. Without this a keyboard
    // user is dropped to <body> and must Tab from the top of the document to
    // reach the second half of a two-step confirm.
    it('arming focuses Confirm', async () => {
      render(<ReportButton noun="generator" onReport={async () => {}} />);
      fireEvent.click(screen.getByTestId('report-button'));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('report-confirm')));
    });

    it('settling focuses the outcome, which is what actually announces it', async () => {
      render(<ReportButton noun="generator" onReport={async () => {}} />);
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      const done = await screen.findByTestId('report-done');
      await waitFor(() => expect(document.activeElement).toBe(done));
    });
  });

  describe('server truth', () => {
    it('`reported` renders the settled state with no handshake', () => {
      const onReport = vi.fn(async () => {});
      render(<ReportButton noun="generator" reported onReport={onReport} />);
      expect(screen.getByTestId('report-done').textContent).toBe('Reported for review');
      expect(screen.queryByTestId('report-button')).toBeNull();
      expect(onReport).not.toHaveBeenCalled();
    });

    it('POSITIVE CONTROL: the same props WITHOUT `reported` offer the trigger', () => {
      render(<ReportButton noun="generator" onReport={async () => {}} />);
      expect(screen.getByTestId('report-button')).toBeTruthy();
      expect(screen.queryByTestId('report-done')).toBeNull();
    });
  });

  describe('accessible names and test hooks', () => {
    it('names the row type in both accessible names AND the confirm copy', () => {
      render(<ReportButton noun="generator" onReport={async () => {}} />);
      expect(screen.getByRole('button', { name: 'Report this generator to moderators' })).toBeTruthy();

      fireEvent.click(screen.getByTestId('report-button'));
      expect(
        screen.getByRole('button', { name: 'Confirm reporting this generator to moderators' }),
      ).toBeTruthy();
      // `noun` reaches something VISIBLE, not only the aria-labels — the doc
      // said it did before it was true.
      expect(screen.getByTestId('report-confirm-prompt').textContent).toContain('generator');
    });

    it('🔴 DERIVES every hook from the trigger id, so two rows stay distinct once armed', () => {
      const { rerender } = render(
        <ReportButton noun="generator" onReport={async () => {}} data-testid="row-a-report" />,
      );
      fireEvent.click(screen.getByTestId('row-a-report'));
      // Armed and settled hooks are per-row, not global. Before this, a second
      // row's `report-confirm` resolved the FIRST row's button.
      expect(screen.getByTestId('row-a-report-prompt')).toBeTruthy();
      expect(screen.getByTestId('row-a-report-confirm')).toBeTruthy();
      expect(screen.getByTestId('row-a-report-cancel')).toBeTruthy();
      expect(screen.queryByTestId('report-confirm')).toBeNull();

      rerender(<ReportButton noun="generator" reported onReport={async () => {}} data-testid="row-a-report" />);
      expect(screen.getByTestId('row-a-report-done')).toBeTruthy();
      expect(screen.queryByTestId('report-done')).toBeNull();
    });
  });
});
