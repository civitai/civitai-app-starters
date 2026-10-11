import { useMemo } from 'react';

import type { SharedStorageValue, SharedStorageItemWire } from '@civitai/app-sdk/blocks';

import { getTransport } from '../transport/singleton.js';
import { throwOnFailedReply, throwOnReplyError } from '../internal/replyError.js';
import { sendTypedRequest } from '../transport/transport.js';
import { parseSharedStorageRateLimit } from '../transport/validate.js';

/**
 * A shared-storage write the server REFUSED because a per-(viewer, app) budget
 * is empty — thrown by `append`, `update`, `vote`, `unvote`, `withdraw` and
 * `report` when the host's refusal carries retry metadata.
 *
 * It EXTENDS `Error`, the class every other shared-storage refusal is thrown
 * as, so existing `catch` code keeps working unchanged: `.message` is still the
 * host's refusal text (for example `Too many submissions — retry in 312s`).
 * Branch on `instanceof SharedStorageRateLimitError` to render the wait from
 * {@link SharedStorageRateLimitError.retryAt} instead of parsing the message.
 *
 * Not thrown when the refusal carries no metadata — a host that predates it, or
 * a refusal that is not a rate limit. Those stay a plain `Error`.
 */
export class SharedStorageRateLimitError extends Error {
  /** Whole seconds until a retry can succeed, as of when the server refused. At least 1. */
  readonly retryAfterSeconds: number;
  /** ISO-8601 instant at which a retry can succeed. Prefer this for a countdown. */
  readonly retryAt: string;

  constructor(message: string, rateLimit: { retryAfterSeconds: number; retryAt: string }) {
    super(message);
    this.name = 'SharedStorageRateLimitError';
    this.retryAfterSeconds = rateLimit.retryAfterSeconds;
    this.retryAt = rateLimit.retryAt;
  }
}

/**
 * Throw {@link SharedStorageRateLimitError} when a write reply is a refusal (a
 * PRESENT `error`, the same test as `throwOnReplyError`) that carries valid
 * `rateLimit`. Otherwise returns, and the caller's usual reply check throws the
 * plain `Error` as before.
 *
 * Parses `rateLimit` rather than trusting it: the transport delivers it as the
 * host sent it, so a malformed value is ignored here and the caller's plain
 * `Error` is thrown instead.
 */
function throwOnSharedRateLimit(
  result: { error?: string; rateLimit?: unknown },
  fallback: string,
): void {
  if (result.error === undefined) return;
  const rateLimit = parseSharedStorageRateLimit(result.rateLimit);
  if (rateLimit) throw new SharedStorageRateLimitError(result.error || fallback, rateLimit);
}

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
  /**
   * Whether the current viewer has an active up-vote on this entry — hydrate the
   * vote-button state from this on load instead of guessing (fixes the
   * "double-click to unvote" bug). Anonymous viewers are always `false`. Defaults
   * to `false` when talking to an older host that doesn't send it, so a new block
   * on an old host degrades to today's behavior.
   */
  viewerVoted: boolean;
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
  /**
   * Fetch ONE entry by its key — the single-row companion to {@link list} for
   * resolving a `?g=<key>` deep-link to an item past the first page. Resolves
   * with the full {@link SharedListItem} (incl. `count`/`viewerVoted`) or `null`
   * when the key is missing / hidden (a withdrawn or moderated row is never
   * leaked). Respects the same per-viewer visibility as `list`. Rejects with the
   * host's `error` string on host-side failure.
   */
  get(key: string): Promise<SharedListItem | null>;
  /**
   * Report a posted entry for moderator review — the post-write abuse seam for a
   * shared board. `reason` is optional free text. Resolves once the report is
   * filed; rejects with the host's `error` string on failure (`NOT_FOUND` for a
   * missing key, a trust/scope rejection, or when the viewer is anonymous).
   * Filing a report does not hide the row — a moderator decides. Gated by the
   * same `apps:storage:shared:write` trust boundary as {@link append}.
   */
  report(key: string, reason?: string): Promise<void>;
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
   * Update the viewer's OWN entry in place. Author-scoped: the host rejects when
   * the viewer isn't the entry's author (`FORBIDDEN`) or the key is missing/hidden
   * (`NOT_FOUND`). The `key` and the entry's vote/report totals are preserved —
   * only the contributed `{ title, body?, data? }` value changes. `title`/`body`
   * go through the same content belt as {@link append}; `data` is opaque.
   * Resolves once the update lands; rejects with the host's `error` string on
   * failure (or when the viewer is anonymous). Gated by the same
   * `apps:storage:shared:write` scope as `append` — no new scope.
   */
  update(key: string, value: SharedAppendValue): Promise<void>;
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
 * Writes are budgeted per (viewer, app) server-side. A write refused for that
 * reason rejects with {@link SharedStorageRateLimitError} (a subclass of the
 * plain `Error` every other refusal is) carrying `retryAfterSeconds` and
 * `retryAt`, whenever the host sends the metadata.
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
/**
 * Rehydrate one wire item (ISO date strings) into a public {@link SharedListItem}
 * (`Date`s). `viewerVoted` defaults to `false` when a host predating the field
 * omits it, so a new block on an old host degrades to today's behavior. Shared by
 * {@link UseSharedStorage.list} and {@link UseSharedStorage.get} so the two stay
 * in lockstep.
 */
