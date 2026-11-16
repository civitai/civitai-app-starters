import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCivitaiLocation } from '../src/hooks/useCivitaiLocation.js';
import { useCivitaiNavigate } from '../src/hooks/useCivitaiNavigate.js';
import { useShareLink } from '../src/hooks/useShareLink.js';
import { getTransport } from '../src/transport/singleton.js';
import { sendTypedRequest } from '../src/transport/transport.js';
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

  it('🔴 strips the host-owned `sl`, `src` and `from` pairs from the URL, like the page host', async () => {
    uninstall = createMockHost({ context: PAGE }).install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(
      result.current.share({ subPath: 'c/1', search: '?sl=asl_x&take=3&src=detail&from=home' }),
    ).resolves.toMatchObject({ url: 'https://civitai.com/apps/run/live-characters/c/1?take=3' });
  });

  it('🔴 a second share within a second is refused as rate_limited, like the page host', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    uninstall = createMockHost({ context: PAGE }).install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(result.current.share({ subPath: 'c/1' })).resolves.toMatchObject({ copied: true });
    now += 999;
    await expect(result.current.share({ subPath: 'c/2' })).rejects.toThrow(/^rate_limited$/);
    now += 1;
    await expect(result.current.share({ subPath: 'c/3' })).resolves.toMatchObject({ copied: true });
  });

  it('🔴 refuses on a model slot with "unsupported on this host" (page hosts only)', async () => {
    uninstall = createMockHost({
      context: {
        slotId: 'model.sidebar_top',
        modelId: 11,
        modelVersionId: 22,
        modelName: 'Fixture model',
        modelType: 'Checkpoint',
        modelNsfwLevel: 1,
      },
    }).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    // Straight to the transport: the hook refuses a context without `search` before sending,
    // so this is the only way to reach the mock's own refusal.
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'SHARE_LINK', payload: { subPath: '' } },
      'SHARE_LINK_RESULT',
    );
    expect(reply).toEqual({ requestId: expect.any(String), error: 'unsupported on this host' });
  });

  it('the default mock context is a page that knows SHARE_LINK (share() is not refused)', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useShareLink());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await expect(result.current.share()).resolves.toEqual({
      url: 'https://civitai.com/apps/run/mock-app',
      copied: true,
      method: 'clipboard',
    });
  });

  it.each([
    ['copied:false with method clipboard', { copied: false, method: 'clipboard' as const }],
    ['copied:true with method share', { copied: true, method: 'share' as const }],
    ['copied:true with method none', { copied: true, method: 'none' as const }],
  ])('rejects the impossible option shape %s at createMockHost', (_label, shareLink) => {
    expect(() => createMockHost({ context: PAGE, shareLink })).toThrow(/shareLink/);
  });

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
