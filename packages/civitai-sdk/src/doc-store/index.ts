import { CivitaiError } from '../core/errors.js';
import { ApiError, type Http, type Query } from '../http/index.js';

/**
 * The App Blocks DOCUMENT STORE: named collections of JSON documents, declared in
 * the app's manifest under `storage.collections`, served by `/api/v1/blocks/storage/…`.
 *
 * It replaces the two key/value stores (`app.storage.get/set/…` and
 * `app.sharedStorage`), which keep working, unchanged, until every app has moved.
 *
 * The rules — who may read or write which collection, the limits, the error codes
 * — are the server's, and this client re-spells none of them. It sends a request,
 * reads the reply, and turns a refusal into a {@link StorageError} carrying the
 * server's own `code`. It refuses only what would reach a DIFFERENT route: a path
 * segment a URL cannot carry (`''`, `.`, `..`), which `fetch` would rewrite, and a
 * collection name outside the manifest's rule (`_get` is itself a route) — each with
 * the code the server gives the same input.
 */

/** Where the routes live under the site base URL (`…/api/v1`). */
const BASE = 'blocks/storage';
/** The batch-get route sits at the collection position behind a `_`, which no collection name can start with. */
const GET_MANY = '_get';

export interface DocumentCallOptions {
  signal?: AbortSignal;
}

/** Who wrote a document, as every reader sees it. Never a numeric user id. */
export type DocumentAuthor =
  /**
   * A viewer. `isViewer` is whether that is the viewer reading it; `username` is
   * present only when the collection declares `showAuthor` (and the user has one).
   */
  | { kind: 'user'; isViewer: boolean; username?: string }
  /** Written by the app owner (a later phase; nothing writes one yet). */
  | { kind: 'app' }
  /** Created by the first increment of a counter in a `write: "none"` collection; nobody owns it. */
  | { kind: 'counter' };

export interface StorageDocument<T extends object = Record<string, unknown>> {
  key: string;
  data: T;
  /** +1 on every `data` write. Counter and mark changes do not move it. */
  version: number;
  /** Revived from the wire's ISO string, once, here. */
  createdAt: Date;
  updatedAt: Date;
  author: DocumentAuthor;
  /** Declared counters of a shared collection; `{}` on a private one. */
  counters: Record<string, number>;
  /** Declared mark counts of a shared collection (never `report`'s); `{}` on a private one. */
  marks: Record<string, number>;
  /** The viewer's own marks on this document; `null` for an anonymous viewer. */
  viewer: { marks: string[] } | null;
}

/** A `time` index filters by an ISO-8601 string or epoch milliseconds; a `Date` is sent as ISO. */
export type DocumentWhereValue = string | number | boolean | Date;

export interface DocumentListQuery {
  /**
   * Equality on ONE declared index: `{ status: 'open' }`. An undeclared field is
   * refused `index_not_declared`, more than one field `invalid_request`.
   */
  where?: Record<string, DocumentWhereValue>;
  /**
   * `[-]key | createdAt | updatedAt | <index> | counter:<name> | mark:<name>`; a
   * leading `-` is descending. The server's default is `key`.
   */
  sort?: string;
  /** Only documents the viewer authored. */
  author?: 'me';
  /** With {@link DocumentListQuery.mark}: only documents the viewer marked with it. */
  markedBy?: 'me';
  mark?: string;
  keyPrefix?: string;
  /** The server bounds it and applies its own default; this client sends none. */
  limit?: number;
  /** A `nextCursor` from the previous page of the SAME query. */
  cursor?: string;
}

export interface DocumentPage<T extends object = Record<string, unknown>> {
  items: StorageDocument<T>[];
  /** `null` exactly when this was the last page. Passed through as the server sent it. */
  nextCursor: string | null;
}

export interface WriteOptions extends DocumentCallOptions {
  /**
   * Write only if the document is at this version — `0` means only if it does not
   * exist yet. A mismatch rejects with `version_conflict` and
   * `details.currentVersion`.
   */
  ifVersion?: number;
}

