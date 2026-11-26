import { CivitaiError } from '../core/errors.js';
import { ApiError, type Http, type Query } from '../http/index.js';
import type { GrantOptions, Scope } from '../session/index.js';

/**
 * The App Blocks DOCUMENT STORE: named collections of JSON documents, declared in
 * the app's manifest under `storage.collections`, served by `/api/v1/blocks/storage/…`.
 *
 * It replaced the two key/value stores (`app.storage.get/set/…` and
 * `app.sharedStorage`, both removed from this SDK in 0.33). civitai.com shut both
 * down on 2026-11-10: their routes answer `410` `legacy_store_removed`. See
 * https://developer.civitai.com/apps/guide/storage#moving-from-the-legacy-stores
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
/**
 * The viewer's own document in a VIEWER-KEYED collection sits at the KEY position as `@me`
 * (civitai/civitai#10216): `@` is outside the key grammar, so it is never a key.
 */
const MINE = '@me';
/**
 * A parent key, exactly as the server checks it (`VIEWER_KEY_PARENT_RE` and its dot-only rule):
 * the key grammar without `:`, 1 to 96 characters, not only dots.
 */
const PARENT = /^[A-Za-z0-9._-]{1,96}$/;
const DOT_ONLY = /^\.+$/;
/** The server's digest in a derived key: 26 characters of lowercase RFC 4648 base32, no padding. */
const DIGEST = /^[a-z2-7]{26}$/;

/**
 * SERVICE MODE: where the routes live under the app-data service's base URL, when the host handed
 * the frame one (`BLOCK_INIT.appData`; civitai/civitai#10393, `apps/app-data-go`):
 * `v1/apps/<slug>/collections/<collection>/records[/<key> | /@me[/<parent>]]` and
 * `v1/apps/<slug>/info`. The bodies are the site's, so only the path moves.
 */
const SERVICE_BASE = 'v1/apps';
const SERVICE_COLLECTIONS = 'collections';
const SERVICE_RECORDS = 'records';
const SERVICE_INFO = 'info';
/** The service has no batch get: `getMany` sends keyed gets, at most this many at once. */
export const SERVICE_GET_MANY_CONCURRENCY = 4;
/** The highest `seq` the floor takes: the service reads at most 15 digits (below 2^53). */
const MAX_SEQ = 999_999_999_999_999;

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
  /** +1 on every `data` write. */
  version: number;
  /** Revived from the wire's ISO string, once, here. */
  createdAt: Date;
  updatedAt: Date;
  author: DocumentAuthor;
  // No `counters`, `marks` or `viewer` (removed in 0.33): civitai.com still sends the first
  // two as `{}` and `viewer` as `{ marks: [] }` / `null` for older SDKs, and this client
  // ignores them, as it ignores every field it does not name.
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
   * `[-]key | createdAt | updatedAt | <index>`; a leading `-` is descending. The server's
   * default is `key`. There is no sort by count: count a viewer-keyed collection by listing
   * it with `keyPrefix` set to `<parent>:`, and sort in the app.
   */
  sort?: string;
  /** Only documents the viewer authored. */
  author?: 'me';
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

/**
 * How a VIEWER-KEYED collection's keys are made (the manifest's `keyedBy`). The server derives
 * every key from the signed-in viewer, never from the request:
 *
 * - `viewer` — at most one document per viewer in the collection. Its key is an opaque digest.
 * - `parent+viewer` — at most one per viewer per PARENT key (a record, a model, …) the app names.
 *   Its key is `<parent>:<digest>`, so `list({ keyPrefix: `${parent}:` })` lists exactly one
 *   parent's documents and {@link StorageCollection.parentOf} reads the parent back.
 */
export type StorageKeyedBy = 'viewer' | 'parent+viewer';

