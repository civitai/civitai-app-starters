import { createCaller, type CallOptions } from '../core/messaging.js';
import { paginate } from '../core/paging.js';

import type { StorageEntry, StorageQuery, StorageQuota, StorageRequests } from './protocol.js';

const call = createCaller<StorageRequests>();

export type { StorageEntry, StorageQuery, StorageQuota } from './protocol.js';

/**
 * A stored value, or `null` when the key is unset — which is also what an
 * anonymous viewer reads, since the store is keyed by viewer. `T` is your
 * assertion about what you wrote; nothing validates it.
 */
export async function get<T = unknown>(key: string, opts: CallOptions = {}): Promise<T | null> {
  const { value } = await call('APP_STORAGE_GET', { key }, opts);
  return (value ?? null) as T | null;
}

/**
 * Writes a JSON value. A value is capped at 64KB and the viewer's store at 2MB
 * per app; either ceiling fails as `insufficient`, without saying which.
 */
export async function set(key: string, value: unknown, opts: CallOptions = {}): Promise<void> {
  await call('APP_STORAGE_SET', { key, value }, opts);
}

/** Removes a key, answering `false` when it was already absent. */
export async function remove(key: string, opts: CallOptions = {}): Promise<boolean> {
  return (await call('APP_STORAGE_DELETE', { key }, opts)).deleted ?? false;
}

/**
 * The viewer's keys in this app, ascending, fetching the next page only as you
 * read into it. Stops after `limit` keys — 100 unless you say otherwise.
 * `break` stops fetching; the cursor stays inside.
 */
export function list(
  query: StorageQuery = {},
  opts: CallOptions = {},
): AsyncGenerator<StorageEntry> {
  return paginate(query.limit, 200, async (take, cursor) => {
    const page = await call('APP_STORAGE_LIST', { ...query, limit: take, cursor }, opts);
    return { items: page.keys, cursor: page.nextCursor };
  }, query.cursor);
}

/** What the viewer has used of their own allowance in this app. */
export function getQuota(opts: CallOptions = {}): Promise<StorageQuota> {
  return call('APP_STORAGE_QUOTA', {}, opts);
}