export interface StorageCollection<T extends object = Record<string, unknown>> {
  /** The document, or `null` when there is none (missing, hidden and absent read alike). */
  get(key: string, opts?: DocumentCallOptions): Promise<StorageDocument<T> | null>;
  /** One round trip; the result is in the order of `keys`, `null` for each miss. */
  getMany(keys: readonly string[], opts?: DocumentCallOptions): Promise<(StorageDocument<T> | null)[]>;
  /** Create or replace the document at `key`. */
  put(key: string, data: T, opts?: WriteOptions): Promise<StorageDocument<T>>;
  /** Create a document under a key the server chooses (a sortable id). */
  create(data: T, opts?: DocumentCallOptions): Promise<StorageDocument<T>>;
  /** Idempotent: `deleted: false` means there was nothing to delete. */
  delete(key: string, opts?: WriteOptions): Promise<{ deleted: boolean }>;
  /** One page. Follow `nextCursor` with the same query for the next one. */
  list(query?: DocumentListQuery, opts?: DocumentCallOptions): Promise<DocumentPage<T>>;
  /**
   * Add `by` (the server's default when omitted) to a declared counter of a
   * shared document. In a `write: "none"` collection the first increment of an
   * absent key creates the document.
   */
  increment(
    key: string,
    counter: string,
    by?: number,
    opts?: DocumentCallOptions,
  ): Promise<{ value: number }>;
  /**
   * Set the viewer's mark on a shared document — a declared mark, or the
   * built-in `report`. Idempotent. `count` is absent for `report`, whose count is
   * never exposed.
   */
  mark(key: string, name: string, opts?: DocumentCallOptions): Promise<{ marked: true; count?: number }>;
  /**
   * Remove the viewer's mark. Idempotent. A `report` cannot be withdrawn: the
   * server refuses it `invalid_request` (400) for every caller.
   */
  unmark(key: string, name: string, opts?: DocumentCallOptions): Promise<{ marked: false; count?: number }>;
}

export type StorageIndexType = 'string' | 'number' | 'boolean' | 'time';

/** One declared collection, as the server reads the app's approved manifest. */
export interface StorageCollectionInfo {
  kind: string;
  visibility: 'private' | 'shared';
  /** Shared collections only. */
  write?: string;
  counters: string[];
  marks: string[];
  indexes: Record<string, StorageIndexType>;
  showAuthor: boolean;
}

export interface StorageUsage {
  /** The STORED unit (the database's own measure of the JSON), which the ceilings bind in. */
  bytes: number;
  docs: number;
}

/** Render these, never a compiled-in figure: they are the server's and can move. */
export interface StorageLimits {
  docBytes: number;
  appBytes: number;
  appDocs: number;
  viewerBytes: number;
  viewerDocs: number;
  listLimitMax: number;
  getManyMax: number;
  rate: {
    readsPerMinute: number;
    privateWritesPerMinute: number;
    marksAndCountersPerMinute: number;
    reportsPerDay: number;
    sharedWritesBurst: number;
    sharedWritesPerDay: number;
  };
}

export interface StorageInfo {
  collections: Record<string, StorageCollectionInfo>;
  limits: StorageLimits;
  usage: { app: StorageUsage; viewer: StorageUsage };
}

/** Options for {@link DocumentStorage.collection}. */
export interface CollectionOptions {
  /**
   * Another app's blockId: reach THAT app's collection `name`, as the viewer, through
   * an import this app's manifest declares under `storage.imports`
   * (`{ from, collections, access }`), instead of this app's own collection of the
   * same name. Every call then carries `?from=<blockId>`; the method, path, body and
   * reply are unchanged.
   *
   * Through an import the call runs IN THE SOURCE APP: a private collection holds the
   * viewer's own documents there, writes follow the source collection's write policy
   * and schema, and usage counts against the source app's ceilings. It needs the
   * consent-gated `apps:storage:import` scope, which the viewer grants per source app
   * (refusals: {@link storageImportRefusal}). Only an ordinary block token imports: a
   * dev-tunnel preview, a dev token, a hub token and a review are refused.
   *
   * When the key is present its value must be a string: `{ from: undefined }` (a
   * parent blockId not loaded yet) is refused before sending rather than read as
   * "this app's own collection".
   */
  from?: string;
}

