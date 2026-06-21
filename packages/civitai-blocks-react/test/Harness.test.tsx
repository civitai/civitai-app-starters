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
});
