import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportButton } from '../src/ui/ReportButton.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

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
  // a row for moderator review and explicitly does NOT hide it, so a settled
  // state reading "Removed" or "Hidden" is the app lying about what the platform
  // did. Three blocks reached for this control independently; promoting it is
  // only worth anything if the copy cannot drift per app, so the strings are not
  // props and this pins the whole normalised string rather than a substring.
  it('🔴 settles as REPORTED — never removed or hidden, and the copy is not a prop', async () => {
    render(<ReportButton noun="combination" onReport={async () => {}} />);

    fireEvent.click(screen.getByTestId('report-button'));
    fireEvent.click(screen.getByTestId('report-confirm'));

    const done = await screen.findByTestId('report-done');
    expect(done.textContent).toBe('Reported for review');
    expect(done.textContent).not.toMatch(/remov|delet|hidden|hid/i);
    // Announced, so a screen-reader user learns the outcome without focus moving.
    expect(done.getAttribute('role')).toBe('status');
  });

  it('🔴 a REJECTED report stays armed and says so — it must not read as filed', async () => {
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

  it('names the row type in both accessible names', async () => {
    render(<ReportButton noun="generator" onReport={async () => {}} />);
    expect(screen.getByRole('button', { name: 'Report this generator to moderators' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-button'));
    expect(
      screen.getByRole('button', { name: 'Confirm reporting this generator to moderators' }),
    ).toBeTruthy();
  });

  it('honours a caller-supplied trigger testid, so two rows can be told apart', async () => {
    render(<ReportButton noun="generator" onReport={async () => {}} data-testid="gen-report" />);
    expect(screen.getByTestId('gen-report')).toBeTruthy();
  });
});
