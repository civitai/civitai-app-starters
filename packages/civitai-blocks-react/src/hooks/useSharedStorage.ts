import { useMemo } from 'react';

import type { SharedStorageValue } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * The value a viewer contributes to the SHARED store: a required `title`, an
 * optional long-form `body`, and an optional opaque app-owned `data` blob.
 * `title`/`body` are the MODERATED, user-visible TEXT; `data` is UNMODERATED
 * structured app state (keep all user-visible text in title/body). Re-exported
 * from the app-sdk contract so block authors get one canonical shape.
 */
export type SharedAppendValue = SharedStorageValue;

/**
 * Public shape of one SHARED entry returned by `list()`. `createdAt`/`updatedAt`
 * are real `Date`s once the wire's ISO strings are rehydrated (mirrors
 * `AppStorageKeyEntry.updatedAt`). `count` is the live vote total;
 * `authorUserId` is the contributing viewer.
 */
export interface SharedListItem {
  key: string;
  authorUserId: number;
  value: SharedAppendValue;
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SharedListResult {
  items: SharedListItem[];
  /** Opaque cursor — pass back as `cursor` to page forward. Absent on the last page. */
  nextCursor?: string;
}

export interface UseSharedStorage {
  /**
   * Cursor-paginated listing of the app's SHARED entries (newest-first). Each
   * item carries its `value`, `authorUserId`, and current vote `count`.
   */
  list(opts?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<SharedListResult>;
  /** Current vote total for a single entry (`0` when the key isn't present). */
  getCount(key: string): Promise<number>;
  /**
   * Vote totals for many entries in one round-trip. Returns a map of key →
   * count; keys that aren't present resolve to `0`.
   */
  getCounts(keys: string[]): Promise<Record<string, number>>;
  /**
   * Append a new entry on behalf of the viewer. Accepts the generic
   * `{ title, body?, data? }` value — `data` is an optional opaque app-owned
   * payload stored alongside the moderated title/body. Resolves with the
   * host-minted `key`. Rejects with the host's `error` string on validation/host
   * failure (or when the viewer is anonymous).
   */
  append(value: SharedAppendValue): Promise<{ key: string }>;
  /**
   * Cast (or re-affirm) this viewer's up-vote on an entry — idempotent, one
   * vote per viewer. Resolves with the entry's vote total AFTER the vote.
   */
  vote(key: string): Promise<number>;
  /**
   * Remove this viewer's up-vote from an entry — idempotent. Resolves with the
   * entry's vote total AFTER the removal.
   */
  unvote(key: string): Promise<number>;
  /**
   * Withdraw the viewer's own entry. Resolves `{ deleted: true }` when a row
   * was removed, `{ deleted: false }` when it was already gone (idempotent).
   */
  withdraw(key: string): Promise<{ ok: boolean; deleted: boolean }>;
}

/**
 * App-scoped, append-only, community-votable SHARED datastore. Sibling of
 * {@link useAppStorage} (the per-viewer KV store) — same postMessage bridge,
 * same request/await/correlate-by-requestId mechanism — but the scope is the
 * APP (every viewer sees the same list) and entries are structured
 * `{ title, body? }` records that any viewer can vote on.
 *
 * Calls flow through the host's postMessage bridge; the block never sees the
 * datastore credentials and never sends its block token (the host injects both
 * the token and the viewer identity). Anonymous viewers get a read path (`list`
 * / `getCount(s)`) and a hard reject on mutations (`append`/`vote`/`unvote`/
 * `withdraw`).
 *
 * The hook is stable across renders — it returns the same object identity once
 * the transport singleton is created, so it's safe in `useEffect`/`useMemo`
 * dependency arrays.
 *
 * @example
 * const shared = useSharedStorage();
 * const { key } = await shared.append({ title: 'Add dark mode', body: '…' });
 * const { items } = await shared.list({ limit: 20 });   // newest-first
 * const count = await shared.vote(key);                 // idempotent up-vote
 * await shared.unvote(key);
 * await shared.withdraw(key);                            // remove my own entry
 */
export function useSharedStorage(): UseSharedStorage {
  return useMemo<UseSharedStorage>(() => {
    const transport = getTransport();
    return {
      async list(opts) {
        const result = await sendTypedRequest(
          transport,
          {
            type: 'SHARED_LIST',
            payload: {
              prefix: opts?.prefix,
              limit: opts?.limit,
              cursor: opts?.cursor,
            },
          },
          'SHARED_LIST_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return {
          items: result.items.map((item) => ({
            key: item.key,
            authorUserId: item.authorUserId,
            value: item.value,
            count: item.count,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
          nextCursor: result.nextCursor,
        };
      },
      async getCount(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_GET_COUNT', payload: { key } },
          'SHARED_GET_COUNT_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return result.count;
      },
      async getCounts(keys) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_GET_COUNTS', payload: { keys } },
          'SHARED_GET_COUNTS_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return result.counts;
      },
      async append(value) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_APPEND', payload: { value } },
          'SHARED_APPEND_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return { key: result.key };
      },
      async vote(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_VOTE', payload: { key } },
          'SHARED_VOTE_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return result.count;
      },
      async unvote(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_UNVOTE', payload: { key } },
          'SHARED_UNVOTE_RESULT',
        );
        if (result.error) throw new Error(result.error);
        return result.count;
      },
      async withdraw(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_WITHDRAW', payload: { key } },
          'SHARED_WITHDRAW_RESULT',
        );
        if (!result.ok || result.error) {
          throw new Error(result.error ?? 'shared withdraw failed');
        }
        return { ok: true as const, deleted: result.deleted };
      },
    };
  }, []);
}
