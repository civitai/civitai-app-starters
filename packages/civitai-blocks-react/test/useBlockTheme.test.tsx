import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useBlockContext } from '../src/hooks/useBlockContext.js';
import { useBlockTheme } from '../src/hooks/useBlockTheme.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, mockParentMessage, resetTransport } from '../src/testing.js';

/**
 * `useBlockTheme` end-to-end against the REAL SDK transport.
 *
 * The value it reads has three writers, in increasing authority: the URL
 * fragment fast path, `BLOCK_INIT`, and the host's `THEME_CHANGE` push. Only the
 * third can move it AFTER mount — `BLOCK_INIT` is deduped by the transport and
 * the host freezes the URL fragment at mount — which is the entire reason this
 * message exists. These tests drive the push through the real origin allowlist +
 * payload validator, not a stubbed store.
 */
const ORIGIN = window.location.origin;

function pushTheme(theme: string, origin: string = ORIGIN) {
  window.dispatchEvent(mockParentMessage({ type: 'THEME_CHANGE', payload: { theme } }, origin));
}

describe('useBlockTheme', () => {
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

  it('returns the pre-init sentinel before BLOCK_INIT lands', () => {
    const { result } = renderHook(() => useBlockTheme());
    expect(result.current).toBe('light');
  });

  it('returns the theme BLOCK_INIT delivered', async () => {
    uninstall = createMockHost({ theme: 'dark' }).install();
    const { result } = renderHook(() => useBlockTheme());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current).toBe('dark');
  });

  it('RE-RENDERS with the new theme when the host pushes THEME_CHANGE', async () => {
    uninstall = createMockHost({ theme: 'dark' }).install();
    const { result } = renderHook(() => useBlockTheme());
    await waitFor(() => expect(result.current).toBe('dark'));

    pushTheme('light');
    await waitFor(() => expect(result.current).toBe('light'));

    // and back again — not a one-shot latch.
    pushTheme('dark');
    await waitFor(() => expect(result.current).toBe('dark'));
  });

  it('the mock host `setTheme` control drives the same push (dev-harness fidelity)', async () => {
    const host = createMockHost({ theme: 'dark' });
    uninstall = host.install();
    const { result } = renderHook(() => useBlockTheme());
    await waitFor(() => expect(result.current).toBe('dark'));

    host.setTheme('light');
    await waitFor(() => expect(result.current).toBe('light'));
  });

  it('useBlockContext().theme tracks the SAME push (one snapshot, two readers)', async () => {
    uninstall = createMockHost({ theme: 'dark' }).install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.theme).toBe('dark');

    pushTheme('light');
    await waitFor(() => expect(result.current.theme).toBe('light'));
    // The push must not disturb anything else on the snapshot.
    expect(result.current.ready).toBe(true);
    expect(result.current.viewer?.id).toBe(2);
  });

  it('ignores a malformed push — the last GOOD theme survives', async () => {
    uninstall = createMockHost({ theme: 'dark' }).install();
    const { result } = renderHook(() => useBlockTheme());
    await waitFor(() => expect(result.current).toBe('dark'));

    pushTheme('midnight');
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe('dark');
  });

  it('ignores a push from a DISALLOWED origin', async () => {
    uninstall = createMockHost({ theme: 'dark' }).install();
    const { result } = renderHook(() => useBlockTheme());
    await waitFor(() => expect(result.current).toBe('dark'));

    pushTheme('light', 'https://evil.example.com');
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe('dark');
  });

  it('OLD HOST: a host that never pushes leaves the init theme in place (no hang)', async () => {
    // Nothing awaits THEME_CHANGE, so a host that predates it is simply a host
    // whose theme never moves — today's behaviour, no timeout to hit.
    uninstall = createMockHost({ theme: 'light' }).install();
    const { result } = renderHook(() => useBlockTheme());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe('light');
  });
});