/** The document store's surface on `app.storage`. */
export interface DocumentStorage {
  /**
   * A declared collection — this app's own, or with `{ from }` another app's, through
   * an import (see {@link CollectionOptions.from}). Nothing is sent until an operation
   * is called.
   */
  collection<T extends object = Record<string, unknown>>(name: string, options?: CollectionOptions): StorageCollection<T>;
  /**
   * The declared collections, the limits and the usage so far. Signed-in viewers only.
   * THIS app's only: it takes no `from` (the server refuses one), so a source app's
   * info and usage cannot be read through an import. A `from` is refused before sending.
   */
  info(opts?: DocumentCallOptions): Promise<StorageInfo>;
}

/**
 * Every code the server documents for these routes. The type stays open
 * (`string & {}`) so a code a later server adds still reaches the caller.
 * `import_not_declared` and `not_exportable` (both 403) come only from a call
 * through an import; {@link storageImportRefusal} types those and the others.
 */
export type StorageErrorCode =
  | 'invalid_request'
  | 'index_not_declared'
  | 'unauthenticated'
  | 'sign_in_required'
  | 'insufficient_scope'
  | 'consent_required'
  | 'import_not_declared'
  | 'not_exportable'
  | 'not_eligible'
  | 'not_author'
  | 'write_policy'
  | 'resource_not_owned'
  | 'not_found'
  | 'collection_not_declared'
  | 'method_not_allowed'
  | 'version_conflict'
  | 'index_building'
  | 'cursor_expired'
  | 'too_large'
  | 'quota_exceeded'
  | 'content_rejected'
  | 'rate_limited'
  | 'internal_error'
  | 'storage_disabled'
  | 'moderation_unavailable'
  | 'consent_unavailable'
  | 'service_unavailable'
  /**
   * LOCAL, never sent by the server: the host marked this frame a dev-tunnel
   * local preview, and no manifest reached the SDK to say which collections exist.
   */
  | 'local_preview_no_manifest'
  /** LOCAL, never sent by the server: the local preview's manifest declares storage the local store cannot serve. */
  | 'local_preview_invalid_manifest'
  /** LOCAL, never sent by the server: the local preview's in-memory store could not be loaded. */
  | 'local_preview_unavailable'
  | (string & {});

/**
 * A refusal from the document store, in its one envelope `{ code, message, error, details? }`.
 * Branch on `code`; `status` and `body` are {@link ApiError}'s, as sent.
 */
export class StorageError extends ApiError {
  readonly code: StorageErrorCode;
  /** E.g. `currentVersion`, `reason`, `category`, `ceiling`, `bucket`, `retryAfter`. */
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: StorageErrorCode,
    message: string,
    body: unknown,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(status, message, body);
    if (options?.cause !== undefined) Object.defineProperty(this, 'cause', { value: options.cause });
    this.name = 'StorageError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  /** Seconds to wait before retrying, when the server named one (`rate_limited`, a retryable 503). */
  get retryAfter(): number | undefined {
    const value = this.details?.retryAfter;
    return typeof value === 'number' ? value : undefined;
  }
}

/**
 * `details.reason` of a `not_eligible` that only an import gets: a review (run-for-real)
 * token, a dev token (a dev-tunnel preview) or a hub OAuth bearer reaches no other app;
 * `source_not_approved` — no approved app holds the source blockId.
 */
export type StorageImportNotEligibleReason = 'import_in_review' | 'import_dev_token' | 'import_hub_token' | 'source_not_approved';

const IMPORT_NOT_ELIGIBLE: ReadonlySet<string> = new Set<StorageImportNotEligibleReason>([
  'import_in_review',
  'import_dev_token',
  'import_hub_token',
  'source_not_approved',
]);