function rehydrateSharedItem(item: SharedStorageItemWire): SharedListItem {
  return {
    key: item.key,
    authorUserId: item.authorUserId,
    value: item.value,
    count: item.count,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    viewerVoted: item.viewerVoted ?? false,
  };
}

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
        throwOnReplyError(result, 'shared list failed');
        return {
          items: result.items.map(rehydrateSharedItem),
          nextCursor: result.nextCursor,
        };
      },
      async get(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_GET', payload: { key } },
          'SHARED_GET_RESULT',
        );
        throwOnReplyError(result, 'shared get failed');
        return result.item ? rehydrateSharedItem(result.item) : null;
      },
      async report(key, reason) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_REPORT', payload: { key, reason } },
          'SHARED_REPORT_RESULT',
        );
        throwOnSharedRateLimit(result, 'shared report failed');
        throwOnFailedReply(result, 'shared report failed');
      },
      async getCount(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_GET_COUNT', payload: { key } },
          'SHARED_GET_COUNT_RESULT',
        );
        throwOnReplyError(result, 'shared getCount failed');
        return result.count;
      },
      async getCounts(keys) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_GET_COUNTS', payload: { keys } },
          'SHARED_GET_COUNTS_RESULT',
        );
        throwOnReplyError(result, 'shared getCounts failed');
        return result.counts;
      },
      async append(value) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_APPEND', payload: { value } },
          'SHARED_APPEND_RESULT',
        );
        throwOnSharedRateLimit(result, 'shared append failed');
        throwOnReplyError(result, 'shared append failed');
        return { key: result.key };
      },
      async update(key, value) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_UPDATE', payload: { key, value } },
          'SHARED_UPDATE_RESULT',
        );
        throwOnSharedRateLimit(result, 'shared update failed');
        throwOnFailedReply(result, 'shared update failed');
      },
      async vote(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_VOTE', payload: { key } },
          'SHARED_VOTE_RESULT',
        );
        throwOnSharedRateLimit(result, 'shared vote failed');
        throwOnReplyError(result, 'shared vote failed');
        return result.count;
      },
      async unvote(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_UNVOTE', payload: { key } },
          'SHARED_UNVOTE_RESULT',
        );
        throwOnSharedRateLimit(result, 'shared unvote failed');
        throwOnReplyError(result, 'shared unvote failed');
        return result.count;
      },
      async withdraw(key) {
        const result = await sendTypedRequest(
          transport,
          { type: 'SHARED_WITHDRAW', payload: { key } },
          'SHARED_WITHDRAW_RESULT',
        );
        throwOnSharedRateLimit(result, 'shared withdraw failed');
        throwOnFailedReply(result, 'shared withdraw failed');
        // `deleted` is optional on the wire type because an error reply omits
        // it. On the success path the validator requires a boolean, so this is
        // defence in depth rather than a reachable branch through the real
        // transport — but it is what makes the `boolean` we return honest,
        // instead of a cast asserting a guarantee this function cannot see.
        if (typeof result.deleted !== 'boolean') {
          throw new Error('shared withdraw failed: reply carried no `deleted` flag');
        }
        return { ok: true as const, deleted: result.deleted };
      },
    };
  }, []);
}
