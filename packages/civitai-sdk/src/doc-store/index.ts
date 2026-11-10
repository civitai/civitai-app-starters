import { CivitaiError } from '../core/errors.js';
import { ApiError, type Http, type Query } from '../http/index.js';
import type { GrantOptions, Scope } from '../session/index.js';

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

/**
 * Add `by` to ONE declared counter: `{ $inc: { plays: 1 } }`. `by` is required (the
 * wire has no default), so `{ $inc: { plays: undefined } }` does not type-check; the
 * server takes an integer from 1 to 100. The type cannot say "exactly one counter":
 * naming two is refused `invalid_request` (`malformed_operator`).
 */
export interface StorageIncrementOp {
  $inc: Record<string, number>;
  $mark?: never;
  $unmark?: never;
}

/** Set the viewer's mark: `{ $mark: 'vote' }` — a declared mark, or the built-in `report`. */
export interface StorageMarkOp {
  $mark: string;
  $inc?: never;
  $unmark?: never;
}

/** Remove the viewer's mark: `{ $unmark: 'vote' }`. A `report` cannot be withdrawn. */
export interface StorageUnmarkOp {
  $unmark: string;
  $inc?: never;
  $mark?: never;
}

/**
 * ONE update operator for {@link StorageCollection.update}. Each member forbids the
 * other two, so a second operator is a type error, and an unknown one is an excess
 * property.
 */
