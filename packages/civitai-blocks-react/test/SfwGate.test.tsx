import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrowsingLevel } from '@civitai/app-sdk/blocks';

import { SfwGate } from '../src/hooks/SfwGate.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

const ORIGIN = window.location.origin;

describe('<SfwGate>', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it('renders children on a SFW domain', async () => {
    uninstall = createMockHost({ domain: 'green' }).install();
    render(
      <SfwGate fallback={<span>blocked</span>}>
        <span>mature-affordance</span>
      </SfwGate>,
    );
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(screen.getByText('mature-affordance')).toBeTruthy();
    expect(screen.queryByText('blocked')).toBeNull();
  });

  it('renders fallback on a mature (red) domain', async () => {
    uninstall = createMockHost({ domain: 'red' }).install();
    render(
      <SfwGate fallback={<span>blocked</span>}>
        <span>mature-affordance</span>
      </SfwGate>,
    );
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(screen.getByText('blocked')).toBeTruthy();
    expect(screen.queryByText('mature-affordance')).toBeNull();
  });

  it('defaults fallback to null (renders nothing) on a mature domain', async () => {
    uninstall = createMockHost({ maturity: 'mature' }).install();
    const { container } = render(
      <SfwGate>
        <span>mature-affordance</span>
      </SfwGate>,
    );
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(screen.queryByText('mature-affordance')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('fail-closes to SFW before BLOCK_INIT (children render)', () => {
    render(
      <SfwGate fallback={<span>blocked</span>}>
        <span>safe</span>
      </SfwGate>,
    );
    expect(screen.getByText('safe')).toBeTruthy();
    expect(screen.queryByText('blocked')).toBeNull();
  });

  it('level variant: renders children only when the level is allowed', async () => {
    uninstall = createMockHost({ domain: 'red' }).install();
    render(
      <SfwGate level={BrowsingLevel.R} fallback={<span>no-r</span>}>
        <span>r-control</span>
      </SfwGate>,
    );
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(screen.getByText('r-control')).toBeTruthy();
  });

  it('level variant: renders fallback when the level is NOT allowed on a SFW domain', async () => {
    uninstall = createMockHost({ domain: 'green' }).install();
    render(
      <SfwGate level={BrowsingLevel.R} fallback={<span>no-r</span>}>
        <span>r-control</span>
      </SfwGate>,
    );
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(screen.getByText('no-r')).toBeTruthy();
    expect(screen.queryByText('r-control')).toBeNull();
  });
});
