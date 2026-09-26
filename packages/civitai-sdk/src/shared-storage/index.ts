import { CivitaiError } from '../core/errors.js';
import type { Http, Query } from '../http/index.js';

/** Where the eleven routes live under the site base URL. */
const BASE = 'blocks/shared-storage';

export interface SharedStorageCallOptions {
  signal?: AbortSignal;
}

/**
 * The moderated, user-visible text plus the opaque app-owned blob.
 *
 * 🔴 `title` and `body` run the server's BLOCKING content-safety belt on every
 * write. `data` does NOT — it is unmoderated app structure. Put every string
 * another viewer will read in `title`/`body`; a text surface smuggled into
 * `data` reaches other users unmoderated, which is the one thing this split
 * exists to prevent.
 */
export interface SharedValue {
  title: string;
  body?: string;
  data?: unknown;
}

/**
 * One row of the shared feed, as `list` and `get` both project it.
 *
 * 🔴 `value` is `unknown`, not `SharedValue`. What a row holds is whatever some
 * OTHER user's app version wrote — possibly an older shape, possibly a newer one
 * — so it is the caller's to narrow. Declaring it `SharedValue` would be this
 * client asserting a shape it never checked about data it did not write.
 */
export interface SharedItem {
  key: string;
  /** The row's author. A caller renders "yours" by comparing it to the viewer's id. */
  authorUserId: number;
  value: unknown;
  /** The aggregate up-vote tally. Never the raw vote rows — those are not listable. */
  count: number;
  /**
   * The wire carries ISO strings; both stamps are revived here, once, so a
   * caller can sort and diff without knowing the transport.
   */
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether THIS viewer has voted. 🔴 Always `false` for an anonymous viewer —
   * who may read this feed — so it is not evidence that nobody voted.
   */
  viewerVoted: boolean;
}

export interface SharedListQuery {
  /** Narrows to keys starting with this. Escaped server-side against LIKE wildcards. */
  prefix?: string;
  /** The server bounds this and applies its own default; this client sends none. */
  limit?: number;
  /** An opaque `nextCursor` from a previous page. */
  cursor?: string;
}

export interface SharedListResult {
  /** Newest-first on the server-generated ULID key. Hidden rows are excluded. */
  items: SharedItem[];
  /**
   * 🔴 PRESENT EXACTLY WHEN THERE MAY BE MORE ROWS, and passed through
   * untouched. The server sets it iff the page it returned was full, and it
   * arrives nested under the reply's `metadata` — lifted here, never defaulted,
   * never normalised, never re-derived from `items.length`. A caller uses its
   * ABSENCE as proof a scan completed.
   */
  nextCursor?: string;
}

/** One app-defined counter. */
export interface SharedCounter {
  key: string;
  count: number;
}

export interface SharedTopQuery {
  /** Matches counter keys starting with this, e.g. `playcount:`. */
  prefix?: string;
  /** The server bounds this and applies its own default; this client sends none. */
  limit?: number;
}

/**
 * This app's CROSS-USER shared store — every viewer of this app reads and writes
 * one namespace, unlike {@link StorageClient}, which is private per viewer.
 *
 * 🔴 Requires the block token the host mints, plus the scopes: every read takes
 * `apps:storage:shared:read` and every write takes `apps:storage:shared:write`.
 * An app that authenticated with an OAuth access token has no shared storage.
 *
 * 🔴 READS AND WRITES HAVE DIFFERENT AUDIENCES, and a caller must not assume one
 * implies the other:
 *
 * - An ANONYMOUS viewer MAY read (`list`, `get`, `counts`, `top`) and may NEVER
 *   write. An anon write is refused by the scope binding before the handler
 *   runs, so it arrives as **403**, not the 401 a missing token gives.
 * - A signed-in viewer is not automatically a permitted writer: writes clear a
 *   minimum-trust gate (account age, paid tier, verified email or a linked OAuth
 *   account). Treat a write refusal as a normal outcome and say so in the UI.
 *
 * 🔴 EVERY FAILURE REJECTS. No path here resolves to mean "not written" or
 * "could not read". A caller that must not act on a partial view branches on the
 * rejection, never on an empty result.
 */
export interface SharedStorageClient {
  /**
   * One page of rows, newest-first. `GET blocks/shared-storage/list`.
   *
   * Values ARE returned, unlike the per-viewer client's `list` — this is the
   * feed read, so one request renders a page.
   */
  list(query?: SharedListQuery, opts?: SharedStorageCallOptions): Promise<SharedListResult>;