export type StorageUpdateOp = StorageIncrementOp | StorageMarkOp | StorageUnmarkOp;

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
   * Apply ONE update operator to a shared document — `PATCH …/:collection/:key` with
   * the operator as the body. A tally never changes `data` or `version`.
   *
   * - `{ $inc: { [counter]: by } }` adds `by` to a declared counter and resolves
   *   `{ value }`, the new total. In a `write: "none"` collection the first increment
   *   of an absent key creates the document.
   * - `{ $mark: name }` sets the viewer's mark (a declared mark, or the built-in
   *   `report`) and resolves `{ marked: true, count }`. Idempotent. `count` is absent
   *   for `report`, whose count is never exposed.
   * - `{ $unmark: name }` removes it and resolves `{ marked: false, count }`.
   *   Idempotent. A `report` cannot be withdrawn: the server refuses it
   *   `invalid_request` (400) for every caller.
   *
   * A body the server cannot read as one operator is refused `invalid_request`, with
   * `details.reason` saying why (`empty_patch`, `unknown_operator`, `multiple_operators`,
   * `merge_patch_unsupported` or `malformed_operator`).
   *
   * Needs a civitai.com that serves the PATCH route (civitai/civitai#8292); the
   * deprecated methods below keep their own routes and do not.
   *
   * @example
   * ```ts
   * await plays.update('model-123', { $inc: { plays: 1 } }); // { value }
   * await requests.update('r1', { $mark: 'vote' }); // { marked: true, count }
   * await requests.update('r1', { $unmark: 'vote' }); // { marked: false, count }
   * ```
   */
  update(key: string, op: StorageIncrementOp, opts?: DocumentCallOptions): Promise<{ value: number }>;
  update(key: string, op: StorageMarkOp, opts?: DocumentCallOptions): Promise<{ marked: true; count?: number }>;
  update(key: string, op: StorageUnmarkOp, opts?: DocumentCallOptions): Promise<{ marked: false; count?: number }>;
  /** An operator chosen at run time; the reply is the one its operator gives. */
  update(
    key: string,
    op: StorageUpdateOp,
    opts?: DocumentCallOptions,
  ): Promise<{ value: number } | { marked: boolean; count?: number }>;
  /**
   * Add `by` (the server's default when omitted) to a declared counter of a shared document. In a
   * `write: "none"` collection the first increment of an absent key creates the
   * document. Sends `POST …/:key/counters/:counter`, the deprecated per-tally route.
   *
   * @deprecated Use {@link StorageCollection.update} with `{ $inc: { [counter]: by } }`.
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
   * never exposed. Sends `PUT …/:key/marks/:name`, the deprecated per-tally route.
   *
   * @deprecated Use {@link StorageCollection.update} with `{ $mark: name }`.
   */
  mark(key: string, name: string, opts?: DocumentCallOptions): Promise<{ marked: true; count?: number }>;
  /**
   * Remove the viewer's mark. Idempotent. A `report` cannot be withdrawn: the
   * server refuses it `invalid_request` (400) for every caller. Sends
   * `DELETE …/:key/marks/:name`, the deprecated per-tally route.
   *
   * @deprecated Use {@link StorageCollection.update} with `{ $unmark: name }`.
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
   * A create, put, counter, mark or unmark in one of the source's SHARED collections also
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
 *   `from`: a create, put, counter, mark or unmark in one of the SOURCE app's shared
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
async function withSourcePublishGrant<R>(
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
  const ask = options.requestGrants;
  const call = async <R>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<R> => {
    try {
      return await http<R>(method, path, opts);
    } catch (error) {
      const refused = toStorageError(error, options);
      if (refused instanceof StorageError && typeof opts.query?.from === 'string') refusedThroughImport.add(refused);
      throw refused;
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
      // A write that may need the viewer's publish grant in the import's source. Only
      // a string `from` is an import; any other value is refused before sending.
      const from = typeof options?.from === 'string' ? options.from : undefined;
      const authoring = <R>(signal: AbortSignal | undefined, attempt: () => Promise<R>) =>
        withSourcePublishGrant(ask, from, signal, attempt);
      // `update`: ONE update operator, PATCHed onto the document. The counter or mark name
      // travels in the body, so no URL rewrites it and none is refused here.
      const patch = (key: string, op: unknown, signal: AbortSignal | undefined) =>
        authoring(signal, () => call<unknown>('PATCH', docPath(key), { query: q(), body: op, signal }));

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

        update: (async (key: string, op: StorageUpdateOp, { signal }: DocumentCallOptions = {}) => {
          // NEGATIVE CONTROL N2: update's $inc calls the old POST …/counters/:name route.
          const inc = isRecord(op) && isRecord(op.$inc) ? Object.entries(op.$inc)[0] : undefined;
          const reply = inc
            ? await authoring(signal, () =>
                call<unknown>('POST', `${docPath(key)}/counters/${segment('counter', inc[0])}`, { query: q(), body: { by: inc[1] }, signal }),
              )
            : await patch(key, op, signal);
          // The reply is the one the operator gives. The operator is sent as the caller
          // wrote it, so a body that is not one operator is the server's to refuse (with
          // a `details.reason`) and never reaches this line.
          const has = (field: string) => isRecord(op) && Object.prototype.hasOwnProperty.call(op, field);
          if (has('$inc')) return toValueResult(reply, `${name}.update`);
          if (has('$mark')) return toMarkResult(reply, true, `${name}.update`);
          if (has('$unmark')) return toMarkResult(reply, false, `${name}.update`);
          throw new CivitaiError(`storage ${name}.update: the server accepted a body with no update operator`);
        }) as StorageCollection<T>['update'],

        // The deprecated three: their pre-PR routes and request shapes, unchanged, so they
        // do not depend on a civitai.com that serves PATCH. Only `update` sends PATCH.
        async increment(key, counter, by, { signal } = {}) {
          const reply = await authoring(signal, () =>
            call<{ value?: unknown }>(
              'POST',
              `${docPath(key)}/counters/${segment('counter', counter)}`,
              // No body at all when `by` is omitted: the server's default applies.
              { query: q(), body: by === undefined ? undefined : { by }, signal },
            ),
          );
          return toValueResult(reply, `${name}.increment`);
        },

        async mark(key, markName, { signal } = {}) {
          // NEGATIVE CONTROL N1: deprecated mark sent over PATCH. Reverted by the next commit.
          const reply = await patch(key, { $mark: markName }, signal);
          return toMarkResult(reply, true, `${name}.mark`);
        },

        async unmark(key, markName, { signal } = {}) {
          const reply = await authoring(signal, () =>
            call('DELETE', `${docPath(key)}/marks/${segment('mark', markName)}`, { query: q(), signal }),
          );
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

function toValueResult(reply: unknown, op: string): { value: number } {
  const value = (reply as { value?: unknown } | null | undefined)?.value;
  if (typeof value !== 'number') throw new CivitaiError(`storage ${op}: reply carried no \`value\``);
  return { value };
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
