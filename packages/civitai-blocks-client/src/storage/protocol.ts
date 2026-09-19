/** A stored key and when it was last written. `updatedAt` is ISO-8601. */
export interface StorageEntry {
  key: string;
  updatedAt: string;
}

/** The viewer's own usage in this app, never the app-wide total. */
export interface StorageQuota {
  usedBytes: number;
  limitBytes: number;
  rowCount: number;
  limitRows: number;
}

export interface StorageQuery {
  /** Keys starting with this; `%` and `_` are literal, not wildcards. */
  prefix?: string;
  /** Stop after this many keys. Defaults to 100; `Infinity` reads to the end. */
  limit?: number;
  /** Opaque; from a prior reply. */
  cursor?: string;
}

/** The host's own `APP_STORAGE_*` messages, carried unchanged. */
export type StorageRequests = {
  APP_STORAGE_GET: { params: { key: string }; result: { value: unknown } };
  APP_STORAGE_SET: { params: { key: string; value: unknown }; result: { sizeBytes?: number } };
  APP_STORAGE_DELETE: { params: { key: string }; result: { deleted?: boolean } };
  APP_STORAGE_LIST: {
    params: StorageQuery;
    result: { keys: StorageEntry[]; nextCursor?: string };
  };
  APP_STORAGE_QUOTA: { params: Record<string, never>; result: StorageQuota };
};
