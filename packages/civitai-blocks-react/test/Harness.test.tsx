import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useBlockContext } from '../src/hooks/useBlockContext.js';
import { getTransport } from '../src/internal/singleton.js';
import { Harness, MockHostProvider, resetTransport } from '../src/testing.js';

/**
 * The React `<Harness>` wrapper: installs a mock host on mount, tears it down
 * on unmount, renders children, and (optionally) the on-screen message log.
 * Mirrors the createMockHost end-to-end scaffold.
 */

const ORIGIN = window.location.origin;

function Probe() {
  const { ready, viewer, context } = useBlockContext();
  if (!ready) return <div>loading</div>;
  return (
    <div data-testid="probe">
      {context?.slotId}:{viewer ? viewer.username : 'anon'}
    </div>
  );
}

describe('<Harness>', () => {
  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    // The package's vitest config doesn't enable globals, so RTL's auto-cleanup
    // afterEach hook isn't registered — unmount explicitly to avoid DOM bleed
    // across tests (and to fire each Harness's mock-host teardown).
    cleanup();
    resetTransport();
  });

  it('installs a mock host and delivers BLOCK_INIT to the wrapped block', async () => {
    render(
      <Harness applyUrlToggles={false} viewer={{ id: 9, username: 'dev', status: 'active' }}>
        <Probe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
    expect(screen.getByTestId('probe').textContent).toBe('app.page:dev');
  });

  it('renders the anon path when viewer is null', async () => {
    render(
      <Harness applyUrlToggles={false} viewer={null} showLog={false}>
        <Probe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
    expect(screen.getByTestId('probe').textContent).toBe('app.page:anon');
  });

  it('shows the message-log panel by default and hides it when showLog=false', async () => {
    const { unmount } = render(
      <Harness applyUrlToggles={false}>
        <Probe />
      </Harness>,
    );
    // The summary label is split across text nodes by the `·` separators, so
    // match on the container's textContent rather than a single text node.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/DEV HARNESS · viewer=dev-viewer/),
    );
    unmount();

    // showLog={false} renders no panel.
    render(
      <Harness applyUrlToggles={false} showLog={false}>
        <Probe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/DEV HARNESS/);
  });

  it('MockHostProvider is an alias of Harness', () => {
    expect(MockHostProvider).toBe(Harness);
  });

  /**
   * The consent readout is THREE-state, not a boolean.
   *
   * 🔴 WHY THIS IS A REAL BUG AND NOT CHROME POLISH. `?consent=ungrantable` /
   * `consentGrantable: false` leaves `consentGranted` UNDEFINED, so a boolean
   * badge renders "withheld" — which reads as *"not granted YET, try again"*,
   * the exact message `CONSENT_UNAVAILABLE` exists to replace. A developer
   * exercising the new refusal path would see their block say "unavailable" and
   * the harness chrome say "withheld" ON THE SAME SCREEN, and the harness — the
   * thing they trust to describe the fake host — is the one that is wrong.
   *
   * Read through the `data-harness-consent` ATTRIBUTE and assert EXACT equality,
   * never a substring of body text: `'ungrantable'` is a substring of
   * `'granted+ungrantable'`, so a `toMatch(/ungrantable/)` would pass on the
   * wrong state.
   */
  const consentBadge = (): string | null =>
    document.querySelector('[data-harness-consent]')?.getAttribute('data-harness-consent') ?? null;

  describe('consent badge', () => {
    it('reads "withheld" when the host CAN grant but has not (the default)', async () => {
      render(
        <Harness applyUrlToggles={false}>
          <Probe />
        </Harness>,
      );
      await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
      expect(consentBadge()).toBe('withheld');
    });

    it('reads "granted" when the token already carries the budgeted scope', async () => {
      render(
        <Harness applyUrlToggles={false} consentGranted>
          <Probe />
        </Harness>,
      );
      await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
      expect(consentBadge()).toBe('granted');
    });

    it('reads "ungrantable" — NOT "withheld" — when the host can never grant', async () => {
      render(
        <Harness applyUrlToggles={false} consentGrantable={false}>
          <Probe />
        </Harness>,
      );
      await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
      expect(consentBadge()).toBe('ungrantable');
      // The two-state bug, pinned by name: this must never collapse back.
      expect(consentBadge()).not.toBe('withheld');
    });

    /**
     * The same regression asserted WITHOUT the `data-harness-consent` probe, so
     * the red→green claim does not rest on an attribute this change introduced:
     * at the two-state tip the visible chrome literally reads `consent=withheld`
     * here, and that is the user-visible defect.
     */
    it('never renders the visible string "consent=withheld" on an un-grantable host', async () => {
      render(
        <Harness applyUrlToggles={false} consentGrantable={false}>
          <Probe />
        </Harness>,
      );
      await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
      expect(document.body.textContent).toContain('consent=');
      expect(document.body.textContent).not.toContain('consent=withheld');
    });

    it('reads "granted+ungrantable" when the scope is held but nothing more can be granted', async () => {
      render(
        <Harness applyUrlToggles={false} consentGranted consentGrantable={false}>
          <Probe />
        </Harness>,
      );
      await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
      expect(consentBadge()).toBe('granted+ungrantable');
    });

    it('picks up ?consent=ungrantable from the harness URL', async () => {
      const url = new URL(window.location.href);
      url.search = '?consent=ungrantable';
      window.history.replaceState({}, '', url);
      try {
        render(
          <Harness>
            <Probe />
          </Harness>,
        );
        await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
        expect(consentBadge()).toBe('ungrantable');
      } finally {
        window.history.replaceState({}, '', new URL(window.location.pathname, window.location.href));
      }
    });

    it('still renders the badge label so the readout stays findable', async () => {
      render(
        <Harness applyUrlToggles={false} consentGrantable={false}>
          <Probe />
        </Harness>,
      );
      await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
      expect(document.body.textContent).toMatch(/consent=/);
    });
  });
});
