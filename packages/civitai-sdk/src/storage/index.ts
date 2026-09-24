import { CivitaiError } from '../core/errors.js';
import { ApiError, type Http } from '../http/index.js';

/** Where the five routes live under the site base URL. */
const BASE = 'blocks/app-storage';

export interface StorageCallOptions {
  signal?: AbortSignal;
}

/** One row of a key listing. Values are not returned — `get(key)` fetches them. */
export interface StorageKeyEntry {
  key: string;
  /**
   * When this key was last written. The wire carries an ISO string; it is
   * revived here, once, so a caller can do date arithmetic without knowing the
   * transport.
   */
  updatedAt: Date;
}

export interface StorageListResult {
  keys: StorageKeyEntry[];
  /**
   * 🔴 PRESENT EXACTLY WHEN THERE MAY BE MORE ROWS, and passed through
   * untouched. The server sets it iff the page it returned was full. A caller
   * uses its ABSENCE as proof a scan completed, and for one caller that is a
   * money decision. Never default it, never normalise it, never re-derive it
   * from `keys.length`.
   */
  nextCursor?: string;
}

export interface StorageListQuery {
  /** Narrows to keys starting with this. Escaped server-side against LIKE wildcards. */
  prefix?: string;
  /** The server bounds this and applies its own default; this client sends none. */
  limit?: number;
  /** An opaque `nextCursor` from a previous page. */
  cursor?: string;
}

export interface StorageQuota {
  /**
   * 🔴 THE STORED UNIT — Postgres `octet_length(value::text)` over JSONB, the
   * unit both ceilings are enforced in, and the authority for "how close am I
   * to my cap". It is NOT {@link StorageClient.set}'s `sizeBytes`: measured, a
   * numeric-heavy payload stores up to 44.4x its wire size.
   */
  usedBytes: number;
  rowCount: number;
  /** Render this, never a compiled-in figure — the ceiling can move. */
  limitBytes: number;
  /** Usually the BINDING one: many small rows exhaust this long before bytes. */
  limitRows: number;
}

/**
 * The viewer's own per-(app, block instance) key/value store.
 *
 * 🔴 Requires the block token the host mints. An app that authenticated with an
 * OAuth access token instead has no per-viewer app storage — every call is
 * refused.
 *
 * 🔴 EVERY FAILURE REJECTS. There is no path here that resolves to mean "not
 * written", and none that resolves to mean "could not read". A caller that must
 * not act on a partial view branches on the rejection, never on an empty result.
 */
export interface StorageClient {
  /** The value, or `null` when the key is unset. Rejects on any refusal. */
  get<T = unknown>(key: string, opts?: StorageCallOptions): Promise<T | null>;

  /**
   * Upsert one key. Resolves only when the write landed.
   *
   * `sizeBytes` is the WIRE unit — the byte length of the serialised value — so
   * it predicts the per-value cap and nothing else. 🔴 Do not sum it to track
   * quota; call {@link StorageClient.getQuota}. See {@link StorageQuota.usedBytes}.
   *
   * A value of `undefined` is stored as `null`: it does not survive JSON, and
   * the server writes `null` for an absent value rather than refusing.
   */
  set<T = unknown>(
    key: string,
    value: T,
    opts?: StorageCallOptions,
  ): Promise<{ ok: true; sizeBytes: number }>;

  /** Idempotent. `deleted: false` means the key was already absent — a success. */
  delete(key: string, opts?: StorageCallOptions): Promise<{ ok: true; deleted: boolean }>;

  /** One page of keys, ordered by key ascending. Values are not returned. */
  list(query?: StorageListQuery, opts?: StorageCallOptions): Promise<StorageListResult>;

  /**
   * This viewer's usage against this viewer's caps, in the stored unit.
   *
   * It reports neither the key-length cap nor the per-value cap, so a write
   * that fits the numbers here can still be refused.
   */
  getQuota(opts?: StorageCallOptions): Promise<StorageQuota>;
}

