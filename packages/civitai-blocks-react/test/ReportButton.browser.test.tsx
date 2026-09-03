import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ReportButton } from '../src/ui/ReportButton.js';

// 🔴 THIS FILE EXISTS BECAUSE THE UNIT TIER CANNOT SEE FOCUSABILITY.
//
// The settled note is a `<span tabIndex={-1}>`, and moving focus to it is what
// the component relies on to announce the outcome — a `role="status"` region
// inserted already carrying its text is not reliably announced on its own.
//
// Measured: deleting that `tabIndex={-1}` leaves the whole happy-dom suite
// GREEN. happy-dom does not implement the focusability rules, so it will happily
// report a plain `<span>` as `document.activeElement`. A real browser will not.
// So the guard for that line has to live here, or it is a guard for nothing —
// and `tabIndex={-1}` on a span is exactly the line a later reader deletes as
// dead code.
//
// Same reason for the in-flight case: `loading` sets the native `disabled`, and
// only a real browser BLURS a focused element when it becomes disabled. That
// blur is what once dropped the viewer to <body> mid-handshake.

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('ReportButton — focus, in a real browser', () => {
  it('🔴 the settled note is genuinely focusable, and receives focus', async () => {
    render(<ReportButton noun="generator" onReport={async () => {}} />);

    fireEvent.click(screen.getByTestId('report-button'));
    fireEvent.click(screen.getByTestId('report-confirm'));

    const done = await screen.findByTestId('report-done');
    await waitFor(() => expect(document.activeElement).toBe(done));
  });

  it('POSITIVE CONTROL: a span without tabindex CANNOT take focus here', () => {
    // Proves the assertion above is a real property of this tier rather than
    // something that would pass on any element — which is exactly what makes it
    // pass in happy-dom.
    render(
      <>
        <button data-testid="anchor">anchor</button>
        <span data-testid="plain">plain</span>
      </>,
    );
    const anchor = screen.getByTestId('anchor') as HTMLButtonElement;
    anchor.focus();
    (screen.getByTestId('plain') as HTMLElement).focus();
    expect(document.activeElement).toBe(anchor);
  });

  it('🔴 in flight there is always a focused, live control — never <body>', async () => {
    const never = new Promise<void>(() => {});
    render(<ReportButton noun="prompt" onReport={() => never} />);

    fireEvent.click(screen.getByTestId('report-button'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('report-confirm')));

    fireEvent.click(screen.getByTestId('report-confirm'));

    // Confirm is now natively disabled and the browser blurs it. Focus must land
    // on Cancel — which stays enabled precisely so this state has a way out —
    // rather than falling to the document body with nothing tabbable.
    const cancel = screen.getByTestId('report-cancel') as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(document.activeElement).not.toBe(document.body);
  });
});