  /**
   * One row by key, or `null`. `GET blocks/shared-storage/item`.
   *
   * 🔴 `null` covers MISSING **and** HIDDEN, deliberately and identically — a
   * withdrawn or moderator-hidden row is indistinguishable from one that never
   * existed, so this is not an oracle for either. It is a 200, not a 404.
   */
  get(key: string, opts?: SharedStorageCallOptions): Promise<SharedItem | null>;

  /**
   * Aggregate vote tallies for many keys at once. `GET blocks/shared-storage/counts`.
   *
   * The reply carries one entry per REQUESTED key — a hidden or unknown key
   * reads `0`, so a 0/absent distinction cannot probe for hidden rows. That
   * promise is ASSERTED here, because the declared `Record<string, number>` is
   * what lets a caller write `counts[key]` and get a number rather than
   * `undefined` typed as one.
   */
  counts(
    keys: readonly string[],
    opts?: SharedStorageCallOptions,
  ): Promise<Record<string, number>>;

  /**
   * Top counters by tally, descending — the "popular" rail read.
   * `GET blocks/shared-storage/top`.
   *
   * 🔴 These are app-defined COUNTERS (what {@link SharedStorageClient.increment}
   * bumps), NOT the vote tallies on feed rows. A "most-voted" rail is
   * {@link SharedStorageClient.list} sorted by the caller, not this.
   */
  top(query?: SharedTopQuery, opts?: SharedStorageCallOptions): Promise<SharedCounter[]>;

  /**
   * Files a new row and resolves its key. `POST blocks/shared-storage/append`.
   *
   * 🔴 THE KEY IS THE SERVER'S — a ULID it generates, returned here. This method
   * takes no key and there is no create-at-key call, because a client-chosen key
   * would let one viewer overwrite another's row.
   */
  append(value: SharedValue, opts?: SharedStorageCallOptions): Promise<{ key: string }>;

  /**
   * Edits a row the VIEWER AUTHORED, in place. `POST blocks/shared-storage/update`.
   *
   * Another author's key is a 403 and a missing or hidden one a 404 — neither is
   * a silent no-op. Preserved: the key, the author, `createdAt`, and the row's
   * votes, counters and reports. Replaced: the value.
   */
  update(
    key: string,
    value: SharedValue,
    opts?: SharedStorageCallOptions,
  ): Promise<{ ok: true }>;

  /**
   * Up-votes a row, resolving the new tally. `POST blocks/shared-storage/vote`.
   *
   * Idempotent by construction: a second vote from the same viewer is a no-op
   * and resolves the UNCHANGED count, so a repeat cannot inflate the tally. A
   * hidden or missing row is a 404.
   */
  vote(key: string, opts?: SharedStorageCallOptions): Promise<{ count: number }>;

  /**
   * Withdraws this viewer's own up-vote. `POST blocks/shared-storage/unvote`.
   *
   * Symmetric to `vote` and on the same rate-limit budget. Resolves the new
   * tally; unvoting when no vote was cast is a no-op, never a negative count.
   */
  unvote(key: string, opts?: SharedStorageCallOptions): Promise<{ count: number }>;

  /**
   * Deletes a row the VIEWER AUTHORED. `POST blocks/shared-storage/withdraw`.
   *
   * 🔴 `deleted: false` is a SUCCESS, and it is deliberately ambiguous: another
   * author's key, an already-withdrawn row and a key that never existed all
   * answer the same way, so this cannot probe for other viewers' rows. Do not
   * report it to the viewer as "someone else owns this".
   */
  withdraw(
    key: string,
    opts?: SharedStorageCallOptions,
  ): Promise<{ ok: true; deleted: boolean }>;

  /**
   * Flags a row for moderator review. `POST blocks/shared-storage/report`.
   *
   * It does NOT hide the row — a moderator decides. Takes the WRITE scope and
   * the trust gate, which reads backwards until you see that a report creates a
   * durable row and an alertable event. `reason` is moderator-facing free text.
   *
   * Resolves identically whether the report was newly filed or deduped against
   * one this viewer already sent, so it cannot reveal who reported what.
   */
  report(
    key: string,
    reason?: string,
    opts?: SharedStorageCallOptions,
  ): Promise<{ ok: true }>;