/** Options for {@link StorageCollection.putMine} and {@link StorageCollection.deleteMine}. */
export interface ViewerKeyedOptions extends WriteOptions {
  /**
   * The parent key, on a `parent+viewer` collection only (a `viewer` collection refuses one,
   * `parent_not_allowed`). 1 to 96 characters of `[A-Za-z0-9._-]`, not only dots: the server
   * refuses anything else `invalid_request` with `details.reason: 'invalid_parent'`, after it has
   * checked the collection's mode. Only `''`, `.` and `..` (which no URL path can carry as a
   * segment) are refused here, before sending, with that same code and reason.
   */
  parent?: string;
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
   * VIEWER-KEYED collections (`keyedBy` in the manifest): the signed-in viewer's own document,
   * or `null` when they have none. `parent` names the parent key on a `parent+viewer`
   * collection and is omitted on a `viewer` one. Sends `GET …/:collection/@me[/:parent]`; the
   * key is derived by the server and never sent. An anonymous viewer is refused
   * `sign_in_required` (401), even though they may read the collection by key or by list. A
   * closed switch does not refuse a read; a host that cannot derive keys does (503
   * `service_unavailable`, `details.reason: 'viewer_keys_unconfigured'`).
   *
   * @example
   * ```ts
   * const vote = await votes.getMine(record.key); // null: not voted yet
   * ```
   */
  getMine(parent?: string, opts?: DocumentCallOptions): Promise<StorageDocument<T> | null>;
  /**
   * Create or replace the signed-in viewer's own document in a viewer-keyed collection, at the
   * key the server derives (`PUT …/:collection/@me[/:parent]` with `{ data, ifVersion? }`).
   * Exactly a {@link put} otherwise: `ifVersion: 0` writes only if the viewer has none yet, and
   * a shared write's scope (`apps:storage:publish`), trust gate, budget, schema, ownership and
   * moderation all apply (moderation scans `data` and the parent, never the derived key).
   *
   * Refused: `write_policy` (403, `details.reason: 'viewer_keyed_closed'`) while the
   * collection's switch is closed (`info()` reports it as `open: false`), and
   * `service_unavailable` (503, `'viewer_keys_unconfigured'`) while the host cannot derive keys.
   * {@link storageViewerKeyedRefusal} reads each one.
   */
  putMine(data: T, opts?: ViewerKeyedOptions): Promise<StorageDocument<T>>;
  /**
   * Delete the signed-in viewer's own document in a viewer-keyed collection
   * (`DELETE …/:collection/@me[/:parent][?ifVersion=N]`). Idempotent, as {@link delete}:
   * `deleted: false` means there was nothing to delete. Needs only `apps:storage`. Refused
   * while the switch is closed or keys cannot be derived, as {@link putMine} is.
   */
  deleteMine(opts?: ViewerKeyedOptions): Promise<{ deleted: boolean }>;
  /**
   * The parent key a `parent+viewer` document's key names (`<parent>:<digest>` → `parent`), or
   * `null` for any other key — a `viewer` collection's digest, an ordinary key. Pure: it only
   * reads the key. The digest is the server's and cannot be computed here, so to reach a
   * viewer's own document use {@link getMine}, never a key built by hand.
   */
  parentOf(key: string): string | null;
}

export type StorageIndexType = 'string' | 'number' | 'boolean' | 'time';