/**
 * A refusal only a call through an import (`collection(name, { from })`) gets, with its
 * `details` typed. Each kind is a different fix:
 *
 * - `import_consent` — 403 `consent_required` naming `apps:storage:import`: the viewer has
 *   not allowed this app to reach their data in `from`, or a newer version of this app
 *   imports more than they allowed. Ask, then retry once: `await app.getToken({ fresh: true })`
 *   (a token that already carries the scope is re-minted without it), then
 *   `await app.requestGrants(['apps:storage:import'])`. `false` means "not now": do not loop.
 * - `source_publish_consent` — 403 `consent_required` naming `apps:storage:publish` AND a
 *   `from`: a write, counter or mark in one of the SOURCE app's shared collections needs
 *   the viewer's publish consent IN THE SOURCE APP. An import grant is not that consent, and
 *   no grant THIS app can request supplies it; tell the viewer.
 * - `read_only` — 403 `write_policy` (`reason: 'import_read_only'`): the import's `access`
 *   is `read`.
 * - `not_declared` — 403 `import_not_declared`: this app's manifest does not import that
 *   collection from `from` (`collection` is absent when `from` is this app itself).
 * - `not_exportable` — 403 `not_exportable`: the source declares the collection
 *   `exportable: false`.
 * - `source_collection_not_declared` — 404 `collection_not_declared` with a `from`: the
 *   source app declares no such collection.
 * - `not_eligible` — 403 `not_eligible` with an import reason: the token cannot import at
 *   all (a dev, hub or review token), or no approved app holds `from`.
 */
export type StorageImportRefusal =
  | { kind: 'import_consent'; scope: 'apps:storage:import'; from: string }
  | { kind: 'source_publish_consent'; scope: 'apps:storage:publish'; from: string }
  | { kind: 'read_only'; from: string }
  | { kind: 'not_declared'; from: string; collection?: string }
  | { kind: 'not_exportable'; from: string; collection: string }
  | { kind: 'source_collection_not_declared'; from: string; collection: string }
  | { kind: 'not_eligible'; reason: StorageImportNotEligibleReason };

/**
 * The import refusal `error` is, typed — or `null` for anything else (including the
 * same codes on this app's OWN collections, which carry no `from`). Reads only the
 * server's `code` and `details`.
 */
export function storageImportRefusal(error: unknown): StorageImportRefusal | null {
  if (!(error instanceof StorageError)) return null;
  const d = error.details ?? {};
  const from = typeof d.from === 'string' ? d.from : undefined;
  const collection = typeof d.collection === 'string' ? d.collection : undefined;
  switch (error.code) {
    case 'consent_required':
      if (from === undefined) return null;
      if (d.scope === 'apps:storage:import') return { kind: 'import_consent', scope: 'apps:storage:import', from };
      if (d.scope === 'apps:storage:publish') return { kind: 'source_publish_consent', scope: 'apps:storage:publish', from };
      return null;
    case 'write_policy':
      return from !== undefined && d.reason === 'import_read_only' ? { kind: 'read_only', from } : null;
    case 'import_not_declared':
      if (from === undefined) return null;
      return collection === undefined ? { kind: 'not_declared', from } : { kind: 'not_declared', from, collection };
    case 'not_exportable':
      return from !== undefined && collection !== undefined ? { kind: 'not_exportable', from, collection } : null;
    case 'collection_not_declared':
      return from !== undefined && collection !== undefined
        ? { kind: 'source_collection_not_declared', from, collection }
        : null;
    case 'not_eligible':
      return typeof d.reason === 'string' && IMPORT_NOT_ELIGIBLE.has(d.reason)
        ? { kind: 'not_eligible', reason: d.reason as StorageImportNotEligibleReason }
        : null;
    default:
      return null;
  }
}

/**
 * Appended to a REAL route's `insufficient_scope`, after the server's own sentence.
 * The server cannot tell a published app whose manifest forgot the scope from a
 * dev-tunnel preview (which is never granted it), so the message covers both —
 * and says that, in a preview, this SDK keeps the data locally once the host
 * marks the frame, so seeing this refusal there means the host did not.
 */
export const INSUFFICIENT_SCOPE_HINT =
  'Declare `apps:storage` under `scopes` in block.manifest.json; it is granted once the app is approved. ' +
  'In a dev-tunnel preview, this version of @civitai/sdk keeps preview data in a local in-memory store ' +
  "instead, when the host marks the frame `storageMode: 'local-preview'` — this refusal came from the real " +
  'route, so this frame was not marked.';

