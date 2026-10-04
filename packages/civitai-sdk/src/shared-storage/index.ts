import { CivitaiError } from '../core/errors.js';
import type { Http, Query } from '../http/index.js';

/** Where the five routes this client wraps live under the site base URL. */
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
 * One row of the shared store, as `list` and `get` both project it.
 *
 * 🔴 `value` is `unknown`, NOT {@link SharedValue}, and that is deliberate: the
 * row was written by some OTHER viewer's copy of this app — possibly an older
 * version, possibly a newer one — so its shape is a fact about the data, not a
 * promise this client can make. Narrow it at the call site. Declaring it
 * `SharedValue` would assert a shape nothing checked about data we did not write.
 */
export interface SharedItem {
  key: string;
  /** The row's author. A caller renders "yours" by comparing it to the viewer's id. */
  authorUserId: number;
  value: unknown;
  /**
   * The row's aggregate up-vote tally, as the server projects it.
   *
   * ⚠ Reported, not writable from here: the vote OPERATIONS are deliberately not
   * part of this client (see the module note). Reading the tally is what lets an
   * app build voting at its own layer, which is why the field stays.
   */
  count: number;
  /**
   * The wire carries ISO strings; both stamps are revived here, once, so a
   * caller can sort and diff without knowing the transport.
   */
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether THIS viewer has voted. 🔴 Always `false` for an anonymous viewer —
   * who may read this store — so it is not evidence that nobody voted.
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
  /**
   * Narrows the page to rows THIS viewer authored. Omitted (or `false`) lists
   * the whole board.
   *
   * A boolean, never a user id: the author is the server's resolved token
   * subject, so this cannot ask for someone else's rows. 🔴 An ANONYMOUS viewer
   * — who may read this store — gets an EMPTY page rather than an error or the
   * whole board, so an empty result under `mine` is not evidence the store is
   * empty.
   *
   * ⚠ The boolean is YAGNI, not a capability boundary: {@link SharedItem} already
   * carries `authorUserId`, so singling out one author is already possible by
   * paging; this removes the COST. Authoritative prose lives on
   * `listSharedRows`' JSDoc in civitai/civitai
   * `src/server/routers/apps-shared.router.ts`.
   */
  mine?: boolean;
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

/**
 * This app's CROSS-USER key/value store — every viewer of this app reads and
 * writes one namespace, unlike {@link StorageClient}, which is private per viewer.
 *
 * 🔴 DELIBERATELY GENERIC KEY/VALUE, AND DELIBERATELY SMALLER THAN THE ROUTE
 * TABLE. The platform serves eleven shared-storage routes; this client wraps the
 * five that are key/value operations. The higher-level ops — `vote`, `unvote`,
 * `counts`, `top`, `increment`, `report` — are intentionally absent: an app that
 * needs voting, counters or reporting builds them at its own layer on top of
 * these five, and the platform surface expands only if demand shows up. **The
 * routes existing is not a reason to add a method here.** Do not "fix" this
 * omission.
 *
 * 🔴 Requires the block token the host mints, plus the scopes: every read takes
 * `apps:storage:shared:read` and every write takes `apps:storage:shared:write`.
 * An app that authenticated with an OAuth access token has no shared storage.
 *
 * 🔴 READS AND WRITES HAVE DIFFERENT AUDIENCES, and a caller must not assume one
 * implies the other:
 *
 * - An ANONYMOUS viewer MAY read (`list`, `get`) and may NEVER write. An anon
 *   write is refused by the scope binding before the handler runs, so it arrives
 *   as **403**, not the 401 a missing token gives.
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
   * Values ARE returned, unlike the per-viewer client's `list` — so one request
   * renders a page rather than needing a `get` per key.
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
        // Named rather than spread: each of the four is a field a mutation can
        // drop on its own, and an `undefined` is omitted from the query string,
        // so the server's own default applies instead of a second copy here.
        //
        // 🔴 `mine` IS PASSED AS A BOOLEAN AND MUST STAY ONE. `urlFor` renders a
        // boolean with `String()` (→ `?mine=true` / `?mine=false`) and drops
        // `null`/`undefined` entirely, which is exactly the serialisation the
        // route demands: its schema is
        // `z.union([z.literal('true'), z.literal('false')]).optional()`, so
        // `?mine=` — the standard rendering of an unset form field, and what
        // `String(undefined)` or a `?? ''` here would produce — is a **400**, not
        // a default. Never normalise this to a string or give it a fallback.
        { prefix: query.prefix, limit: query.limit, cursor: query.cursor, mine: query.mine },
        signal,
      );
      // 🔴 NO `?? []`. A malformed 200 must throw, never answer "no rows": a
      // caller reads an empty page as "this store is empty" and renders that to
      // every viewer, and a manufactured empty page is indistinguishable.
      if (!Array.isArray(res?.items)) {
        throw new CivitaiError('shared-storage list: reply carried no `items` array');
      }
      // 🔴 GUARDED SYMMETRICALLY WITH `items`, and for the same reason. `metadata`
      // is where `nextCursor` lives, and this method's contract is that the
      // cursor's ABSENCE proves a scan completed. A `?? {}` here would turn a
      // malformed envelope into `nextCursor: undefined` — so a caller's
      // `do…while (cursor)` loop stops after page one and renders 50 of 5,000 rows
      // as the whole store, silently. The identical malformation of `items` throws;
      // treating the container the cursor arrives in as optional would have made
      // the louder half of this reply strict and the quieter half lenient.
      if (res.metadata == null || typeof res.metadata !== 'object') {
        throw new CivitaiError('shared-storage list: reply carried no `metadata` object');
      }
      const metadata = res.metadata as { nextCursor?: unknown };
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
  };
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