/** One declared collection, as the server reads the app's approved manifest. */
export interface StorageCollectionInfo {
  kind: string;
  visibility: 'private' | 'shared';
  /** Shared collections only. */
  write?: string;
  indexes: Record<string, StorageIndexType>;
  showAuthor: boolean;
  /** Present on a viewer-keyed collection only: how its keys are derived. */
  keyedBy?: StorageKeyedBy;
  /**
   * Present exactly when `keyedBy` is: whether `putMine` / `deleteMine` can land now. `false`
   * while the collection's switch is closed (a collection being migrated) or while the host
   * cannot derive keys; reads are unaffected.
   */
  open?: boolean;
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
   * A create or put in one of the source's SHARED collections also
   * needs the viewer's `apps:storage:publish` grant IN THE SOURCE APP (civitai/civitai#7586).
   * On `app.storage` the client asks the host for it by itself when the source refuses
   * for want of it: one prompt, then the same call ONCE more on the next host-pushed token
   * refresh, within 60 s. That push follows an Allow but can also be the host's routine
   * re-mint ("Not now" sends nothing), so the retry's own result is the authority. "Not
   * now" and a host that cannot prompt (only the app page does) reject with the first
   * `consent_required` (`source_publish_consent`); a refused retry rejects with ITS
   * refusal; nothing is asked or retried again. A delete never needs it.
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
  | 'schema_violation'
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
  /**
   * LOCAL, never sent by the server: `app.moderation.report` reached a civitai.com that does not
   * serve the report API (an older release without the route, or the app's host flag off).
   */
  | 'report_unavailable'
  /**
   * The app-data service (service mode, `BLOCK_INIT.appData`). `not_forwarded` (503): refused
   * before the write reached the store; the SDK resends it by itself. `outcome_unknown` (504): the
   * write was sent and its answer lost, so it may have landed; never resent (a keyed `put` with
   * `ifVersion` is the only safe retry). `floor_not_met` (503): the service has not yet seen a write
   * to this collection this client was acknowledged for; the SDK retries it up to 3 times within
   * 5 s, then surfaces it. `block_token_spent` (401): the SDK reads once more with a fresh block
   * token, and surfaces this code if that one is spent too. `not_supported_here`: a list query the
   * service does not serve, or an import (501). `stale_major` (409): a schema major other than the
   * current one.
   */
  | 'not_forwarded'
  | 'outcome_unknown'
  | 'floor_not_met'
  | 'block_token_spent'
  | 'not_supported_here'
  | 'stale_major'
  /** The app-data service: a read the stream cannot answer for this token (401). */
  | 'token_not_exchangeable'
  | 'invalid_token'
  | 'exchange_refused'
  | 'refused'
  | 'revoked'
  /** The app-data service: a read the stream cannot answer now (503, with `Retry-After`). */
  | 'capacity'
  | 'token_capacity'
  | 'cooling_down'
  | 'not_live'
  | 'stalled'
  | 'ended'
  | 'closed'
  | 'failed'
  | 'block_cache_full'
  | 'unkeyed'
  | 'not_resolved'
  | 'unverifiable'
  /** The app-data service: a collection its private feed does not serve (501). */
  | 'not_private'
  | (string & {});

/**
 * A refusal from the document store, in its one envelope `{ code, message, error, details? }`.
 * Branch on `code`; `status` and `body` are {@link ApiError}'s, as sent.
 */
export class StorageError extends ApiError {
  readonly code: StorageErrorCode;
  /**
   * E.g. `currentVersion`, `reason`, `category`, `ceiling`, `bucket`, `retryAfter`. On
   * `schema_violation` (400: a document's `data` does not match its collection's declared
   * `schema`): `collection`, `pointer` (the first failing JSON pointer into `data`, `""` for
   * the root) and `keyword` (the schema keyword it failed, e.g. `required`).
   */
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
 * `details.reason` of a `not_eligible` that only an import gets — every one the server's
 * `resolveImportAccess` emits (civitai/civitai@86334b30): a review (run-for-real) token, a
 * dev token (a dev-tunnel preview) or a hub OAuth bearer reaches no other app;
 * `source_not_approved` — no approved app holds the source blockId;
 * `import_source_rating` — the source is mature-rated and this host may not show it;
 * `import_namespace` — the token is outside the published namespace.
 *
 * OPEN-ENDED: a newer server may add a reason, and it reaches the app as it is (see
 * {@link storageImportRefusal}), so a `switch` over this type keeps a `default` branch.
 */
export type StorageImportNotEligibleReason =
  | 'import_in_review'
  | 'import_dev_token'
  | 'import_hub_token'
  | 'source_not_approved'
  | 'import_source_rating'
  | 'import_namespace'
  | (string & {});

const IMPORT_NOT_ELIGIBLE: ReadonlySet<string> = new Set<StorageImportNotEligibleReason>([
  'import_in_review',
  'import_dev_token',
  'import_hub_token',
  'source_not_approved',
  'import_source_rating',
  'import_namespace',
]);

/**
 * The `not_eligible` reasons the server gives for the CONSUMER itself, which a call through
 * an import can get too and which are not import refusals: the app's own approval and run
 * gate (civitai `resolveStorageAccess`, the block-scope middleware) and the viewer's
 * shared-write trust gate (`sharedWriteTrustRefusal`), as of civitai/civitai@86334b30.
 */
const CONSUMER_NOT_ELIGIBLE: ReadonlySet<string> = new Set([
  'apps_disabled',
  'review_inactive',
  'author_required',
  'app_not_approved',
  'instance_revoked',
  'context_binding',
  'ineligible',
  'restricted',
  'onboarding_incomplete',
  'email_unverified',
  'account_too_new',
  'membership_required',
]);

/**
 * The refusals of calls that carried `?from=` (set where the reply is read). A
 * `not_eligible` carries no `from`, so this is how {@link storageImportRefusal} tells an
 * import's unknown reason from this app's own.
 */
const refusedThroughImport = new WeakSet<StorageError>();

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
 *   `from`: a create or put in one of the SOURCE app's shared
 *   collections needs the viewer's publish consent IN THE SOURCE APP. An import grant is
 *   not that consent. `app.storage` has ALREADY asked the host for it (see
 *   {@link CollectionOptions.from}) by the time this reaches the app, so it means "not
 *   now", a host that cannot prompt, or a refusal after the grant: do not loop. An app
 *   may ask again later on the viewer's own action with
 *   `app.requestGrants(['apps:storage:publish'], { from })`.
 * - `read_only` — 403 `write_policy` (`reason: 'import_read_only'`): the import's `access`
 *   is `read`.
 * - `not_declared` — 403 `import_not_declared`: this app's manifest does not import that
 *   collection from `from` (`collection` is absent when `from` is this app itself).
 * - `not_exportable` — 403 `not_exportable`: the source declares the collection
 *   `exportable: false`.
 * - `source_collection_not_declared` — 404 `collection_not_declared` with a `from`: the
 *   source app declares no such collection.
 * - `not_eligible` — 403 `not_eligible` with an import reason: the token cannot import at
 *   all (a dev, hub or review token, or one outside the published namespace), no approved
 *   app holds `from`, or this host may not show it (`import_source_rating`). A reason this
 *   SDK does not list, on a call through an import, is returned as it is — unless it is
 *   one the server gives for this app or viewer themselves (`app_not_approved`, a trust
 *   reason such as `account_too_new`), which is `null` like any non-import refusal.
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
 * same codes on this app's OWN collections, which carry no `from`). Reads the server's
 * `code` and `details`, and — for a `not_eligible` reason it does not list — whether the
 * refused call went through an import.
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
    case 'not_eligible': {
      const reason = d.reason;
      if (typeof reason !== 'string') return null;
      if (IMPORT_NOT_ELIGIBLE.has(reason)) return { kind: 'not_eligible', reason };
      // A newer server's reason: an import's only when the call was one.
      return refusedThroughImport.has(error) && !CONSUMER_NOT_ELIGIBLE.has(reason) ? { kind: 'not_eligible', reason } : null;
    }
    default:
      return null;
  }
}

/**
 * Why a VIEWER-KEYED call was refused, as the server says it (civitai/civitai#10216):
 *
 * - `viewer_keyed` — 400 `invalid_request`: a `create`, or a `put` / `delete` by key, on a
 *   viewer-keyed collection. Use `putMine` / `deleteMine`.
 * - `not_viewer_keyed` — 400: a `…Mine` call on a collection that declares no `keyedBy`.
 * - `parent_required` — 400: a `…Mine` call without `parent` on a `parent+viewer` collection.
 * - `parent_not_allowed` — 400: a `parent` on a `viewer` collection.
 * - `invalid_parent` — 400: a `parent` outside `[A-Za-z0-9._-]{1,96}`, or only dots, judged by the
 *   server after the mode. This client refuses only `''`, `.` and `..` before sending (no URL
 *   carries them), with the server's code, reason and `details.collection`.
 * - `viewer_keyed_closed` — 403 `write_policy`: a `putMine` / `deleteMine` while the
 *   collection's switch is closed (`info()` says `open: false`). Reads still work.
 * - `viewer_keys_unconfigured` — 503 `service_unavailable`: the host cannot derive keys at all;
 *   every `…Mine` call, reads included, is refused until it can.
 * - `sign_in_required` — 401: an anonymous viewer on any `…Mine` call (they have no document of
 *   their own to address).
 */
