import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCivitaiLocation } from '../src/hooks/useCivitaiLocation.js';
import { useCivitaiNavigate } from '../src/hooks/useCivitaiNavigate.js';
import { useShareLink } from '../src/hooks/useShareLink.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The mock host's half of HQ app_blocks_sdk_j1gc: SHARE_LINK answers like the page host
 * (a canonical `https://civitai.com/apps/run/<slug>/…` URL built from the CONTEXT slug,
 * escapes refused), and an app-scoped NAVIGATE moves the mock's route and pushes
 * ROUTE_CHANGED with search and hash, so `useCivitaiLocation` can be exercised end to end.
 */

const ORIGIN = window.location.origin;
const PAGE = {
  slotId: 'app.page',
  entityType: 'none',
  slug: 'live-characters',
  subPath: 'c/42',
  search: '?take=3',
  hash: '',
  viewerUserId: null,
} as const;

describe('createMockHost — SHARE_LINK', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  it('answers with the canonical URL for the current view, copied via the clipboard', async () => {
    uninstall = createMockHost({ context: PAGE }).install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(result.current.share()).resolves.toEqual({
      url: 'https://civitai.com/apps/run/live-characters/c/42?take=3',
      copied: true,
      method: 'clipboard',
    });
  });

  it('builds the app root as the bare run URL', async () => {
    uninstall = createMockHost({ context: PAGE }).install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(result.current.share({ subPath: '' })).resolves.toMatchObject({
      url: 'https://civitai.com/apps/run/live-characters',
    });
  });

  it('`shareLink: { copied: false }` simulates a refused clipboard (method none)', async () => {
    uninstall = createMockHost({ context: PAGE, shareLink: { copied: false } }).install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(result.current.share({ subPath: 'c/1' })).resolves.toEqual({
      url: 'https://civitai.com/apps/run/live-characters/c/1',
      copied: false,
      method: 'none',
    });
  });

  it('`shareLink: { method: "share" }` simulates a phone share sheet', async () => {
    uninstall = createMockHost({ context: PAGE, shareLink: { method: 'share' } }).install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(result.current.share({ subPath: 'c/1' })).resolves.toMatchObject({
      copied: false,
      method: 'share',
    });
  });

  it.each([['../other-app'], ['//evil.com'], ['javascript:alert(1)'], ['c/../../x']])(
    'refuses an escaping subPath %s like the page host',
    async (subPath) => {
      uninstall = createMockHost({ context: PAGE }).install();
      const { result } = renderHook(() => useShareLink());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      await expect(result.current.share({ subPath })).rejects.toThrow(/^invalid share link$/);
    },
  );

  it('`shareLinkError` forces the error variant', async () => {
    uninstall = createMockHost({ context: PAGE, shareLinkError: 'rate_limited' }).install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(result.current.share()).rejects.toThrow(/^rate_limited$/);
  });
});

describe('createMockHost — app NAVIGATE follows the route', () => {
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

  it('🔴 navigate("c/7?take=2#x") pushes ROUTE_CHANGED with the split subPath, search and hash', async () => {
    uninstall = createMockHost({ context: PAGE }).install();
    const { result } = renderHook(() => ({ loc: useCivitaiLocation(), nav: useCivitaiNavigate() }));
    await waitFor(() => expect(result.current.loc.subPath).toBe('c/42'));

    act(() => result.current.nav.navigate('c/7?take=2#x'));
    await waitFor(() => expect(result.current.loc).toEqual({ subPath: 'c/7', search: '?take=2', hash: '#x' }));

    act(() => result.current.nav.navigate('', { replace: true }));
    await waitFor(() => expect(result.current.loc).toEqual({ subPath: '', search: '', hash: '' }));
  });

  it('site scope and new_tab do not move the app route', async () => {
    uninstall = createMockHost({ context: PAGE }).install();
    const { result } = renderHook(() => ({ loc: useCivitaiLocation(), nav: useCivitaiNavigate() }));
    await waitFor(() => expect(result.current.loc.subPath).toBe('c/42'));
    act(() => result.current.nav.navigate('models/1', { scope: 'site' }));
    act(() => result.current.nav.navigate('c/9', { target: 'new_tab' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.loc.subPath).toBe('c/42');
    // Control in the same mount: an app navigate does move it, so the mock is live.
    act(() => result.current.nav.navigate('c/8'));
    await waitFor(() => expect(result.current.loc.subPath).toBe('c/8'));
  });
});
