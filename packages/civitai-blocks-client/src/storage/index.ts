import { createCaller, type CallOptions } from '../core/messaging.js';

import type { StorageEntry, StorageQuery, StorageQuota, StorageRequests } from './protocol.js';

const call = createCaller<StorageRequests>({
  legacyReplies: [
    'APP_STORAGE_GET',
    'APP_STORAGE_SET',
    'APP_STORAGE_DELETE',
    'APP_STORAGE_LIST',
    'APP_STORAGE_QUOTA',
  ],
});

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
 * read into it. `break` stops fetching; the cursor stays inside.
 */
export async function* list(
  query: StorageQuery = {},
  opts: CallOptions = {},
): AsyncGenerator<StorageEntry> {
  let cursor = query.cursor;
  do {
    const page = await call('APP_STORAGE_LIST', { ...query, cursor }, opts);
    for (const entry of page.keys) yield entry;
    cursor = page.nextCursor;
  } while (cursor);
}

/** What the viewer has used of their own allowance in this app. */
export function getQuota(opts: CallOptions = {}): Promise<StorageQuota> {
  return call('APP_STORAGE_QUOTA', {}, opts);
}