/**
 * "This write can never succeed as-is" — every quota and per-value refusal, and
 * the request-parser's own, arrive under one status. Structural on purpose: the
 * server distinguishes which ceiling fired only in prose, and matching prose is
 * a guard that any rewording walks through.
 */
export const isQuotaRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 413;

export function createStorageClient(http: Http): StorageClient {
  const post = <T>(op: string, body: unknown, signal?: AbortSignal) =>
    http<T>('POST', `${BASE}/${op}`, { body, signal });

  return {
    async get<T>(key: string, { signal }: StorageCallOptions = {}): Promise<T | null> {
      const res = await post<{ value?: unknown }>('get', { key }, signal);
      // 🔴 NO `res?.value ?? null`. `null` is this method's word for "the key is
      // unset" — a real answer a caller acts on, including one that decides
      // whether to spend. A reply that never carried `value` is not that answer.
      if (res == null || typeof res !== 'object' || !('value' in res)) {
        throw new CivitaiError('app-storage get: reply carried no `value`');
      }
      return (res.value ?? null) as T | null;
    },

    async set<T>(
      key: string,
      value: T,
      { signal }: StorageCallOptions = {},
    ): Promise<{ ok: true; sizeBytes: number }> {
      const res = await post<{ sizeBytes?: unknown }>('set', { key, value }, signal);
      // Asserted, not cast: the declared `number` is a promise this client makes
      // to a caller that renders it, and a cast would make it a lie we cannot see.
      if (typeof res?.sizeBytes !== 'number') {
        throw new CivitaiError('app-storage set: reply carried no `sizeBytes`');
      }
      return { ok: true as const, sizeBytes: res.sizeBytes };
    },

    async delete(
      key: string,
      { signal }: StorageCallOptions = {},
    ): Promise<{ ok: true; deleted: boolean }> {
      const res = await post<{ deleted?: unknown }>('delete', { key }, signal);
      if (typeof res?.deleted !== 'boolean') {
        throw new CivitaiError('app-storage delete: reply carried no `deleted` flag');
      }
      return { ok: true as const, deleted: res.deleted };
    },

    async list(
      query: StorageListQuery = {},
      { signal }: StorageCallOptions = {},
    ): Promise<StorageListResult> {
      const res = await post<{ keys?: unknown; nextCursor?: unknown }>(
        'list',
        // Named rather than spread: each of the three is a field a mutation can
        // drop on its own, and `JSON.stringify` omits the ones left undefined,
        // so the server's own default applies instead of a second copy here.
        { prefix: query.prefix, limit: query.limit, cursor: query.cursor },
        signal,
      );
      // 🔴 NO `?? []`. A malformed 200 must throw, never answer "no keys": a
      // caller stands its double-spend backstop down on a scan that completed,
      // and a manufactured empty page is indistinguishable from one.
      if (!Array.isArray(res?.keys)) {
        throw new CivitaiError('app-storage list: reply carried no `keys` array');
      }
      return {
        keys: res.keys.map(toEntry),
        // 🔴 Passed through. Not defaulted, not normalised, not re-derived.
        nextCursor: res.nextCursor as string | undefined,
      };
    },

    getQuota: ({ signal }: StorageCallOptions = {}) => post<StorageQuota>('quota', {}, signal),
  };
}

function toEntry(row: unknown): StorageKeyEntry {
  const r = (row ?? {}) as { key?: unknown; updatedAt?: unknown };
  const raw = r.updatedAt;
  // `new Date(null)` is the epoch, not an Invalid Date, so the NaN check below
  // cannot be the only gate — a null timestamp would sort and compare silently
  // wrong forever.
  if (typeof r.key !== 'string' || !(typeof raw === 'string' || raw instanceof Date)) {
    throw new CivitaiError('app-storage list: malformed key entry');
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new CivitaiError('app-storage list: malformed key entry');
  }
  return { key: r.key, updatedAt: at };
}