export interface DocumentStorageOptions {
  /** Append {@link INSUFFICIENT_SCOPE_HINT} to an `insufficient_scope` refusal. The server's `code` is unchanged. */
  explainInsufficientScope?: boolean;
}

/** An {@link ApiError} whose body is the store's envelope becomes a {@link StorageError}; anything else passes through. */
function toStorageError(error: unknown, options: DocumentStorageOptions = {}): unknown {
  if (!(error instanceof ApiError) || error instanceof StorageError) return error;
  const body = error.body;
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return error;
  const { code, message, details } = body as Record<string, unknown>;
  if (typeof code !== 'string') return error;
  const said = typeof message === 'string' ? message : error.message;
  return new StorageError(
    error.status,
    code,
    // `body` stays as the server sent it; only the human-readable sentence grows.
    options.explainInsufficientScope && code === 'insufficient_scope' ? `${said} — ${INSUFFICIENT_SCOPE_HINT}` : said,
    body,
    details != null && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : undefined,
    { cause: error },
  );
}

/**
 * The manifest's rule for a collection name. A name outside it can never be
 * declared, and some of those (`_get`, `_drafts`) are ROUTES at that position, which
 * the server answers with a route-level `not_found` — which `get` would read as "no
 * such document". So such a name is refused here, before sending, with the code the
 * server gives any undeclared collection.
 */
const COLLECTION_NAME = /^[a-z][a-z0-9_]{0,31}$/;

function collectionSegment(name: string): string {
  if (typeof name !== 'string' || !COLLECTION_NAME.test(name)) {
    const status = 404;
    const message = `collection ${JSON.stringify(name)} is not a valid collection name (refused before sending)`;
    const details = { collection: name };
    throw new StorageError(
      status,
      'collection_not_declared',
      message,
      { code: 'collection_not_declared', message, error: message, details },
      details,
    );
  }
  return name;
}

/**
 * A path segment from caller input. Encoded, so `/`, `?`, `#` and spaces stay
 * inside it; and refused when URL resolution would rewrite it — an empty segment
 * collapses and `.`/`..` are path steps, so each would address a different route.
 * Refused with the code the server gives the same key, so a caller branches once.
 */
function segment(what: string, value: string): string {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..') {
    const status = 400;
    const message = `${what} ${JSON.stringify(value)} cannot be addressed in a URL path (refused before sending)`;
    throw new StorageError(status, 'invalid_request', message, { code: 'invalid_request', message, error: message });
  }
  return encodeURIComponent(value);
}