export type StorageViewerKeyedRefusalReason =
  | 'viewer_keyed'
  | 'not_viewer_keyed'
  | 'parent_required'
  | 'parent_not_allowed'
  | 'invalid_parent'
  | 'viewer_keyed_closed'
  | 'viewer_keys_unconfigured'
  | 'sign_in_required';

export interface StorageViewerKeyedRefusal {
  reason: StorageViewerKeyedRefusalReason;
  /** The collection, when the server named it. */
  collection?: string;
}

/** Each refusal's (code, `details.reason`) pair as the server sends it. */
const VIEWER_KEYED_CODE: Record<string, StorageErrorCode> = {
  viewer_keyed: 'invalid_request',
  not_viewer_keyed: 'invalid_request',
  parent_required: 'invalid_request',
  parent_not_allowed: 'invalid_request',
  invalid_parent: 'invalid_request',
  viewer_keyed_closed: 'write_policy',
  viewer_keys_unconfigured: 'service_unavailable',
};

/**
 * The refusals of `…Mine` calls (set where the reply is read). `sign_in_required` carries no
 * reason, so this is how {@link storageViewerKeyedRefusal} tells an anonymous `…Mine` call from
 * any other anonymous refusal.
 */
const refusedAtMine = new WeakSet<StorageError>();

/**
 * The viewer-keyed refusal `error` is, typed — or `null` for anything else. Reads the server's
 * `code` and `details.reason` (both must match: a `reason` under another code is not this), and
 * for `sign_in_required`, whether the refused call was a `…Mine` call.
 */
export function storageViewerKeyedRefusal(error: unknown): StorageViewerKeyedRefusal | null {
  if (!(error instanceof StorageError)) return null;
  const collection = typeof error.details?.collection === 'string' ? error.details.collection : undefined;
  const at = (reason: StorageViewerKeyedRefusalReason): StorageViewerKeyedRefusal =>
    collection === undefined ? { reason } : { reason, collection };
  if (error.code === 'sign_in_required') return refusedAtMine.has(error) ? at('sign_in_required') : null;
  const reason = error.details?.reason;
  if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(VIEWER_KEYED_CODE, reason)) return null;
  return VIEWER_KEYED_CODE[reason] === error.code ? at(reason as StorageViewerKeyedRefusalReason) : null;
}

/** `<parent>:<digest>` → `parent`; `null` for every other key. Internal (`collection().parentOf`). */
export function parentOfKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const colon = key.indexOf(':');
  if (colon < 0) return null;
  const parent = key.slice(0, colon);
  return PARENT.test(parent) && !DOT_ONLY.test(parent) && DIGEST.test(key.slice(colon + 1)) ? parent : null;
}

/**
 * The `@me` path. A parent is refused before sending ONLY when no URL can carry it as one
 * segment — not a string, `''` (the segment collapses, reaching `@me` alone), `.` or `..` (path
 * steps) — because then the server would answer a different request. Every other parent is
 * sent, encoded, and the SERVER judges it in its own order: the collection's mode first
 * (`not_viewer_keyed`, `parent_not_allowed`, `parent_required`), then the grammar
 * (`invalid_parent`). This client does not know the mode, so it cannot reproduce that order.
 */
function minePath(collection: string, parent: unknown, records = `${BASE}/${collection}`): string {
  const base = `${records}/${MINE}`;
  if (parent === undefined) return base;
  if (typeof parent !== 'string' || parent === '' || parent === '.' || parent === '..') {
    const message = `parent ${JSON.stringify(parent)} cannot be addressed in a URL path: it must be 1–96 characters of [A-Za-z0-9._-], not only dots (refused before sending)`;
    const details = { reason: 'invalid_parent', collection };
    throw new StorageError(400, 'invalid_request', message, { code: 'invalid_request', message, error: message, details }, details);
  }
  return `${base}/${encodeURIComponent(parent)}`;
}

/**
 * The server's sentence for a DOCUMENT miss (`404 not_found`, "document not found"). The same
 * code also answers a path the server has no route for (an older civitai.com without `@me`:
 * "no such storage route"), and the envelope carries no other field to tell them apart. So
 * `getMine` reads a 404 as "none yet" only on exactly this sentence; any other 404, a reworded
 * one included, surfaces as an error — loud, never a false "not voted".
 */
const DOCUMENT_NOT_FOUND = 'document not found';

