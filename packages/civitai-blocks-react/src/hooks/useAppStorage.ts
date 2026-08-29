import { useMemo } from 'react';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * Public shape of one entry returned by `list()` — `updatedAt` is a real
 * `Date` once the wire's ISO string has been rehydrated.
 */
export interface AppStorageKeyEntry {
  key: string;
  updatedAt: Date;
}

export interface AppStorageListResult {
  keys: AppStorageKeyEntry[];
  /** Opaque, base64-encoded last key — pass back as `cursor` to page forward. */
  nextCursor?: string;
}

export interface AppStorageQuota {
  usedBytes: number;
  rowCount: number;
  /** Host-enforced ceiling (bytes). Surface in UI so callers don't hard-code 50MB. */
  limitBytes: number;
  /** Host-enforced row ceiling (~1M today). */
  limitRows: number;
}

export interface UseAppStorage {
  /**
   * Read a key for the current (block instance, viewer) tuple. Returns
   * `null` when the key isn't set OR the viewer is anonymous. The generic
   * is for caller convenience; the host stores arbitrary JSON.
   */
  get<T = unknown>(key: string): Promise<T | null>;
  /**
   * Upsert a value. Resolves on host ack. Rejects with the host's
   * `error` string when the value exceeds 64KB, when the per-app 50MB
   * quota would be crossed, or when the viewer is anonymous.
   */
  set<T = unknown>(key: string, value: T): Promise<{ ok: true; sizeBytes?: number }>;
  /**
   * Remove a key. Resolves with `{ deleted: true }` when a row was
   * present, `{ deleted: false }` when the key wasn't set (still treated
   * as success — idempotent delete).
   */
  delete(key: string): Promise<{ ok: true; deleted: boolean }>;
  /**
   * Cursor-paginated key listing. Values aren't returned — call `get(key)`
   * for the ones you care about.
   */
  list(opts?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<AppStorageListResult>;
  /**
   * Diagnostic: current usage + the v0 ceilings. Build a "X of 50 MB used"
   * settings widget against this.
   */
  getQuota(): Promise<AppStorageQuota>;
}

/**
 * Per-(block instance, viewer) KV datastore. Calls flow through the host's
 * postMessage bridge — the block never sees the apps DB credentials.
 *
 * Anon viewers get a no-op read path (`get` resolves `null`, `list` returns
 * empty) and a hard reject on writes; the block decides whether to gate
 * its UI on `useBlockContext().viewer`.
 *
 * The hook is stable across renders — it returns the same object identity
 * once the transport singleton is created, so it's safe to put in
 * dependency arrays of `useEffect` / `useMemo`.
 *
 * 64 KB per value, 50 MB + ~1M rows per app.
 *
 * @example
 * const storage = useAppStorage();
 * await storage.set('key', { any: 'json' });   // throws "PAYLOAD_TOO_LARGE" over a limit
 * const v = await storage.get<{ any: string }>('key'); // null if unset / anon
 * await storage.delete('key');                  // idempotent
 * const { keys } = await storage.list({ prefix: 'note-' });
 * const quota = await storage.getQuota();       // { usedBytes, rowCount, limitBytes, limitRows }
 */
export function useAppStorage(): UseAppStorage {
  return useMemo<UseAppStorage>(() => {
    const transport = getTransport();
    return {
      async get<T = unknown>(key: string): Promise<T | null> {
        const result = await sendTypedRequest(
          transport,
          { type: 'APP_STORAGE_GET', payload: { key } },
          'APP_STORAGE_GET_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return (result.value ?? null) as T | null;
      },
      async set<T = unknown>(key: string, value: T) {
        const result = await sendTypedRequest(
          transport,
          { type: 'APP_STORAGE_SET', payload: { key, value } },
          'APP_STORAGE_SET_RESULT',
        );
        // A PRESENT `error` is the reject signal, not a TRUTHY one: the reply
        // validator early-accepts anything carrying an `error` key, so
        // `error: ''` reaches here having skipped the success-field checks.
        // `||` (not `??`) so an empty error string still yields readable copy.
        if (!result.ok || result.error !== undefined) {
          throw new Error(result.error || 'storage set failed');
        }
        return { ok: true as const, sizeBytes: result.sizeBytes };
      },
      async delete(key: string) {
        const result = await sendTypedRequest(
          transport,
          { type: 'APP_STORAGE_DELETE', payload: { key } },
          'APP_STORAGE_DELETE_RESULT',
        );
        // PRESENT, not truthy — see `set()` above.
        if (!result.ok || result.error !== undefined) {
          throw new Error(result.error || 'storage delete failed');
        }
        // `deleted` is optional on the wire type because an error reply omits
        // it. On the success path the validator requires a boolean, so this is
        // defence in depth rather than a reachable branch through the real
        // transport — but it is what makes the `boolean` we return honest,
        // instead of a cast asserting a guarantee this function cannot see.
        if (typeof result.deleted !== 'boolean') {
          throw new Error('storage delete failed: reply carried no `deleted` flag');
        }
        return { ok: true as const, deleted: result.deleted };
      },
      async list(opts) {
        const result = await sendTypedRequest(
          transport,
          {
            type: 'APP_STORAGE_LIST',
            payload: {
              prefix: opts?.prefix,
              limit: opts?.limit,
              cursor: opts?.cursor,
            },
          },
          'APP_STORAGE_LIST_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return {
          keys: result.keys.map((k) => ({
            key: k.key,
            updatedAt: new Date(k.updatedAt),
          })),
          nextCursor: result.nextCursor,
        };
      },
      async getQuota() {
        const result = await sendTypedRequest(
          transport,
          { type: 'APP_STORAGE_QUOTA', payload: {} },
          'APP_STORAGE_QUOTA_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return {
          usedBytes: result.usedBytes,
          rowCount: result.rowCount,
          limitBytes: result.limitBytes,
          limitRows: result.limitRows,
        };
      },
    };
  }, []);
}
