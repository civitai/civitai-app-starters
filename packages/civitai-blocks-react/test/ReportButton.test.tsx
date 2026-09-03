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

    it('the ACCESSIBLE NAMES too — for a screen-reader user the name IS the wording', () => {
      // The visible notes were swept from the start; the three aria-labels were
      // not, so "Cancel the report" -> "Delete this row" passed a green suite.
      render(<ReportButton noun="prompt" onReport={async () => {}} />);
      expect(screen.getByTestId('report-button').getAttribute('aria-label')).not.toMatch(DELETION);

      fireEvent.click(screen.getByTestId('report-button'));
      for (const id of ['report-confirm', 'report-cancel']) {
        expect(screen.getByTestId(id).getAttribute('aria-label')).not.toMatch(DELETION);
      }
      // 🔴 Pinned WHOLE, like the visible copy. The keyword sweep above is the
      // weaker half and the Cancel name is the one it solely owns: an audit
      // showed "Take this row down permanently" — deletion-implying with no
      // keyword — passing a green suite. The other two names are already pinned
      // whole by the getByRole({ name }) queries below.
      expect(screen.getByTestId('report-cancel').getAttribute('aria-label')).toBe('Cancel the report');
    });

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

  it('the alert role is ABSENT before a failure — presence alone is half a guard', () => {
    render(<ReportButton noun="prompt" onReport={async () => {}} />);
    fireEvent.click(screen.getByTestId('report-button'));
    const note = screen.getByTestId('report-confirm-prompt').querySelector('span')!;
    expect(note.getAttribute('role')).toBeNull();
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

    // 🔴 REPOINTED, not deleted. This case used to assert that Cancel was
    // DISABLED in flight. That was the fix for a late-resolve race, and an audit
    // showed it bought that by removing the only escape from a far more likely
    // one: `onReport` is a postMessage round-trip with no timeout, so a reply
    // that never arrives left both buttons disabled and the control wedged
    // permanently. The race is now closed by `abandonedRef` instead, which
    // costs no escape hatch — so what this case pins is the opposite: Cancel
    // stays live, and the late settle is what must be inert.
    it('🔴 CANCEL stays live in flight, and the late settle is inert instead', async () => {
      const d = deferred();
      render(<ReportButton noun="prompt" onReport={() => d.promise} />);

      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));

      const cancel = screen.getByTestId('report-cancel') as HTMLButtonElement;
      expect(cancel.disabled).toBe(false);
      fireEvent.click(cancel);
      expect(await screen.findByTestId('report-button')).toBeTruthy();

      d.resolve();
      await Promise.resolve();
      await waitFor(() => expect(screen.getByTestId('report-button')).toBeTruthy());
      expect(screen.queryByTestId('report-done')).toBeNull();
    });
  });

  describe('in flight, the viewer can always get out', () => {
    it('🔴 CANCEL stays enabled, so a never-settling report cannot wedge the control', async () => {
      // `onReport` here is a postMessage round-trip with no timeout. A reply that
      // never arrives must not leave both buttons disabled and no way back.
      const never = new Promise<void>(() => {});
      render(<ReportButton noun="prompt" onReport={() => never} />);

      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));

      const cancel = screen.getByTestId('report-cancel') as HTMLButtonElement;
      expect(cancel.disabled).toBe(false);
      fireEvent.click(cancel);
      // Back to the start, with the request still outstanding.
      expect(await screen.findByTestId('report-button')).toBeTruthy();
    });

    it('🔴 a late RESOLVE after Cancel does not settle the control', async () => {
      const d = deferred();
      render(<ReportButton noun="prompt" onReport={() => d.promise} />);
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      fireEvent.click(screen.getByTestId('report-cancel'));

      d.resolve();
      await Promise.resolve();
      await waitFor(() => expect(screen.getByTestId('report-button')).toBeTruthy());
      // Settling here would claim a report the viewer withdrew from.
      expect(screen.queryByTestId('report-done')).toBeNull();
    });

    it('🔴 a late REJECT after Cancel does not resurrect the failure strip', async () => {
      const d = deferred();
      render(<ReportButton noun="prompt" onReport={() => d.promise} />);
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      fireEvent.click(screen.getByTestId('report-cancel'));

      d.reject(new Error('late'));
      await Promise.resolve();
      await waitFor(() => expect(screen.getByTestId('report-button')).toBeTruthy());
      expect(screen.queryByTestId('report-confirm-prompt')).toBeNull();
    });
  });

  describe('one attempt cannot settle another', () => {
    // 🔴 These are the states a single "abandoned" boolean could not express.
    // Measured on that version: the first request settled the control after the
    // viewer had withdrawn from it, and cleared the shared `busy` so Confirm
    // re-enabled while a second was still in flight — three files for one row.

    it('🔴 a SUPERSEDED resolve does not settle the control', async () => {
      const p1 = deferred();
      const p2 = deferred();
      let n = 0;
      const onReport = vi.fn(() => (++n === 1 ? p1.promise : p2.promise));
      render(<ReportButton noun="prompt" onReport={onReport} />);

      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));   // attempt 1
      fireEvent.click(screen.getByTestId('report-cancel'));    // withdrawn
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));   // attempt 2, in flight

      p1.resolve();
      // 🔴 A MACROTASK. Two microtask flushes are not enough for React to
      // COMMIT, so both assertions below would read the pre-settle DOM and pass
      // no matter what the code did — measured: with the source reverted to the
      // broken version this test names, it still passed. Its sibling on the
      // reject side had the same defect and was fixed; this one was missed,
      // which left the headline case of that round with no working guard.
      await new Promise((r) => setTimeout(r, 0));
      // Attempt 1 was withdrawn; settling on it would report an action the
      // viewer backed out of, while a newer one is still outstanding.
      expect(screen.queryByTestId('report-done')).toBeNull();
      expect(screen.getByTestId('report-confirm-prompt')).toBeTruthy();
    });

    it('🔴 a SUPERSEDED reject cannot re-enable Confirm and let the row be filed again', async () => {
      const p1 = deferred();
      const p2 = deferred();
      let n = 0;
      const onReport = vi.fn(() => (++n === 1 ? p1.promise : p2.promise));
      render(<ReportButton noun="prompt" onReport={onReport} />);

      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      fireEvent.click(screen.getByTestId('report-cancel'));
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));   // attempt 2 in flight

      p1.reject(new Error('stale'));
      // 🔴 A MACROTASK, not two microtasks. With only microtask flushes React had
      // not re-rendered yet, so `disabled` still read `true` from attempt 2 and
      // the assertion passed no matter what — a mutant clearing the shared
      // `busy` in `finally` SURVIVED. The flush is what makes this observe
      // anything.
      await new Promise((r) => setTimeout(r, 0));

      // Attempt 2 is still running, so Confirm must stay inert and no failure
      // may be shown for the abandoned attempt.
      expect((screen.getByTestId('report-confirm') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId('report-confirm-prompt').textContent).not.toMatch(/could not send/i);
      fireEvent.click(screen.getByTestId('report-confirm'));
      expect(onReport).toHaveBeenCalledTimes(2);
    });

    it('🔴 a stale rejection does not surface when the viewer re-arms', async () => {
      // The behaviour the catch-side guard really prevents. The previous test
      // for it asserted the strip was absent — but the strip is unmounted by
      // `confirming` regardless, so it could not observe the guard at all.
      const d = deferred();
      render(<ReportButton noun="prompt" onReport={() => d.promise} />);
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      fireEvent.click(screen.getByTestId('report-cancel'));

      d.reject(new Error('stale'));
      await Promise.resolve();
      await Promise.resolve();

      fireEvent.click(screen.getByTestId('report-button'));
      // The prompt testid is the whole Group (note + both buttons), so read the
      // note itself — its textContent would otherwise carry "ReportCancel".
      expect(
        screen.getByTestId('report-confirm-prompt').querySelector('span')!.textContent,
      ).toBe('Send this prompt to moderators for review?');
    });
  });

  describe('`reported` ends the handshake rather than hiding it', () => {
    it('🔴 clears a failure strip, and un-setting it does not resurrect one', async () => {
      const onReport = async () => {
        throw new Error('nope');
      };
      const { rerender } = render(<ReportButton noun="prompt" onReport={onReport} />);
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      await waitFor(() => expect(screen.getByTestId('report-confirm-prompt')).toBeTruthy());

      rerender(<ReportButton noun="prompt" reported onReport={onReport} />);
      expect(screen.getByTestId('report-done')).toBeTruthy();

      // Server truth withdrawn: the viewer must land back at the trigger, not on
      // a stale "Could not send" for a control they saw settle.
      rerender(<ReportButton noun="prompt" onReport={onReport} />);
      expect(screen.getByTestId('report-button')).toBeTruthy();
      expect(screen.queryByTestId('report-confirm-prompt')).toBeNull();
    });

    it('🔴 a rejection arriving AFTER the parent settles us is discarded', async () => {
      // Measured on the previous version: the effect cleared `confirming`/`failed`
      // but left the in-flight attempt live, so its rejection set `failed` behind
      // the settled note — and withdrawing `reported` then surfaced "Could not
      // send" for a report that was never submitted.
      const d = deferred();
      const props = { noun: 'prompt' as const, onReport: () => d.promise };
      const { rerender } = render(<ReportButton {...props} />);
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));

      rerender(<ReportButton {...props} reported />);
      expect(screen.getByTestId('report-done')).toBeTruthy();

      d.reject(new Error('late'));
      await Promise.resolve();
      await Promise.resolve();

      rerender(<ReportButton {...props} />);
      fireEvent.click(screen.getByTestId('report-button'));
      // The prompt testid is the whole Group (note + both buttons), so read the
      // note itself — its textContent would otherwise carry "ReportCancel".
      expect(
        screen.getByTestId('report-confirm-prompt').querySelector('span')!.textContent,
      ).toBe('Send this prompt to moderators for review?');
    });
  });

  it('🔴 a withdrawn `reported` leaves Confirm USABLE, not stuck spinning', async () => {
    // 🔴 The `reported` effect's `setBusy(false)` is load-bearing and had zero
    // coverage on either tier. Without it: an attempt is in flight, the parent
    // settles the control, the parent then withdraws that — and the superseded
    // attempt's `finally` will never clear the SHARED `busy`, so Confirm renders
    // permanently disabled with a spinner and only Cancel gets the viewer out.
    // That is the wedge class this component's comments exist to prevent.
    const d = deferred();
    const props = { noun: 'prompt' as const, onReport: () => d.promise };
    const { rerender } = render(<ReportButton {...props} />);
    fireEvent.click(screen.getByTestId('report-button'));
    fireEvent.click(screen.getByTestId('report-confirm'));

    rerender(<ReportButton {...props} reported />);
    rerender(<ReportButton {...props} />);
    fireEvent.click(screen.getByTestId('report-button'));

    expect((screen.getByTestId('report-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('🔴 the theme tokens are injected even when it mounts straight into the settled branch', () => {
    // That branch renders a bare <span> — no Button, no Group — so nothing else
    // injects the stylesheet for it. Deleting the `useBlocksStyles()` call
    // survived BOTH tiers before this.
    render(<ReportButton noun="prompt" reported onReport={async () => {}} />);
    expect(document.querySelector('style[data-civitai-blocks-ui]')).not.toBeNull();
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

    it('🔴 a REJECTION does not yank focus back to Confirm', async () => {
      // The effect used to key on `busy` as well, so finishing a request re-fired
      // it and stole focus from wherever the viewer had moved.
      const d = deferred();
      render(
        <>
          <button data-testid="elsewhere">elsewhere</button>
          <ReportButton noun="prompt" onReport={() => d.promise} />
        </>,
      );
      fireEvent.click(screen.getByTestId('report-button'));
      fireEvent.click(screen.getByTestId('report-confirm'));
      (screen.getByTestId('elsewhere') as HTMLButtonElement).focus();

      d.reject(new Error('nope'));
      await waitFor(() => expect(screen.getByTestId('report-confirm-prompt').textContent).toMatch(/could not send/i));
      expect(document.activeElement).toBe(screen.getByTestId('elsewhere'));
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