  /**
   * Bumps an app-defined counter by one. `POST blocks/shared-storage/increment`.
   *
   * Creates the counter on first use and resolves its new value. Counter keys
   * are APP-GLOBAL — one row per key across all viewers — so give them their own
   * prefix (`playcount:`) to keep them out of a feed listing.
   *
   * 🔴 A write: it takes the write scope and the trust gate, so a sub-trust or
   * anonymous viewer is refused. Callers treat it as best-effort telemetry —
   * catch the refusal rather than letting it break a render.
   */
  increment(
    key: string,
    opts?: SharedStorageCallOptions,
  ): Promise<{ key: string; count: number }>;
}

export function createSharedStorageClient(http: Http): SharedStorageClient {
  // 🔴 GET for the reads, POST for the writes — the route table's own split, not
  // the per-viewer client's uniform POST. A read sent as POST is a 405.
  const get = <T>(op: string, query: Query, signal?: AbortSignal) =>
    http<T>('GET', `${BASE}/${op}`, { query, signal });
  const post = <T>(op: string, body: unknown, signal?: AbortSignal) =>
    http<T>('POST', `${BASE}/${op}`, { body, signal });

  return {
    async list(
      query: SharedListQuery = {},
      { signal }: SharedStorageCallOptions = {},
    ): Promise<SharedListResult> {
      const res = await get<{ items?: unknown; metadata?: unknown }>(
        'list',
        // Named rather than spread: each of the three is a field a mutation can
        // drop on its own, and an `undefined` is omitted from the query string,
        // so the server's own default applies instead of a second copy here.
        { prefix: query.prefix, limit: query.limit, cursor: query.cursor },
        signal,
      );
      // 🔴 NO `?? []`. A malformed 200 must throw, never answer "no rows": a
      // caller reads an empty page as "this feed is empty" and renders that to
      // every viewer, and a manufactured empty page is indistinguishable.
      if (!Array.isArray(res?.items)) {
        throw new CivitaiError('shared-storage list: reply carried no `items` array');
      }
      const metadata = (res.metadata ?? {}) as { nextCursor?: unknown };
      return {
        items: res.items.map(toItem),
        // 🔴 Lifted out of `metadata` and passed through. Not defaulted, not
        // normalised, not re-derived.
        nextCursor: metadata.nextCursor as string | undefined,
      };
    },

    async get(
      key: string,
      { signal }: SharedStorageCallOptions = {},
    ): Promise<SharedItem | null> {
      const res = await get<{ item?: unknown }>('item', { key }, signal);
      // 🔴 NO `res?.item ?? null`. `null` is this method's word for "no visible
      // row", a real answer a caller acts on. A reply that never carried `item`
      // is not that answer, and must not be dressed up as it.
      if (res == null || typeof res !== 'object' || !('item' in res)) {
        throw new CivitaiError('shared-storage get: reply carried no `item`');
      }
      return res.item == null ? null : toItem(res.item);
    },

    async counts(
      keys: readonly string[],
      { signal }: SharedStorageCallOptions = {},
    ): Promise<Record<string, number>> {
      // Repeated `?keys=` params, which is the only spelling the route accepts:
      // it deliberately does NOT comma-split, because a comma is legal inside an
      // app's own counter key.
      const res = await get<{ counts?: unknown }>('counts', { keys: [...keys] }, signal);
      const counts = res?.counts;
      if (counts == null || typeof counts !== 'object' || Array.isArray(counts)) {
        throw new CivitaiError('shared-storage counts: reply carried no `counts` object');
      }
      const table = counts as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const key of keys) {
        // Asserted, not defaulted to 0. The server promises one entry per
        // requested key — an absent one means the reply is not what this client
        // declares, and a silent 0 would read as "nobody voted for this".
        if (typeof table[key] !== 'number') {
          throw new CivitaiError(`shared-storage counts: reply carried no count for \`${key}\``);
        }
        out[key] = table[key] as number;
      }
      return out;
    },

    async top(
      query: SharedTopQuery = {},
      { signal }: SharedStorageCallOptions = {},
    ): Promise<SharedCounter[]> {
      // 🔴 A BARE ARRAY, not an enveloped one — this route answers `[{key, count}]`
      // with no `items` and no `metadata`, unlike `list` next to it. Read from the
      // handler, not inferred from the neighbour.
      const res = await get<unknown>('top', { prefix: query.prefix, limit: query.limit }, signal);
      if (!Array.isArray(res)) {
        throw new CivitaiError('shared-storage top: reply was not an array');
      }
      return res.map(toCounter);
    },

    async append(
      value: SharedValue,
      { signal }: SharedStorageCallOptions = {},
    ): Promise<{ key: string }> {
      const res = await post<{ key?: unknown }>('append', { value }, signal);
      // Asserted, not cast: this key is the ONLY handle the caller will ever have
      // on the row it just created, and a cast would make the declared `string` a
      // lie we cannot see.
      if (typeof res?.key !== 'string') {
        throw new CivitaiError('shared-storage append: reply carried no `key`');
      }
      return { key: res.key };
    },

    async update(
      key: string,
      value: SharedValue,
      { signal }: SharedStorageCallOptions = {},
    ): Promise<{ ok: true }> {
      await post<unknown>('update', { key, value }, signal);
      // The route answers `{ ok: true }` and every failure has already rejected,
      // so there is no second field to check — resolving IS the answer.
      return { ok: true as const };
    },

    vote: (key: string, { signal }: SharedStorageCallOptions = {}) =>
      countOf(post('vote', { key }, signal), 'vote'),

    unvote: (key: string, { signal }: SharedStorageCallOptions = {}) =>
      countOf(post('unvote', { key }, signal), 'unvote'),

    async withdraw(
      key: string,
      { signal }: SharedStorageCallOptions = {},
    ): Promise<{ ok: true; deleted: boolean }> {
      const res = await post<{ deleted?: unknown }>('withdraw', { key }, signal);
      if (typeof res?.deleted !== 'boolean') {
        throw new CivitaiError('shared-storage withdraw: reply carried no `deleted` flag');
      }
      return { ok: true as const, deleted: res.deleted };
    },

    async report(
      key: string,
      reason?: string,
      { signal }: SharedStorageCallOptions = {},
    ): Promise<{ ok: true }> {
      // `reason` omitted when undefined, so the server applies its own default
      // rather than this client shipping a second copy of it.
      await post<unknown>('report', { key, reason }, signal);
      return { ok: true as const };
    },

    async increment(
      key: string,
      { signal }: SharedStorageCallOptions = {},
    ): Promise<{ key: string; count: number }> {
      const res = await post<{ key?: unknown; count?: unknown }>('increment', { key }, signal);
      if (typeof res?.count !== 'number') {
        throw new CivitaiError('shared-storage increment: reply carried no `count`');
      }
      // The route echoes the key; prefer its own answer, and fall back to the one
      // we sent rather than throwing, since the count is the load-bearing half.
      return { key: typeof res.key === 'string' ? res.key : key, count: res.count };
    },
  };
}