export function createDocumentStorage(http: Http, options: DocumentStorageOptions = {}): DocumentStorage {
  const call = async <R>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<R> => {
    try {
      return await http<R>(method, path, opts);
    } catch (error) {
      throw toStorageError(error, options);
    }
  };

  return {
    collection<T extends object = Record<string, unknown>>(name: string, options?: CollectionOptions): StorageCollection<T> {
      // Resolved per call, inside each async operation, so a bad name rejects that
      // call rather than throwing from `collection()` itself.
      const coll = () => collectionSegment(name);
      // `?from=` on EVERY call when importing; nothing added otherwise. Also per call.
      const q = (query?: Query): Query | undefined => withImport(options, query);
      const docPath = (key: string) => `${BASE}/${coll()}/${segment('key', key)}`;
      const doc = (reply: unknown, op: string) => toDocument<T>(reply, `${name}.${op}`);

      return {
        async get(key, { signal } = {}) {
          try {
            return doc(await call('GET', docPath(key), { query: q(), signal }), 'get');
          } catch (error) {
            // Only THIS code is "no such document". `collection_not_declared` is a 404
            // too, and is a bug in the caller, never an empty answer.
            if (error instanceof StorageError && error.code === 'not_found') return null;
            throw error;
          }
        },

        async getMany(keys, { signal } = {}) {
          const reply = await call<{ items?: unknown }>('POST', `${BASE}/${GET_MANY}/${coll()}`, {
            query: q(),
            body: { keys: [...keys] },
            signal,
          });
          if (!Array.isArray(reply?.items) || reply.items.length !== keys.length) {
            throw new CivitaiError(`storage ${name}.getMany: reply carried no \`items\` array of ${keys.length}`);
          }
          return reply.items.map((item) => (item === null ? null : doc(item, 'getMany')));
        },

        async put(key, data, { ifVersion, signal } = {}) {
          // Named rather than spread: `JSON.stringify` drops an undefined `ifVersion`,
          // so an unconditional put sends `{ data }` and nothing else.
          return doc(await call('PUT', docPath(key), { query: q(), body: { data, ifVersion }, signal }), 'put');
        },

        async create(data, { signal } = {}) {
          return doc(await call('POST', `${BASE}/${coll()}`, { query: q(), body: { data }, signal }), 'create');
        },

        async delete(key, { ifVersion, signal } = {}) {
          const reply = await call<{ deleted?: unknown }>('DELETE', docPath(key), {
            query: q({ ifVersion }),
            signal,
          });
          if (typeof reply?.deleted !== 'boolean') {
            throw new CivitaiError(`storage ${name}.delete: reply carried no \`deleted\` flag`);
          }
          return { deleted: reply.deleted };
        },

        async list(query = {}, { signal } = {}) {
          const params: Query = {
            sort: query.sort,
            author: query.author,
            markedBy: query.markedBy,
            mark: query.mark,
            keyPrefix: query.keyPrefix,
            limit: query.limit,
            cursor: query.cursor,
          };
          for (const [field, value] of Object.entries(query.where ?? {})) {
            params[`where[${field}]`] = value instanceof Date ? value.toISOString() : value;
          }
          const reply = await call<{ items?: unknown; nextCursor?: unknown }>('GET', `${BASE}/${coll()}`, {
            query: q(params),
            signal,
          });
          // 🔴 No `?? []` and no `?? null`: a malformed 200 must throw, never read as
          // "nothing here" or "last page".
          if (!Array.isArray(reply?.items)) {
            throw new CivitaiError(`storage ${name}.list: reply carried no \`items\` array`);
          }
          if (reply.nextCursor !== null && typeof reply.nextCursor !== 'string') {
            throw new CivitaiError(`storage ${name}.list: reply carried no \`nextCursor\``);
          }
          return { items: reply.items.map((item) => doc(item, 'list')), nextCursor: reply.nextCursor };
        },

        async increment(key, counter, by, { signal } = {}) {
          const reply = await call<{ value?: unknown }>(
            'POST',
            `${docPath(key)}/counters/${segment('counter', counter)}`,
            // No body at all when `by` is omitted: the server's default applies.
            { query: q(), body: by === undefined ? undefined : { by }, signal },
          );
          if (typeof reply?.value !== 'number') {
            throw new CivitaiError(`storage ${name}.increment: reply carried no \`value\``);
          }
          return { value: reply.value };
        },

        async mark(key, markName, { signal } = {}) {
          const reply = await call('PUT', `${docPath(key)}/marks/${segment('mark', markName)}`, { query: q(), signal });
          return toMarkResult(reply, true, `${name}.mark`);
        },

        async unmark(key, markName, { signal } = {}) {
          const reply = await call('DELETE', `${docPath(key)}/marks/${segment('mark', markName)}`, {
            query: q(),
            signal,
          });
          return toMarkResult(reply, false, `${name}.unmark`);
        },
      };
    },

    async info(opts = {}) {
      refuseInfoImport(opts);
      const reply = await call<StorageInfo>('GET', BASE, { signal: opts.signal });
      if (
        reply == null ||
        typeof reply !== 'object' ||
        typeof reply.collections !== 'object' ||
        typeof reply.limits !== 'object' ||
        typeof reply.usage !== 'object'
      ) {
        throw new CivitaiError('storage info: reply carried no `collections`, `limits` and `usage`');
      }
      return reply;
    },
  };
}

/** Refused with the code the server gives an unusable `from`, so a caller branches once. */
function invalidFrom(message: string, from: unknown): StorageError {
  const details = { from };
  return new StorageError(400, 'invalid_request', message, { code: 'invalid_request', message, error: message, details }, details);
}