const isDocumentMiss = (error: StorageError): boolean =>
  error.status === 404 && error.code === 'not_found' && isRecord(error.body) && error.body.message === DOCUMENT_NOT_FOUND;

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
  /**
   * How to ask the viewer for a grant — the session's `requestGrants`. Given, a write
   * through an import that the source refuses for want of the viewer's publish grant
   * THERE asks for it (`['apps:storage:publish']` with `{ from }`) and, granted, sends
   * the same call once more (see {@link CollectionOptions.from}). Absent, that refusal
   * reaches the caller as it is.
   */
  requestGrants?: (scopes: readonly Scope[], opts: GrantOptions) => Promise<boolean>;
  /**
   * SERVICE MODE: send this app's own collections and `info` to the app-data service instead of
   * the site — `http` is a client for the service's base URL, `slug` the app's blockId. A
   * collection opened through an import (`{ from }`) keeps the site's routes, and so does every call
   * while `active()` is false. Absent, nothing changes. See {@link DocumentStorage} for what a reply carries there.
   */
  service?: AppDataServiceOptions;
}

/**
 * How long a write through an import waits for the viewer to answer the source's
 * publish prompt. "Not now" sends nothing, so the wait must end by itself; the same
 * bound as `@civitai/blocks-react`'s consent wait.
 */
const SOURCE_PUBLISH_CONSENT_WAIT_MS = 60_000;

/** The source's refusal of THIS import's write for want of the viewer's publish grant there. */
function isSourcePublishRefusal(error: unknown, from: string): boolean {
  return (
    error instanceof StorageError &&
    error.code === 'consent_required' &&
    error.details?.scope === 'apps:storage:publish' &&
    error.details?.from === from
  );
}

/**
 * `attempt`; on the source's publish refusal, ask once and, granted, `attempt` ONCE more.
 * The refused call wrote nothing (the server refuses before the write), so the retry is
 * the first write, not a second one. A "no" and the wait running out surface the first
 * refusal, a refused retry surfaces ITS refusal (the second), and a caller abort during
 * the wait surfaces the abort.
 */