/** `vote` and `unvote` answer the same shape, so they read it the same way. */
async function countOf(
  pending: Promise<{ count?: unknown }>,
  op: string,
): Promise<{ count: number }> {
  const res = await pending;
  // 🔴 NOT `?? 0`. This tally is rendered, and a manufactured zero would read as
  // "your vote did not land" for a vote that did.
  if (typeof res?.count !== 'number') {
    throw new CivitaiError(`shared-storage ${op}: reply carried no \`count\``);
  }
  return { count: res.count };
}

function toItem(row: unknown): SharedItem {
  const r = (row ?? {}) as Record<string, unknown>;
  if (
    typeof r.key !== 'string' ||
    typeof r.authorUserId !== 'number' ||
    typeof r.count !== 'number' ||
    typeof r.viewerVoted !== 'boolean' ||
    !('value' in r)
  ) {
    throw new CivitaiError('shared-storage: malformed item');
  }
  return {
    key: r.key,
    authorUserId: r.authorUserId,
    value: r.value,
    count: r.count,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    viewerVoted: r.viewerVoted,
  };
}

function toDate(raw: unknown): Date {
  // `new Date(null)` is the epoch, not an Invalid Date, so the NaN check below
  // cannot be the only gate — a null timestamp would sort and compare silently
  // wrong forever.
  if (!(typeof raw === 'string' || raw instanceof Date)) {
    throw new CivitaiError('shared-storage: malformed item timestamp');
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new CivitaiError('shared-storage: malformed item timestamp');
  }
  return at;
}

function toCounter(row: unknown): SharedCounter {
  const r = (row ?? {}) as Record<string, unknown>;
  if (typeof r.key !== 'string' || typeof r.count !== 'number') {
    throw new CivitaiError('shared-storage top: malformed counter');
  }
  return { key: r.key, count: r.count };
}
