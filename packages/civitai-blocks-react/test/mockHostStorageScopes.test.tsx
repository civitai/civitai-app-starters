import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BLOCK_SCOPES, classifyAppStorageError } from '@civitai/app-sdk/blocks';

import { useAppStorage } from '../src/hooks/useAppStorage.js';
import { useSharedStorage } from '../src/hooks/useSharedStorage.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import {
  gatedStorageMessages,
  requiredStorageScope,
  storageScopeDeniedMessage,
} from '../src/internal/mockHostScopes.js';

const ORIGIN = window.location.origin;

/**
 * The dev host's STORAGE SCOPE GATE.
 *
 * THE DEFECT THESE PIN (2026-10-01). An app shipped `useAppStorage()` for every
 * save while its manifest declared only `ai:write:budgeted`. It passed 198 unit
 * tests, the dev harness, `civitai app validate` and a full submit, then failed
 * every save in production with
 * `storage set requires the apps:storage:write scope` — because the mock host
 * served storage unconditionally, so the only storage failure mode that actually
 * ships was the only one it could not produce.
 *
 * 🔴 THE TWO THAT MATTER MOST ARE THE DISCRIMINATING ONES, not the refusals.
 * A gate that refuses everything also "passes" a refusal test. So the load-bearing
 * cases here are:
 *   - read declared does NOT buy write (it checks the SPECIFIC scope);
 *   - app-storage scopes do NOT unlock SHARED storage (two separate stores);
 *   - and declaring the scope lets the op THROUGH (the gate is reachable, not a
 *     blanket deny).
 * Delete the gate and the refusals fail; make the gate blanket-deny and the
 * reachability cases fail. Both directions are covered on purpose.
 */
describe('createMockHost — storage scope gate', () => {
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

  async function ready() {
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  it('refuses a WRITE when no scope is declared, naming the scope — the measured production case', async () => {
    uninstall = createMockHost({ storage: {} }).install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    await expect(result.current.set('k', '1')).rejects.toThrow(/apps:storage:write/);
  });

  it('refuses a READ when no scope is declared, naming the read scope', async () => {
    uninstall = createMockHost({ storage: { seed: { k: '1' } } }).install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    await expect(result.current.get('k')).rejects.toThrow(/apps:storage:read/);
  });

  it('🔴 declaring READ does not buy WRITE — the gate checks the specific scope', async () => {
    uninstall = createMockHost({
      declaredScopes: [BLOCK_SCOPES.APPS_STORAGE_READ],
      storage: { seed: { k: '1' } },
    }).install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    // the declared half works…
    await expect(result.current.get('k')).resolves.toBe('1');
    // …and the undeclared half does not.
    await expect(result.current.set('k', '2')).rejects.toThrow(/apps:storage:write/);
  });

  it('lets the op through once the scope IS declared — the gate is reachable, not a blanket deny', async () => {
    uninstall = createMockHost({
      declaredScopes: [BLOCK_SCOPES.APPS_STORAGE_READ, BLOCK_SCOPES.APPS_STORAGE_WRITE],
      storage: {},
    }).install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    const res = await result.current.set('k', { a: 1 });
    expect(res.ok).toBe(true);
    await expect(result.current.get('k')).resolves.toEqual({ a: 1 });
  });

  it('🔴 app-storage scopes do NOT unlock SHARED storage — they are separate stores', async () => {
    uninstall = createMockHost({
      declaredScopes: [BLOCK_SCOPES.APPS_STORAGE_READ, BLOCK_SCOPES.APPS_STORAGE_WRITE],
      shared: {},
    }).install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    await expect(result.current.append({ title: 'x' })).rejects.toThrow(
      /apps:storage:shared:write/,
    );
  });

  it('shared storage works once its own scopes are declared', async () => {
    uninstall = createMockHost({
      declaredScopes: [
        BLOCK_SCOPES.APPS_STORAGE_SHARED_READ,
        BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE,
      ],
      shared: {},
    }).install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const { key } = await result.current.append({ title: 'x' });
    expect(key).toBeTruthy();
    const { items } = await result.current.list();
    expect(items.map((i) => i.value.title)).toEqual(['x']);
  });

  it('the refusal classifies as null, exactly as the real host authorization failure does', async () => {
    uninstall = createMockHost({ storage: {} }).install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    // `appStorageErrors.ts` is explicit that an authorization failure arrives on
    // the same field as a ceiling and classifies `null` — and that "please try
    // again" is therefore the WRONG copy for it. A dev host that classified this
    // as a known ceiling would teach an app to retry a manifest defect forever.
    const err = await result.current.set('k', '1').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(classifyAppStorageError(err)).toBeNull();
  });

  it('refuses BEFORE the backend, so a scenario that would have allowed the op still fails', async () => {
    // quota/caps/row budget all generous; only the scope is missing. Production
    // refuses at the token, before any of that is consulted — so must this.
    uninstall = createMockHost({
      storage: { quotaBytes: 10_000_000, limitRows: 10_000, valueCapBytes: 1_000_000 },
    }).install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    await expect(result.current.set('k', '1')).rejects.toThrow(/apps:storage:write/);
  });

  describe('the op→scope ledger', () => {
    /**
     * Asserted WHOLE, and failing when the set GROWS as well as when it shrinks:
     * a storage message added to the protocol without a scope row is ungated, and
     * ungated is the state this whole gate exists to end. A reviewer adding
     * `APP_STORAGE_PATCH` should have to come here and decide.
     */
    it('governs exactly these messages', () => {
      expect(gatedStorageMessages()).toEqual([
        'APP_STORAGE_DELETE',
        'APP_STORAGE_GET',
        'APP_STORAGE_LIST',
        'APP_STORAGE_QUOTA',
        'APP_STORAGE_SET',
        'SHARED_APPEND',
        'SHARED_GET',
        'SHARED_GET_COUNT',
        'SHARED_GET_COUNTS',
        'SHARED_LIST',
        'SHARED_REPORT',
        'SHARED_UNVOTE',
        'SHARED_UPDATE',
        'SHARED_VOTE',
        'SHARED_WITHDRAW',
      ]);
    });

    it('maps reads to :read and writes to :write, per store', () => {
      expect(requiredStorageScope('APP_STORAGE_GET')).toBe(BLOCK_SCOPES.APPS_STORAGE_READ);
      expect(requiredStorageScope('APP_STORAGE_SET')).toBe(BLOCK_SCOPES.APPS_STORAGE_WRITE);
      expect(requiredStorageScope('SHARED_LIST')).toBe(BLOCK_SCOPES.APPS_STORAGE_SHARED_READ);
      expect(requiredStorageScope('SHARED_APPEND')).toBe(
        BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE,
      );
    });

    it('governs nothing outside storage — the money path keeps its own flag', () => {
      for (const t of ['SUBMIT_WORKFLOW', 'GET_BUZZ_BALANCE', 'REQUEST_TOKEN', 'OPEN_PICKER']) {
        expect(requiredStorageScope(t)).toBeNull();
      }
    });

    it('names the operation the way the server does, so a log grep finds both', () => {
      // The server said: "storage set requires the apps:storage:write scope".
      expect(
        storageScopeDeniedMessage('APP_STORAGE_SET', BLOCK_SCOPES.APPS_STORAGE_WRITE),
      ).toBe('storage set requires the apps:storage:write scope');
    });
  });
});
