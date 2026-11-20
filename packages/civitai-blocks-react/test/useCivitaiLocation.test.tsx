import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCivitaiLocation } from '../src/hooks/useCivitaiLocation.js';
import { useCivitaiRoute } from '../src/hooks/useCivitaiRoute.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import { mockParentMessage } from './helpers/mockParentMessage.js';

/**
 * `useCivitaiLocation()` — the current view as `{ subPath, search, hash }`
 * (HQ app_blocks_sdk_j1gc). The first value comes from `BLOCK_INIT.context`; every later
 * one from `ROUTE_CHANGED`, which the host sends on an app navigate AND on the viewer's
 * back/forward. `useCivitaiRoute()` keeps returning the bare `subPath` string.
 */

const ORIGIN = window.location.origin;

function pushRoute(payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(mockParentMessage({ type: 'ROUTE_CHANGED', payload }, ORIGIN));
  });
}

const PAGE = {
  slotId: 'app.page',
  entityType: 'none',
  slug: 'live-characters',
  viewerUserId: null,
} as const;

describe('useCivitaiLocation', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    window.history.replaceState(null, '', '/');
  });

  it('is all empty before BLOCK_INIT lands', () => {
    const { result } = renderHook(() => useCivitaiLocation());
    expect(result.current).toEqual({ subPath: '', search: '', hash: '' });
  });

  it('🔴 returns the search and hash BLOCK_INIT delivered (a deep link)', async () => {
    uninstall = createMockHost({
      context: { ...PAGE, subPath: 'c/42', search: '?take=3', hash: '#top' },
    }).install();
    const { result } = renderHook(() => useCivitaiLocation());
    await waitFor(() => expect(result.current).toEqual({ subPath: 'c/42', search: '?take=3', hash: '#top' }));
  });

  it('an OLD host (no search/hash in the context) reads as empty strings, never undefined', async () => {
    uninstall = createMockHost({ context: { ...PAGE, subPath: 'c/42' } }).install();
    const { result } = renderHook(() => useCivitaiLocation());
    await waitFor(() => expect(result.current).toEqual({ subPath: 'c/42', search: '', hash: '' }));
  });

  it('🔴 follows ROUTE_CHANGED — back from a character to the gallery, and forward again', async () => {
    uninstall = createMockHost({
      context: { ...PAGE, subPath: 'c/42', search: '?take=3', hash: '' },
    }).install();
    const { result } = renderHook(() => useCivitaiLocation());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    pushRoute({ subPath: '', search: '?sort=new', hash: '#grid' });
    expect(result.current).toEqual({ subPath: '', search: '?sort=new', hash: '#grid' });

    pushRoute({ subPath: 'c/42', search: '?take=3', hash: '' });
    expect(result.current).toEqual({ subPath: 'c/42', search: '?take=3', hash: '' });
  });

  it('🔴 a search-only or hash-only ROUTE_CHANGED moves the location (same subPath)', async () => {
    uninstall = createMockHost({ context: { ...PAGE, subPath: 'c/42', search: '?take=1', hash: '' } }).install();
    const { result } = renderHook(() => useCivitaiLocation());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    pushRoute({ subPath: 'c/42', search: '?take=2', hash: '' });
    expect(result.current.search).toBe('?take=2');
    pushRoute({ subPath: 'c/42', search: '?take=2', hash: '#comments' });
    expect(result.current.hash).toBe('#comments');
  });

  it('a ROUTE_CHANGED from an old host (subPath only) moves the subPath and clears nothing it did not send', async () => {
    uninstall = createMockHost({ context: { ...PAGE, subPath: 'c/42' } }).install();
    const { result } = renderHook(() => useCivitaiLocation());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    pushRoute({ subPath: 'c/7' });
    expect(result.current).toEqual({ subPath: 'c/7', search: '', hash: '' });
  });

  it('drops a ROUTE_CHANGED whose search is not a string (host bug), keeping the last good value', async () => {
    uninstall = createMockHost({ context: { ...PAGE, subPath: 'c/42', search: '?take=1', hash: '' } }).install();
    const { result } = renderHook(() => useCivitaiLocation());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    pushRoute({ subPath: 'c/7', search: 42 });
    expect(result.current).toEqual({ subPath: 'c/42', search: '?take=1', hash: '' });
  });

  it('keeps the same object while nothing moved (stable for effect deps)', async () => {
    uninstall = createMockHost({ context: { ...PAGE, subPath: 'c/42', search: '', hash: '' } }).install();
    const { result, rerender } = renderHook(() => useCivitaiLocation());
    await waitFor(() => expect(result.current.subPath).toBe('c/42'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('useCivitaiRoute() still returns the bare subPath string (no breaking change)', async () => {
    uninstall = createMockHost({ context: { ...PAGE, subPath: 'c/42', search: '?take=3', hash: '#x' } }).install();
    const { result } = renderHook(() => useCivitaiRoute());
    await waitFor(() => expect(result.current).toBe('c/42'));
  });
});