/**
 * The query with `from` added when `options` imports. A `from` key whose value is not a
 * string — `{ from: undefined }` from a parent id not loaded yet, a `null` — is refused:
 * the query would drop it and the call would reach THIS app's same-named collection, so a
 * write meant for the source would land here. Options that are not an object at all (a
 * blockId passed bare) are refused for the same reason.
 */
function withImport(options: CollectionOptions | undefined, query?: Query): Query | undefined {
  if (options === undefined) return query;
  if (options === null || typeof options !== 'object') {
    throw invalidFrom(
      `collection options ${String(options)} are not an object: pass { from: '<source blockId>' } (refused before sending)`,
      options,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'from')) return query;
  const { from } = options;
  if (typeof from !== 'string') {
    throw invalidFrom(
      `from ${String(from)} is not a source app's blockId: pass one, or no \`from\` for this app's own collection (refused before sending)`,
      from,
    );
  }
  return { ...query, from };
}

/** `info` is this app's own: the server refuses a `from` there, so it is refused before sending. */
function refuseInfoImport(opts: object): void {
  if (opts !== null && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'from')) {
    throw invalidFrom(
      "storage info takes no `from`: a source app's collections, limits and usage cannot be read through an import (refused before sending)",
      (opts as { from?: unknown }).from,
    );
  }
}

function toMarkResult<M extends boolean>(
  reply: unknown,
  marked: M,
  op: string,
): { marked: M; count?: number } {
  const r = (reply ?? {}) as { marked?: unknown; count?: unknown };
  if (r.marked !== marked || (r.count !== undefined && typeof r.count !== 'number')) {
    throw new CivitaiError(`storage ${op}: malformed reply`);
  }
  return r.count === undefined ? { marked } : { marked, count: r.count };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

function toDate(value: unknown, op: string, field: string): Date {
  // `new Date(null)` is the epoch, not an Invalid Date: the type check is the gate.
  const at = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new CivitaiError(`storage ${op}: malformed \`${field}\``);
  return at;
}

function toAuthor(value: unknown, op: string): DocumentAuthor {
  if (isRecord(value)) {
    // Every field copied by name, so nothing else the wire carries reaches a reader.
    if (value.kind === 'app' || value.kind === 'counter') return { kind: value.kind };
    if (value.kind === 'user' && typeof value.isViewer === 'boolean') {
      return typeof value.username === 'string'
        ? { kind: 'user', isViewer: value.isViewer, username: value.username }
        : { kind: 'user', isViewer: value.isViewer };
    }
  }
  throw new CivitaiError(`storage ${op}: malformed \`author\``);
}

function toCounts(value: unknown, op: string, field: string): Record<string, number> {
  if (!isRecord(value) || Object.values(value).some((n) => typeof n !== 'number')) {
    throw new CivitaiError(`storage ${op}: malformed \`${field}\``);
  }
  return { ...(value as Record<string, number>) };
}

function toDocument<T extends object>(reply: unknown, op: string): StorageDocument<T> {
  if (!isRecord(reply) || typeof reply.key !== 'string' || !isRecord(reply.data) || typeof reply.version !== 'number') {
    throw new CivitaiError(`storage ${op}: reply is not a document`);
  }
  const viewer = reply.viewer;
  if (
    viewer !== null &&
    !(isRecord(viewer) && Array.isArray(viewer.marks) && viewer.marks.every((m) => typeof m === 'string'))
  ) {
    throw new CivitaiError(`storage ${op}: malformed \`viewer\``);
  }
  return {
    key: reply.key,
    data: reply.data as T,
    version: reply.version,
    createdAt: toDate(reply.createdAt, op, 'createdAt'),
    updatedAt: toDate(reply.updatedAt, op, 'updatedAt'),
    author: toAuthor(reply.author, op),
    counters: toCounts(reply.counters, op, 'counters'),
    marks: toCounts(reply.marks, op, 'marks'),
    viewer: viewer === null ? null : { marks: [...(viewer.marks as string[])] },
  };
}