export async function withSourcePublishGrant<R>(
  ask: DocumentStorageOptions['requestGrants'],
  from: string | undefined,
  signal: AbortSignal | undefined,
  attempt: () => Promise<R>,
): Promise<R> {
  try {
    return await attempt();
  } catch (error) {
    if (ask === undefined || from === undefined || signal?.aborted || !isSourcePublishRefusal(error, from)) throw error;
    const waiting = new AbortController();
    const stop = () => waiting.abort();
    const timer = setTimeout(stop, SOURCE_PUBLISH_CONSENT_WAIT_MS);
    signal?.addEventListener('abort', stop, { once: true });
    let granted = false;
    try {
      granted = await ask(['apps:storage:publish'], { from, signal: waiting.signal });
    } catch {
      // The wait ran out or the caller left: no grant.
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
    // Work cancelled on purpose is never resurrected by a grant that came later.
    if (signal?.aborted) throw signal.reason;
    if (!granted) throw error;
    return attempt();
  }
}

/** A code as the app-data service spells one in `error` (its read refusals carry no `code`). */
const SERVICE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * An {@link ApiError} whose body is the store's envelope becomes a {@link StorageError}; anything
 * else passes through. `service`: the app-data service's answer, whose read refusals put the code in
 * `error` (`{ error: 'floor_not_met', message }`); there, an `error` that is a code is read as one.
 * On the site `error` is a sentence and is never read as a code.
 */
function toStorageError(error: unknown, options: DocumentStorageOptions = {}, service = false): unknown {
  if (!(error instanceof ApiError) || error instanceof StorageError) return error;
  const body = error.body;
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return error;
  const fields = body as Record<string, unknown>;
  const { message, details } = fields;
  const code =
    typeof fields.code === 'string'
      ? fields.code
      : service && typeof fields.error === 'string' && SERVICE_CODE.test(fields.error)
        ? fields.error
        : undefined;
  if (code === undefined) return error;
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

/** How a storage-envelope call is sent; internal, shared with the report API's client. */
export type StorageCall = <R>(
  method: string,
  path: string,
  opts?: { query?: Query; body?: unknown; signal?: AbortSignal },
  how?: { throughImport?: boolean; mine?: boolean },
) => Promise<R>;

/**
 * One call in the store's envelope: a refusal becomes a {@link StorageError}, remembered as a
 * call through an import (a `?from=`, or `how.throughImport`) or a `…Mine` call where it was one.
 * Internal: the document store and the report API's client both send through it.
 */
export function createStorageCall(http: Http, options: DocumentStorageOptions = {}, service = false): StorageCall {
  return async (method, path, opts = {}, how = {}) => {
    try {
      return await http(method, path, opts);
    } catch (error) {
      const refused = toStorageError(error, options, service);
      if (refused instanceof StorageError) {
        if (how.throughImport || typeof opts.query?.from === 'string') refusedThroughImport.add(refused);
        if (how.mine) refusedAtMine.add(refused);
      }
      throw refused;
    }
  };
}

export function createDocumentStorage(http: Http, options: DocumentStorageOptions = {}): DocumentStorage {
  const ask = options.requestGrants;
  const call = createStorageCall(http, options);

  const service = options.service ? serviceStore(options.service, options) : undefined;

  return {
    collection<T extends object = Record<string, unknown>>(name: string, options?: CollectionOptions): StorageCollection<T> {
      // Resolved per call, inside each async operation, so a bad name rejects that
      // call rather than throwing from `collection()` itself.
      const coll = () => collectionSegment(name);
      // `?from=` on EVERY call when importing; nothing added otherwise. Also per call.
      const q = (query?: Query): Query | undefined => withImport(options, query);
      const docPath = (key: string) => `${BASE}/${coll()}/${segment('key', key)}`;
      const doc = (reply: unknown, op: string) => toDocument<T>(reply, `${name}.${op}`);
      // A write that may need the viewer's publish grant in the import's source. Only
      // a string `from` is an import; any other value is refused before sending.
      const from = typeof options?.from === 'string' ? options.from : undefined;
      const authoring = <R>(signal: AbortSignal | undefined, attempt: () => Promise<R>) =>
        withSourcePublishGrant(ask, from, signal, attempt);

      const site: StorageCollection<T> = {
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
          return authoring(signal, async () =>
            doc(await call('PUT', docPath(key), { query: q(), body: { data, ifVersion }, signal }), 'put'),
          );
        },

        async create(data, { signal } = {}) {
          return authoring(signal, async () =>
            doc(await call('POST', `${BASE}/${coll()}`, { query: q(), body: { data }, signal }), 'create'),
          );
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

        // VIEWER-KEYED (`@me`): the server derives the key from the verified viewer, so none is
        // sent. Every call carries `?from=` when importing, as any collection call does.
        async getMine(parent, { signal } = {}) {
          try {
            return doc(await call('GET', minePath(coll(), parent), { query: q(), signal }, { mine: true }), 'getMine');
          } catch (error) {
            // Only the server's exact document miss is "none yet" (see DOCUMENT_NOT_FOUND).
            if (error instanceof StorageError && isDocumentMiss(error)) return null;
            throw error;
          }
        },

        async putMine(data, { parent, ifVersion, signal } = {}) {
          return authoring(signal, async () =>
            doc(
              await call('PUT', minePath(coll(), parent), { query: q(), body: { data, ifVersion }, signal }, { mine: true }),
              'putMine',
            ),
          );
        },

        async deleteMine({ parent, ifVersion, signal } = {}) {
          const reply = await call<{ deleted?: unknown }>(
            'DELETE',
            minePath(coll(), parent),
            { query: q({ ifVersion }), signal },
            { mine: true },
          );
          if (typeof reply?.deleted !== 'boolean') {
            throw new CivitaiError(`storage ${name}.deleteMine: reply carried no \`deleted\` flag`);
          }
          return { deleted: reply.deleted };
        },

        parentOf: (key) => parentOfKey(key),
      };
      // Only this app's own collection moves: an import (any `from` key, or options that are not an
      // object, which the site path refuses) keeps the site route.
      const own = options === undefined || (isRecord(options) && !Object.prototype.hasOwnProperty.call(options, 'from'));
      return service && own ? service.collection<T>(name, site) : site;
    },

    async info(opts = {}) {
      refuseInfoImport(opts);
      const reply = service?.active() ? await service.info(opts.signal) : await call<StorageInfo>('GET', BASE, { signal: opts.signal });
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

/** The sorts the service serves; a list with any other, or with `where`, goes to the site. */
const SERVICE_SORTS: ReadonlySet<string> = new Set(['key', '-key']);
/** The store's list bounds (`listLimitDefault`, `listLimitMax`), applied here to a private answer. */
const LIST_LIMIT_DEFAULT = 25;
const LIST_LIMIT_MAX = 100;
/** The store's key-sort cursor, `k<a|d>~~<key>`: what a private page's `nextCursor` is made of. */
const KEY_CURSOR = /^k([ad])~~([A-Za-z0-9._:-]{1,128})$/;

/** Refused before sending, with the store's code for a bad list query. */
function invalidList(message: string): StorageError {
  return new StorageError(400, 'invalid_request', message, { code: 'invalid_request', message, error: message });
}

/** The service's store, while {@link AppDataServiceOptions.active} says so. */
export interface AppDataServiceOptions {
  http: Http;
  slug: string;
  /**
   * Read before EVERY call: `false` sends the call to the site instead. The app client passes
   * "the token is a block token now", so a host that switches the frame to an OAuth token
   * mid-session moves storage back to the site, which is the only store that serves one.
   */
  active?: () => boolean;
}

/**
 * SERVICE MODE (`BLOCK_INIT.appData`): this app's own collections and `info` through the app-data
 * service, while the frame holds a block token. Same calls, same bodies, same {@link StorageError}s;
 * what differs is the service's:
 *
 * - READ-YOUR-WRITES: every write answer names its `seq`. Each COLLECTION keeps the highest `seq`
 *   a write to it was answered with, and a read of that collection sends it as `?minSeq=`. The
 *   floor is per collection because the service meets floors per collection: a floor raised by
 *   another collection's write would hold this one's reads at `503 floor_not_met` until the
 *   service's next poll. Only write answers raise it; a read's never does.
 * - RETRIES (`createServiceFetch`): a read's `503` with `Retry-After` is waited out (not one whose
 *   code says waiting cannot help), a write is resent only on `503 not_forwarded`, and
 *   `504 outcome_unknown` is never resent. A `401 block_token_spent` is read again with a fresh
 *   block token (the JSON client's refresh).
 * - ANSWERS: a read answers `{ source, item }` or `{ source, items[, nextCursor] }`. A PRIVATE
 *   collection's item carries only `key` and `data`: it reads as the viewer's own document
 *   (`author: { kind: 'user', isViewer: true }`) at `version: 0` with both timestamps at the
 *   epoch. `0` is never a stored document's version, so an `ifVersion` built from it is refused
 *   `version_conflict`, never a blind overwrite. A SHARED item's author carries `isViewer` and no
 *   `kind`: it reads as `{ kind: 'user', isViewer }`.
 * - LISTS: `keyPrefix`, `author`, `sort` (`key` / `-key`), `limit` and `cursor` go to the service.
 *   A private collection's answer is the whole collection, so it is paged HERE: key order, `limit`
 *   (the store's default 25, at most 100), and a key cursor (`ka~~<key>` / `kd~~<key>`, the store's
 *   own shape). TRANSITIONAL: a list with `where` or another sort goes to the site, which serves
 *   them; the service does not yet.
 * - `getMany` has no route there: it is keyed gets, at most {@link SERVICE_GET_MANY_CONCURRENCY}
 *   at once, in the order of `keys`; the first failure stops it.
 */
function serviceStore(service: AppDataServiceOptions, options: DocumentStorageOptions) {
  const call = createStorageCall(service.http, options, true);
  const app = `${SERVICE_BASE}/${encodeURIComponent(service.slug)}`;
  const active = () => (service.active ? service.active() : true);
  // The read-your-writes floors: per collection, the highest `seq` a write to it was answered with.
  const floors = new Map<string, number>();

  return {
    active,

    collection<T extends object>(name: string, site: StorageCollection<T>): StorageCollection<T> {
      const records = () => `${app}/${SERVICE_COLLECTIONS}/${collectionSegment(name)}/${SERVICE_RECORDS}`;
      const docPath = (key: string) => `${records()}/${segment('key', key)}`;
      const doc = (reply: unknown, op: string) => toServiceDocument<T>(reply, `${name}.${op}`);
      const acknowledged = <R>(reply: R): R => {
        const seq = isRecord(reply) ? reply.seq : undefined;
        if (typeof seq === 'number' && Number.isInteger(seq) && seq > (floors.get(name) ?? 0) && seq <= MAX_SEQ) {
          floors.set(name, seq);
        }
        return reply;
      };
      const floored = (query: Query = {}): Query => {
        const floor = floors.get(name) ?? 0;
        return floor > 0 ? { ...query, minSeq: floor } : query;
      };
      const item = (reply: unknown, op: string) => {
        if (!isRecord(reply) || !Object.prototype.hasOwnProperty.call(reply, 'item')) {
          throw new CivitaiError(`storage ${name}.${op}: reply carried no \`item\``);
        }
        return doc(reply.item, op);
      };
      const get = async (key: string, signal: AbortSignal | undefined) => {
        try {
          return item(await call('GET', docPath(key), { query: floored(), signal }), 'get');
        } catch (error) {
          if (error instanceof StorageError && error.code === 'not_found') return null;
          throw error;
        }
      };
      const deleted = (reply: { deleted?: unknown } | undefined, op: string) => {
        if (typeof reply?.deleted !== 'boolean') throw new CivitaiError(`storage ${name}.${op}: reply carried no \`deleted\` flag`);
        return { deleted: reply.deleted };
      };

      const viaService: Partial<StorageCollection<T>> = {
        get: (key, { signal } = {}) => get(key, signal),

        async getMany(keys, { signal } = {}) {
          const all = [...keys];
          const out: (StorageDocument<T> | null)[] = all.map(() => null);
          let next = 0;
          let failed = false;
          const worker = async () => {
            while (next < all.length && !failed) {
              const i = next++;
              try {
                out[i] = await get(all[i]!, signal);
              } catch (error) {
                failed = true;
                throw error;
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(SERVICE_GET_MANY_CONCURRENCY, all.length) }, worker));
          return out;
        },

        async put(key, data, { ifVersion, signal } = {}) {
          return doc(acknowledged(await call('PUT', docPath(key), { body: { data, ifVersion }, signal })), 'put');
        },

        async create(data, { signal } = {}) {
          return doc(acknowledged(await call('POST', records(), { body: { data }, signal })), 'create');
        },

        async delete(key, { ifVersion, signal } = {}) {
          const reply = acknowledged(await call<{ deleted?: unknown }>('DELETE', docPath(key), { query: { ifVersion }, signal }));
          return deleted(reply, 'delete');
        },

        async list(query = {}, opts = {}) {
          // TRANSITIONAL: what the service does not serve yet is the site's.
          const where = query.where !== undefined && Object.keys(query.where).length > 0;
          if (where || (query.sort !== undefined && !SERVICE_SORTS.has(query.sort))) {
            return site.list(query, opts);
          }
          const reply = await call<{ items?: unknown; nextCursor?: unknown }>('GET', records(), {
            query: floored({
              sort: query.sort,
              author: query.author,
              keyPrefix: query.keyPrefix,
              limit: query.limit,
              cursor: query.cursor,
            }),
            signal: opts.signal,
          });
          if (!Array.isArray(reply?.items)) throw new CivitaiError(`storage ${name}.list: reply carried no \`items\` array`);
          const items = reply.items.map((it) => doc(it, 'list'));
          if (Object.prototype.hasOwnProperty.call(reply, 'nextCursor')) {
            if (reply.nextCursor !== null && typeof reply.nextCursor !== 'string') {
              throw new CivitaiError(`storage ${name}.list: reply carried no \`nextCursor\``);
            }
            return { items, nextCursor: reply.nextCursor };
          }
          // A private collection's answer: every document, in no promised order. Paged here as the
          // store pages a key list.
          return pagePrivate(items, query, name);
        },

        async getMine(parent, { signal } = {}) {
          try {
            const path = minePath(collectionSegment(name), parent, records());
            return item(await call('GET', path, { query: floored(), signal }, { mine: true }), 'getMine');
          } catch (error) {
            if (error instanceof StorageError && isDocumentMiss(error)) return null;
            throw error;
          }
        },

        async putMine(data, { parent, ifVersion, signal } = {}) {
          const path = minePath(collectionSegment(name), parent, records());
          return doc(acknowledged(await call('PUT', path, { body: { data, ifVersion }, signal }, { mine: true })), 'putMine');
        },

        async deleteMine({ parent, ifVersion, signal } = {}) {
          const path = minePath(collectionSegment(name), parent, records());
          const reply = acknowledged(await call<{ deleted?: unknown }>('DELETE', path, { query: { ifVersion }, signal }, { mine: true }));
          return deleted(reply, 'deleteMine');
        },
      };

      // Each moved method decides per CALL: the token can change kind mid-session.
      const out: Record<string, unknown> = { ...site };
      for (const [method, viaServiceFn] of Object.entries(viaService) as [string, (...args: unknown[]) => unknown][]) {
        const siteFn = (site as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!;
        out[method] = (...args: unknown[]) => (active() ? viaServiceFn(...args) : siteFn(...args));
      }
      return out as unknown as StorageCollection<T>;
    },

    info: (signal: AbortSignal | undefined) => call<StorageInfo>('GET', `${app}/${SERVICE_INFO}`, { signal }),
  };
}

/** One page of a private collection's whole answer, as the store pages a key list. */
function pagePrivate<T extends object>(
  items: StorageDocument<T>[],
  query: DocumentListQuery,
  name: string,
): DocumentPage<T> {
  const desc = query.sort === '-key';
  const limit = query.limit ?? LIST_LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) {
    throw invalidList(`storage ${name}.list: limit must be an integer from 1 to ${LIST_LIMIT_MAX}`);
  }
  let after: string | undefined;
  if (query.cursor !== undefined) {
    const m = KEY_CURSOR.exec(query.cursor);
    if (m === null || (m[1] === 'd') !== desc) throw invalidList(`storage ${name}.list: invalid cursor`);
    after = m[2];
  }
  const sorted = [...items].sort((a, b) => (a.key === b.key ? 0 : (a.key < b.key) !== desc ? -1 : 1));
  const rest = after === undefined ? sorted : sorted.filter((d) => (desc ? d.key < after! : d.key > after!));
  const page = rest.slice(0, limit);
  const nextCursor = rest.length > limit ? `k${desc ? 'd' : 'a'}~~${page[page.length - 1]!.key}` : null;
  return { items: page, nextCursor };
}

/** Refused with the code the server gives an unusable `from`, so a caller branches once. */
export function invalidFrom(message: string, from: unknown): StorageError {
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

function toDocument<T extends object>(reply: unknown, op: string): StorageDocument<T> {
  if (!isRecord(reply) || typeof reply.key !== 'string' || !isRecord(reply.data) || typeof reply.version !== 'number') {
    throw new CivitaiError(`storage ${op}: reply is not a document`);
  }
  // Every field copied by name: the server's leftover `counters`, `marks` and `viewer` (sent
  // empty for SDKs before 0.33) and anything a later server adds never reach a reader.
  return {
    key: reply.key,
    data: reply.data as T,
    version: reply.version,
    createdAt: toDate(reply.createdAt, op, 'createdAt'),
    updatedAt: toDate(reply.updatedAt, op, 'updatedAt'),
    author: toAuthor(reply.author, op),
  };
}

/**
 * A document as the app-data service answers one: a write's answer is the store's own document;
 * a read's item carries what its stream holds. A field the item does not carry reads as
 * {@link serviceStore} says (a private item: the viewer's own, version `0`, epoch timestamps). A
 * field it DOES carry is checked as {@link toDocument} checks it.
 */
function toServiceDocument<T extends object>(reply: unknown, op: string): StorageDocument<T> {
  if (!isRecord(reply) || typeof reply.key !== 'string' || !isRecord(reply.data)) {
    throw new CivitaiError(`storage ${op}: reply is not a document`);
  }
  const carries = (field: string) => reply[field] !== undefined;
  if (carries('version') && typeof reply.version !== 'number') throw new CivitaiError(`storage ${op}: reply is not a document`);
  return {
    key: reply.key,
    data: reply.data as T,
    version: carries('version') ? (reply.version as number) : 0,
    createdAt: carries('createdAt') ? toDate(reply.createdAt, op, 'createdAt') : new Date(0),
    updatedAt: carries('updatedAt') ? toDate(reply.updatedAt, op, 'updatedAt') : new Date(0),
    author: carries('author') ? toServiceAuthor(reply.author, op) : { kind: 'user', isViewer: true },
  };
}

/** The service's shared items name their author `{ isViewer }`, with no `kind`: a user. */
function toServiceAuthor(value: unknown, op: string): DocumentAuthor {
  if (isRecord(value) && value.kind === undefined && typeof value.isViewer === 'boolean') {
    return typeof value.username === 'string'
      ? { kind: 'user', isViewer: value.isViewer, username: value.username }
      : { kind: 'user', isViewer: value.isViewer };
  }
  return toAuthor(value, op);
}
