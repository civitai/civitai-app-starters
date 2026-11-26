import { ApiError, type Http, type RequestOptions } from '../http/index.js';
import { createDocumentStorage, type DocumentStorage } from './index.js';
import { createModerationClient, REPORTS_PATH, type ModerationClient } from './moderation.js';
import {
  compileCollectionSchema,
  countSchemaPatterns,
  MANIFEST_MAX_PATTERNS,
  parseCollectionSchema,
  schemaViolationMessage,
  type SchemaFailure,
} from './schema.js';

/**
 * An in-memory document store behind the `Http` seam the client takes, enforcing the
 * server's rules: the same routes, gates, check ORDER, limits, rate limits, error
 * codes, statuses and envelope as `/api/v1/blocks/storage/…`.
 *
 * It is a port of the server's route layer and store, not a sketch of them. The
 * vendored contract (`schemas/app-block/storage-contract.v1.json`) runs against it in
 * this package's suite, through the raw `http` and through the real client, so where
 * the contract describes a rule the fake and the server agree by construction. Rules
 * the contract does not exercise are ported from the server source and say so where
 * they diverge.
 *
 * WHERE IT DIFFERS ON PURPOSE: rate limits apply only with `enforceRateLimits: true`;
 * a declaration using a feature the platform has not shipped (`write: "owner"` or
 * `"anyone"`, log collections, `ttlSeconds`, `dailyWritesPerAuthor`) is refused when
 * the fake is CREATED rather than per request; and a list cursor is an opaque token
 * bound to its whole query, not the server's sort-bound keyset string.
 *
 * A collection's `ownedModelVersions` rule is enforced; the fake has no model
 * versions of its own, so which ones a viewer owns is `FakeStorageViewer.modelVersions`
 * (default none).
 *
 * A collection's `schema` is enforced as the server enforces it (`./schema.ts`): every
 * create and put whose `data` does not match is refused 400 `schema_violation`, before the
 * ownership check, the trust gate, the write budget and moderation. A schema the server's
 * manifest parser would refuse is refused when the fake is created, with the server's text.
 *
 * Moderation is the server's ENFORCE mode, which the contract's moderation cases
 * describe: a hit refuses `content_rejected` and a scanner outage
 * `moderation_unavailable`. The host picks each app's shared-data moderation mode,
 * and enforce is not its default: in `shadow` (the scan runs after the write) or `off`
 * (no scan) neither a hit nor an outage refuses the write. The fake has no mode of its
 * own: `moderate: () => null` is what a shadow or off app sees.
 *
 * IMPORTS (civitai/civitai#7494): `sources` adds other apps by blockId, each with its own
 * collections, data, status and consent, and `collection(name, { from })` reaches them through
 * the manifest's `storage.imports` with the server's checks in the server's order — the
 * consumer's read charge, then token kind, declaration, read-only access, sign-in, the source's
 * approval, declaration and `exportable`, the `apps:storage:import` scope and the viewer's
 * grant, and the viewer's publish consent IN THE SOURCE for an authoring call into a shared
 * collection. A `dev` caller is refused every import, as the server refuses a dev token.
 * `as({ app })` acts as a source app itself, e.g. to seed the parent's data a fork then reads.
 * `requestGrants` is the host's prompt for the publish grant in a source (civitai/civitai#7586):
 * Allow records it there and the client's one retry lands, as on a real app page.
 *
 * VIEWER-KEYED collections (`keyedBy`, civitai/civitai#10216) are served at `…/:c/@me[/:parent]`
 * with the server's refusals in its order. The derived key is an opaque digest of (app,
 * namespace, collection, mode, parent, viewer) — `<parent>:<digest>` under `parent+viewer` — so
 * one viewer has one document per parent and no key carries their id. It is NOT the server's
 * digest (that one is keyed by a secret the fake does not have): never compare keys across the
 * two. `viewerKeyedClosed` closes a collection's write switch, `viewerKeysUnconfigured` answers
 * every `@me` call 503, as a host without its derivation secret does.
 *
 * THE REPORT API (`POST blocks/moderation/reports`, civitai/civitai#10215) is served with
 * `reports: true`; off, as on civitai.com by default, it answers as an unknown route, which the
 * client reports as `report_unavailable`. A report is one per (document, viewer), idempotent,
 * cannot be withdrawn, and is never counted in any answer.
 *
 * REMOVED, as civitai.com removed them (civitai/civitai#10391): marks, counters, their tallies
 * and server-side publish. A collection may still declare `marks`, `counters` or `write: "none"`,
 * but nothing serves them: `PATCH /:c/:key` is 405, `/:c/:key/counters/:name`,
 * `/:c/:key/marks/:name` and `_publish` / `_unpublish` are 404 `not_found`, a list refuses
 * `markedBy` / `mark` and `sort=counter:…` / `mark:…`, and a `write: "none"` collection is
 * read-only (403 `write_policy` on every create, put and delete). A document still carries
 * `counters: {}`, `marks: {}` and `viewer`, and `info()` lists `counters: []` and `marks: []`
 * and `marksAndCountersPerMinute: 0`, as the server still sends them for older SDKs.
 *
 * DIFFERS ON PURPOSE: civitai.com still answers `PUT /:c/:key/marks/report` as a report (and its
 * `DELETE` 400), an alias kept only for apps already built on SDKs before 0.30. No SDK from 0.33
 * on can send it, so the fake does not serve it: every `marks/<name>` path is 404 here.
 *
 * NOT MODELLED: moderator hides (a hidden document reads as not found on the server;
 * nothing here hides one), moderator exemption from the scanner, the review-preview
 * namespace, the token middleware's other refusals (revoked instance, context
 * binding, an approval read that fails), and a failed ownership lookup (the
 * server's retryable 503 `service_unavailable`).
 */

// ---------------------------------------------------------------------------
// Bounds — the server's, one copy here (the contract run pins the ones it reaches)
// ---------------------------------------------------------------------------

const BASE_SCOPE = 'apps:storage';
const PUBLISH_SCOPE = 'apps:storage:publish';
const IMPORT_SCOPE = 'apps:storage:import';
/** Scopes the host strips when the viewer revokes consent; `apps:storage` is consent-exempt. */
const CONSENT_GATED = new Set([PUBLISH_SCOPE, IMPORT_SCOPE]);
/** A blockId, as an import's `from` names one. */
const BLOCK_ID = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const MAX_IMPORTS = 8;
const MAX_IMPORT_COLLECTIONS = 16;
/** This app's blockId when the options name none. */
const DEFAULT_BLOCK_ID = 'this-app';

const COLLECTION_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const DOT_ONLY = /^\.+$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** The viewer's own document's path segment, and a parent key's grammar (the key's, without `:`). */
const MINE = '@me';
const PARENT = /^[A-Za-z0-9._-]{1,96}$/;
const KEYED_BY = ['viewer', 'parent+viewer'] as const;
const INDEX_TYPES = ['string', 'number', 'boolean', 'time'] as const;

const B = {
  docBytes: 65536,
  depth: 16,
  stringIndexBytes: 128,
  equalityFilters: 1,
  listLimitMax: 100,
  listLimitDefault: 25,
  getManyMax: 100,
} as const;
/** One document plus the request wrapper around it. */
const BODY_LIMIT_BYTES = B.docBytes + 16 * 1024;

const DEFAULT_LIMITS = {
  appBytes: 50 * 1024 * 1024,
  appDocs: 1_000_000,
  viewerBytes: 2 * 1024 * 1024,
  viewerDocs: 1_000,
};

const MINUTE = 60;
const DAY = 24 * 60 * 60;
type RateBucket = 'read' | 'write' | 'report';
const RATE: Record<RateBucket, { max: number; windowSeconds: number }> = {
  read: { max: 300, windowSeconds: MINUTE },
  write: { max: 120, windowSeconds: MINUTE },
  report: { max: 20, windowSeconds: DAY },
};
/**
 * burst, daily, rejections: [capacity, refill interval ms]. The document store's own
 * budget (civitai/civitai#8873): burst 30 (one back a minute), daily 300 (one back every
 * 4.8 minutes), rejections 10 (one back every 30 minutes).
 */
const SHARED_WRITE_BUDGET: readonly (readonly [number, number])[] = [
  [30, 60 * 1000],
  [300, (DAY * 1000) / 300],
  [10, 30 * 60 * 1000],
];
/** The default scanner's words: the contract's `conventions`, so a test can reach each refusal. */
export const FAKE_STORAGE_MODERATION = Object.freeze({
  blockedText: 'contract-blocked-term',
  blockedLink: 'https://contract-blocked.example/x',
  scannerDown: 'contract-scanner-down',
});

const STATUS: Record<string, number> = {
  invalid_request: 400,
  index_not_declared: 400,
  schema_violation: 400,
  unauthenticated: 401,
  sign_in_required: 401,
  insufficient_scope: 403,
  consent_required: 403,
  import_not_declared: 403,
  not_exportable: 403,
  not_eligible: 403,
  not_author: 403,
  write_policy: 403,
  resource_not_owned: 403,
  not_found: 404,
  collection_not_declared: 404,
  method_not_allowed: 405,
  version_conflict: 409,
  too_large: 413,
  quota_exceeded: 413,
  content_rejected: 422,
  rate_limited: 429,
  storage_disabled: 503,
  moderation_unavailable: 503,
  consent_unavailable: 503,
  service_unavailable: 503,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FakeStorageViewer {
  /** The viewer's identity in this fake, and what `showAuthor` collections display. */
  username: string;
  /**
   * The viewer's numeric user id, as the platform keys it. Internal: no response
   * carries it, which a test can check by choosing a distinctive one. Default: a
   * small number assigned on first use.
   */
  id?: number;
  /** Passes the minimum-trust gate on shared writes. Default `true`. */
  trusted?: boolean;
  /** `details.reason` when untrusted. Default `account_too_new`. */
  untrustedReason?: string;
  /**
   * Ids of the model versions whose model this viewer owns — what a collection's
   * `ownedModelVersions` rule checks a write against. Default: none, so every id
   * at a declared field is refused `resource_not_owned`, as the server refuses a
   * version that is not the writer's (or does not exist).
   */
  modelVersions?: readonly number[];
}

/** Who is calling: a viewer (or `null`, anonymous) holding a token of some kind and scopes. */
export interface FakeStorageCaller {
  /** Default: the fake's `viewer`. `null` is an anonymous viewer with a token. */
  viewer?: FakeStorageViewer | null;
  /**
   * `block` (default), `dev` (the developer's own namespace; refused every import, as the
   * server refuses a dev token) or `none` (no token at all).
   */
  token?: 'block' | 'dev' | 'none';
  /** The token's scopes. Default: that app's manifest `scopes`. */
  scopes?: readonly string[];
  /**
   * Which app's token: this app's blockId (the default) or one of `sources`, so a test can
   * act as the source itself — seed the parent's data that a fork then reads.
   */
  app?: string;
}

/** Another app in the same fake, reachable through this app's `storage.imports`. */
export interface FakeStorageSource {
  /** Its manifest; `storage.collections` is what an import reaches. Its own imports are not followed. */
  manifest: { scopes?: readonly string[]; storage?: unknown };
  /** Default `approved`; anything else refuses an import of it `not_eligible` (`source_not_approved`). */
  status?: string;
  /**
   * Scopes the viewer revoked IN THIS SOURCE. Revoking `apps:storage:publish` here is how a
   * test reaches the publish-in-source refusal: a write or report through a
   * `readwrite` import into one of this source's shared collections is refused
   * `consent_required` with `details: { scope: 'apps:storage:publish', from }`.
   */
  consent?: { revoked: readonly string[] };
}

/** What the viewer allowed for one source when the host's consent prompt showed the import. */
export interface FakeStorageImportGrant {
  collections: readonly string[];
  access: 'read' | 'readwrite';
}

export type FakeModerationVerdict = 'blocked' | 'link' | 'unavailable' | null;

export interface FakeStorageOptions {
  /** The app's manifest; `storage.collections` and `storage.imports` are what the fake enforces. */
  manifest: { scopes?: readonly string[]; storage?: unknown };
  /** This app's blockId, which an import may not name. Default `this-app`. */
  blockId?: string;
  /** Other apps by blockId, for this app's `storage.imports` to reach (and `as({ app })` to act as). */
  sources?: Record<string, FakeStorageSource>;
  /**
   * The viewer's import grants: source blockId → what they allowed. A grant covers an
   * import when it names every collection the import names at an access at least as wide
   * (`readwrite` covers `read`). Default: exactly the manifest's imports, as if the viewer
   * had allowed every prompt; `{}` is none granted. The token must ALSO carry
   * `apps:storage:import` (the caller's `scopes`, or `consent` revoking it).
   */
  importGrants?: Record<string, FakeStorageImportGrant>;
  /**
   * The host's consent prompt, for the one grant the client asks for by itself: the
   * viewer's `apps:storage:publish` IN A SOURCE (`opts.from`), when a write through an
   * import is refused for want of it (civitai/civitai#7586). Return `true` for Allow —
   * the fake then records the grant in that source, as the host does, and the client
   * sends the call once more — or `false` for "Not now". Absent, the client asks nothing
   * and the refusal reaches the caller.
   */
  requestGrants?: (scopes: readonly string[], opts: { from?: string }) => boolean | Promise<boolean>;
  /** The default caller's viewer. Default `{ username: 'viewer' }`; `null` for anonymous. */
  viewer?: FakeStorageViewer | null;
  /** Default `approved`; anything else refuses every call `not_eligible`. */
  appStatus?: string;
  /** Consent state: scopes the viewer revoked, or `unavailable` (the marker could not be read). */
  consent?: { revoked: readonly string[] } | 'unavailable';
  /** `true` answers every data operation `storage_disabled`, as a server with no database does. */
  disabled?: boolean;
  /** Override the per-app and per-viewer ceilings, e.g. a small `viewerDocs` to reach the quota. */
  limits?: Partial<typeof DEFAULT_LIMITS>;
  /**
   * Apply the server's rate limits: the per-minute and per-day windows (reads, private
   * writes and deletes, reports) and the shared write budget.
   * Default `false`, so an app's own tests are never throttled; turn it on to test how
   * the app handles `rate_limited`.
   */
  enforceRateLimits?: boolean;
  /** The clock rate limits and timestamps read. Default `Date.now`. */
  now?: () => number;
  /**
   * Classify one string (a value, an object key or a document key) of a shared write.
   * Default: {@link FAKE_STORAGE_MODERATION}'s words.
   */
  moderate?: (text: string) => FakeModerationVerdict;
  /**
   * Serve the report API (`POST blocks/moderation/reports`). Default `false`, as on civitai.com,
   * where it sits behind a per-app flag that is off: it answers as an unknown route (404
   * `not_found`), which the client reports as `report_unavailable`. `true` serves it.
   */
  reports?: boolean;
  /**
   * This app's viewer-keyed collections whose write switch is CLOSED (a collection being
   * migrated): `putMine` / `deleteMine` are refused 403 `write_policy`
   * (`reason: 'viewer_keyed_closed'`) and `info()` reports `open: false`; reads still work. As on
   * the server, only the production namespace has switches: a `dev` caller is always open.
   * Default: none closed.
   */
  viewerKeyedClosed?: readonly string[];
  /**
   * Answer every `@me` call 503 `service_unavailable` (`reason: 'viewer_keys_unconfigured'`) and
   * report every viewer-keyed collection `open: false`, as a host whose key-derivation secret is
   * unset does. Default `false`.
   */
  viewerKeysUnconfigured?: boolean;
}

/** One request as the fake received it, and what it answered. */
export interface FakeStorageCall {
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  body: unknown;
  status: number;
  response: unknown;
}

export interface FakeStorageSession {
  /** The `Http` seam, as this caller. */
  readonly http: Http;
  /** The real client over that seam. */
  readonly storage: DocumentStorage;
  /** The real report API client over that seam (`app.moderation`). */
  readonly moderation: ModerationClient;
}

export interface FakeStorage extends FakeStorageSession {
  /** The same store, as a different caller. */
  as(caller: FakeStorageCaller): FakeStorageSession;
  /** Every request received, in order, by any caller. */
  readonly calls: FakeStorageCall[];
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

type IndexType = (typeof INDEX_TYPES)[number];
interface Decl {
  visibility: 'private' | 'shared';
  /** Shared collections only: `own`, or `none` (read-only: nothing writes its documents). */
  write?: 'own' | 'none';
  indexes: Map<string, IndexType>;
  showAuthor: boolean;
  /** Pointers into `data` whose ids must be the writer's own model versions; empty when undeclared. */
  ownedModelVersions: string[];
  /** The compiled `schema` every document's `data` must match; absent when none is declared. */
  schema?: (data: unknown) => SchemaFailure | null;
  /** `false` refuses every import of this collection (`not_exportable`). */
  exportable: boolean;
  /** A viewer-keyed collection's key derivation; absent for ordinary keys. */
  keyedBy?: (typeof KEYED_BY)[number];
}

/** One of the manifest's `storage.imports`. */
interface Imp {
  collections: Set<string>;
  access: 'read' | 'readwrite';
}

/** The manifest's `ownedModelVersions` pointer: 1 to 4 plain identifier segments. */
const OWNED_POINTER = /^(\/[A-Za-z_][A-Za-z0-9_]{0,63}){1,4}$/u;
const MAX_OWNED_POINTERS = 4;
/** Postgres `integer`: the server refuses a larger id before querying for it. */
const INT4_MAX = 2_147_483_647;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Declarations the platform does not serve yet, each with what to do instead. */
const PHASED: { test: (raw: Record<string, unknown>) => boolean; what: string }[] = [
  { test: (r) => r.write === 'owner', what: 'write "owner" (owner-written documents)' },
  { test: (r) => r.write === 'anyone', what: 'write "anyone" (documents any viewer may edit)' },
  { test: (r) => r.kind === 'log' || r.maxEntries !== undefined, what: 'kind "log" / maxEntries (log collections)' },
  { test: (r) => r.ttlSeconds !== undefined, what: 'ttlSeconds (expiring documents)' },
  { test: (r) => r.dailyWritesPerAuthor !== undefined, what: 'dailyWritesPerAuthor (per-collection write budgets)' },
];

/**
 * Only what the fake needs to know the declared collections. It is NOT a manifest
 * validator — `civitai app validate` and the platform's review are; a declaration it
 * reads here may still be refused there. It refuses, at construction, the two things
 * it cannot serve: a declaration it cannot read, and a feature the platform has not
 * shipped (so a test never passes against storage that would not exist).
 */
function parseManifest(manifest: unknown): Map<string, Decl> {
  const out = new Map<string, Decl>();
  if (!isObject(manifest) || manifest.storage === undefined) return out;
  const storage = manifest.storage;
  // `collections` may be absent when `imports` is declared (a fork with no collections of its own).
  if (!isObject(storage) || (storage.collections === undefined ? storage.imports === undefined : !isObject(storage.collections))) {
    throw new Error('createFakeStorage: manifest.storage.collections must be an object');
  }
  const errors: string[] = [];
  // The manifest-wide pattern cap counts the collections that parsed, as the server does.
  let patterns = 0;
  for (const [name, raw] of Object.entries(isObject(storage.collections) ? storage.collections : {})) {
    const at = `storage.collections.${name}`;
    const before = errors.length;
    if (!isObject(raw) || (raw.visibility !== 'private' && raw.visibility !== 'shared')) {
      errors.push(`${at}: needs visibility "private" or "shared"`);
      continue;
    }
    for (const { test, what } of PHASED) {
      if (test(raw)) errors.push(`${at}: ${what} is not available yet in App Storage`);
    }
    const shared = raw.visibility === 'shared';
    if (shared && raw.write !== 'own' && raw.write !== 'none' && raw.write !== 'owner' && raw.write !== 'anyone') {
      errors.push(`${at}: a shared collection needs write "own" or "none"`);
    }
    const indexes = new Map<string, IndexType>();
    for (const [path, type] of Object.entries(isObject(raw.indexes) ? raw.indexes : {})) {
      if ((INDEX_TYPES as readonly unknown[]).includes(type)) indexes.set(path, type as IndexType);
      else errors.push(`${at}.indexes.${path}: type must be one of ${INDEX_TYPES.join(', ')}`);
    }
    const ownedModelVersions: string[] = [];
    if (raw.ownedModelVersions !== undefined) {
      const list = raw.ownedModelVersions;
      if (!shared || raw.write !== 'own') {
        errors.push(`${at}.ownedModelVersions: applies only to shared collections with write "own"`);
      } else if (
        !Array.isArray(list) ||
        list.length < 1 ||
        list.length > MAX_OWNED_POINTERS ||
        !list.every((p) => typeof p === 'string' && OWNED_POINTER.test(p)) ||
        new Set(list).size !== list.length
      ) {
        errors.push(
          `${at}.ownedModelVersions: must be 1 to ${MAX_OWNED_POINTERS} distinct pointers such as "/workflow/modelVersionId"`,
        );
      } else {
        ownedModelVersions.push(...(list as string[]));
      }
    }
    let schema: Decl['schema'];
    let parsedSchema: ReturnType<typeof parseCollectionSchema> = null;
    if (raw.schema !== undefined) {
      if (shared && raw.write === 'none') {
        errors.push(
          `${at}.schema does not apply to write "none" — no document body is ever written to that collection, so a schema would check nothing`,
        );
      } else {
        parsedSchema = parseCollectionSchema(`${at}.schema`, raw.schema, errors);
        if (parsedSchema) schema = compileCollectionSchema(parsedSchema);
      }
    }
    const decl: Decl = {
      visibility: raw.visibility,
      indexes,
      showAuthor: shared && raw.showAuthor === true,
      exportable: raw.exportable !== false,
      ownedModelVersions,
    };
    if (shared && (raw.write === 'own' || raw.write === 'none')) decl.write = raw.write;
    if (schema) decl.schema = schema;
    // The server's parser rules and texts (`parseCollection` in block-storage.constants.ts).
    if (raw.keyedBy !== undefined) {
      if (typeof raw.keyedBy !== 'string' || !(KEYED_BY as readonly string[]).includes(raw.keyedBy)) {
        errors.push(`${at}.keyedBy must be one of ${KEYED_BY.join(', ')}`);
      } else if (!shared) {
        errors.push(`${at}.keyedBy applies only to shared collections — a private collection already has one key space per viewer`);
      } else if (raw.write !== undefined && raw.write !== 'own') {
        errors.push(`${at}.keyedBy applies only to write "own" — the viewer must be the author of the document their key names`);
      } else if (raw.counters !== undefined || raw.marks !== undefined) {
        errors.push(
          `${at}.keyedBy cannot be combined with counters or marks — each viewer's document is itself their vote or entry`,
        );
      } else {
        decl.keyedBy = raw.keyedBy as (typeof KEYED_BY)[number];
      }
    }
    if (parsedSchema && errors.length === before) patterns += countSchemaPatterns(parsedSchema);
    out.set(name, decl);
  }
  if (patterns > MANIFEST_MAX_PATTERNS) {
    errors.push(
      `storage.collections declare ${patterns} patterns across their schemas — a manifest may declare at most ${MANIFEST_MAX_PATTERNS} in all`,
    );
  }
  if (errors.length > 0) throw new Error(`createFakeStorage: cannot serve this storage declaration:\n- ${errors.join('\n- ')}`);
  return out;
}

/**
 * The manifest's `storage.imports`, refusing at construction what the server's manifest
 * validation refuses at submit: a shape it cannot read, more than 8, an import of this app
 * itself, and a second import of the same source.
 */
function parseImports(manifest: unknown, blockId: string): Map<string, Imp> {
  const out = new Map<string, Imp>();
  const storage = isObject(manifest) && isObject(manifest.storage) ? manifest.storage : undefined;
  if (storage?.imports === undefined) return out;
  const list = storage.imports;
  const errors: string[] = [];
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_IMPORTS) {
    errors.push(`storage.imports: must be 1 to ${MAX_IMPORTS} imports`);
  } else {
    list.forEach((raw: unknown, i) => {
      const at = `storage.imports[${i}]`;
      const entry = isObject(raw) ? raw : {};
      const from = typeof entry.from === 'string' ? entry.from : '';
      const access = entry.access === 'read' ? 'read' : entry.access === 'readwrite' ? 'readwrite' : null;
      const names: unknown[] = Array.isArray(entry.collections) ? entry.collections : [];
      if (
        !BLOCK_ID.test(from) ||
        access === null ||
        names.length < 1 ||
        names.length > MAX_IMPORT_COLLECTIONS ||
        !names.every((n) => typeof n === 'string' && COLLECTION_NAME.test(n)) ||
        new Set(names).size !== names.length
      ) {
        errors.push(
          `${at}: needs { from: a blockId, collections: 1 to ${MAX_IMPORT_COLLECTIONS} distinct collection names, access: "read" or "readwrite" }`,
        );
        return;
      }
      if (from === blockId) errors.push(`${at}: an app cannot import from itself`);
      else if (out.has(from)) errors.push(`${at}: ${from} is imported more than once`);
      else out.set(from, { collections: new Set(names as string[]), access });
    });
  }
  if (errors.length > 0) throw new Error(`createFakeStorage: cannot serve this storage declaration:\n- ${errors.join('\n- ')}`);
  return out;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class Refusal extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    if (details) this.details = details;
  }
}

const refuse = (code: string, message: string, details?: Record<string, unknown>) =>
  new Refusal(code, message, details);
const invalid = (message: string, details?: Record<string, unknown>) => refuse('invalid_request', message, details);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface IndexRow {
  type: IndexType;
  text?: string;
  num?: number;
}

interface DocRow {
  key: string;
  data: Record<string, unknown>;
  size: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Internal only — never leaves the fake. */
  authorUid: number;
  authorKind: 'user' | 'counter';
  index: Map<string, IndexRow>;
  /** The uids that reported it: one report per (document, viewer). Never counted in an answer. */
  reports: Set<number>;
}

interface Usage {
  bytes: number;
  docs: number;
}

/** One app in the fake: this app, or a source an import reaches. */
interface AppState {
  id: string;
  collections: Map<string, Decl>;
  /** Source blockId → import. Always empty for a source: an import is one hop. */
  imports: Map<string, Imp>;
  scopes: readonly string[];
  status: string;
  consent?: { revoked: readonly string[] } | 'unavailable';
  /** Viewer-keyed collections whose write switch is closed (production namespace only). */
  closed: ReadonlySet<string>;
}

interface Ctx {
  /** The app whose data, declarations, ceilings and rate limits the call uses. */
  app: AppState;
  ns: string;
  uid: number | null;
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * String order as the server's `COLLATE "C"` columns sort: by Unicode code point
 * (the byte order of UTF-8). JavaScript's `<` compares UTF-16 code units instead,
 * which puts an astral character (a surrogate pair, 0xD800…) BEFORE U+E000–U+FFFF.
 */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  }
  return x.length - y.length < 0 ? -1 : x.length > y.length ? 1 : 0;
}

/**
 * The stored unit: the length of the database's text form of the JSON, which puts a
 * space after every `:` and `,`. (Exact except where the two spell a number
 * differently, e.g. an exponent.)
 */
function storedSize(data: unknown): number {
  let separators = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      separators += Math.max(0, v.length - 1);
      v.forEach(walk);
    } else if (isObject(v)) {
      const entries = Object.entries(v);
      separators += entries.length + Math.max(0, entries.length - 1);
      for (const [, x] of entries) walk(x);
    }
  };
  walk(data);
  return utf8Length(JSON.stringify(data)) + separators;
}

/**
 * A 128-bit digest of `text` as 26 characters of lowercase RFC 4648 base32 (no padding), the
 * shape of the server's derived-key digest. Not a MAC and not the server's value: an opaque,
 * deterministic stand-in (cyrb128), synchronous so the fake runs in a browser tab too.
 */
function opaqueDigest(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const word of [h1, h2, h3, h4]) {
    for (const shift of [24, 16, 8, 0]) {
      value = (value << 8) | ((word >>> shift) & 0xff);
      bits += 8;
      while (bits >= 5) {
        out += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
      value &= (1 << bits) - 1;
    }
  }
  return bits > 0 ? out + alphabet[(value << (5 - bits)) & 31] : out;
}

// ---------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------

export function createFakeStorage(options: FakeStorageOptions): FakeStorage {
  const ownId = options.blockId ?? DEFAULT_BLOCK_ID;
  const thisApp: AppState = {
    id: ownId,
    collections: parseManifest(options.manifest),
    imports: parseImports(options.manifest, ownId),
    scopes: options.manifest.scopes ?? [],
    status: options.appStatus ?? 'approved',
    ...(options.consent === undefined ? {} : { consent: options.consent }),
    closed: new Set(options.viewerKeyedClosed ?? []),
  };
  const apps = new Map<string, AppState>([[ownId, thisApp]]);
  for (const [id, source] of Object.entries(options.sources ?? {})) {
    if (apps.has(id)) throw new Error(`createFakeStorage: sources.${id} is this app's own blockId`);
    apps.set(id, {
      id,
      collections: parseManifest(source.manifest),
      imports: new Map(),
      scopes: source.manifest.scopes ?? [],
      status: source.status ?? 'approved',
      ...(source.consent === undefined ? {} : { consent: source.consent }),
      closed: new Set(),
    });
  }
  const importGrants: Record<string, FakeStorageImportGrant> =
    options.importGrants ??
    Object.fromEntries([...thisApp.imports].map(([from, imp]) => [from, { collections: [...imp.collections], access: imp.access }]));
  const now = options.now ?? (() => Date.now());
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const moderate =
    options.moderate ??
    ((text: string): FakeModerationVerdict => {
      if (text.includes(FAKE_STORAGE_MODERATION.scannerDown)) return 'unavailable';
      if (text.includes(FAKE_STORAGE_MODERATION.blockedLink)) return 'link';
      if (text.includes(FAKE_STORAGE_MODERATION.blockedText)) return 'blocked';
      return null;
    });
  const defaultViewer: FakeStorageViewer | null =
    options.viewer === undefined ? { username: 'viewer' } : options.viewer;
  const calls: FakeStorageCall[] = [];

  // Identity: a username → an internal id that no response ever carries.
  const uids = new Map<string, number>();
  const uidOf = (viewer: FakeStorageViewer) => {
    let uid = uids.get(viewer.username);
    if (uid === undefined) {
      uid = viewer.id ?? uids.size + 1;
      uids.set(viewer.username, uid);
    }
    return uid;
  };
  const usernames = () => new Map([...uids].map(([name, uid]) => [uid, name]));

  const docs = new Map<string, DocRow>();
  const appUsage = new Map<string, Usage>();
  const userUsage = new Map<string, Usage>();
  const windows = new Map<string, { count: number; resetAt: number }>();
  /** Keyed `${app}:${uid}`: the budget is per viewer per app. */
  const budgets = new Map<string, number[]>();
  const cursors = new Map<string, { binding: string; value: string | number; key: string }>();
  const issueCursor = (binding: string, value: string | number, key: string) => {
    // Deterministic (a per-fake counter), so an app's snapshot tests are stable.
    const token = `cursor_${cursors.size + 1}`;
    cursors.set(token, { binding, value, key });
    return token;
  };

  const scopeOf = (ctx: Ctx, coll: string): number => {
    if (ctx.app.collections.get(coll)!.visibility === 'shared') return 0;
    if (ctx.uid === null) throw refuse('sign_in_required', 'sign in required');
    return ctx.uid;
  };
  const docId = (ctx: Ctx, coll: string, scope: number, key: string) => `${ctx.ns}\u0000${coll}\u0000${scope}\u0000${key}`;
  const docsIn = (ctx: Ctx, coll: string, scope: number) => {
    const prefix = `${ctx.ns}\u0000${coll}\u0000${scope}\u0000`;
    return [...docs].filter(([id]) => id.startsWith(prefix)).map(([, d]) => d);
  };

  // --- rate limits ---------------------------------------------------------

  /** A fixed window from the first request, per app; every request counts, refused ones too. */
  function charge(bucket: RateBucket, uid: number | null, app: string) {
    if (!options.enforceRateLimits) return;
    const { max, windowSeconds } = RATE[bucket];
    const id = `${app}:${bucket}:${uid === null ? 'ip' : `u:${uid}`}`;
    const t = now();
    let w = windows.get(id);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowSeconds * 1000 };
      windows.set(id, w);
    }
    w.count += 1;
    if (w.count > max) {
      const left = Math.ceil((w.resetAt - t) / 1000);
      throw refuse('rate_limited', 'rate limit exceeded', { bucket, retryAfter: left >= 1 ? left : windowSeconds });
    }
  }

  /** The shared write budget: three continuously refilling buckets; each slot is the instant that bucket is full again. */
  function reserveSharedWrite(uid: string): (rejected: boolean) => void {
    const budget = SHARED_WRITE_BUDGET;
    const refusal = { message: 'shared write budget exhausted', bucket: 'shared-write' };
    if (!options.enforceRateLimits) return () => undefined;
    const t = now();
    const full = (budgets.get(uid) ?? [t, t, t]).map((f) => Math.max(f, t));
    let wait = 0;
    budget.forEach(([cap, iv], i) => {
      wait = Math.max(wait, full[i]! - t - (cap - 1) * iv);
    });
    if (wait > 0) {
      throw refuse('rate_limited', refusal.message, {
        bucket: refusal.bucket,
        retryAfter: Math.max(1, Math.ceil(wait / 1000)),
      });
    }
    full[0]! += budget[0]![1];
    full[1]! += budget[1]![1];
    budgets.set(uid, full);
    return (rejected: boolean) => {
      const t2 = now();
      const f = (budgets.get(uid) ?? [t2, t2, t2]).map((x) => Math.max(x, t2));
      f[0] = Math.max(f[0]! - budget[0]![1], t2);
      f[1] = Math.max(f[1]! - budget[1]![1], t2);
      if (rejected) {
        const [cap, iv] = budget[2]!;
        f[2] = Math.min(f[2]! + iv, t2 + 2 * cap * iv);
      }
      budgets.set(uid, f);
    };
  }

  // --- store ---------------------------------------------------------------

  /** Phased features were refused at construction, so every declared collection is servable. */
  const declOf = (ctx: Ctx, name: string): Decl => ctx.app.collections.get(name)!;

  function assertShareWritable(decl: Decl) {
    if (decl.visibility !== 'shared') return;
    if (decl.write === 'none') throw refuse('write_policy', 'this collection is read-only: nothing writes its documents');
  }

  function assertKey(key: unknown): asserts key is string {
    if (typeof key !== 'string' || !KEY.test(key)) throw invalid('key must be 1–128 characters of [A-Za-z0-9._:-]');
    if (DOT_ONLY.test(key)) throw invalid('key must not consist only of dots: it cannot be addressed in a URL path');
  }

  const requireViewer = (ctx: Ctx): number => {
    if (ctx.uid === null) throw refuse('sign_in_required', 'sign in required');
    return ctx.uid;
  };

  /** Every path that names keys itself or writes beside the document, on a viewer-keyed collection. */
  function refuseViewerKeyed(coll: string, decl: Decl, what: string) {
    if (decl.keyedBy === undefined) return;
    throw invalid(
      `${what} is not available on viewer-keyed collection ${coll}: write the viewer's own document at /${coll}/${MINE}`,
      { reason: 'viewer_keyed', collection: coll },
    );
  }

  /** The server's `isViewerKeyedOpen`: switches exist in the production namespace only. */
  const viewerKeyedOpen = (ctx: Ctx, coll: string) => !ctx.ns.endsWith('\u0000prod') || !ctx.app.closed.has(coll);

  /**
   * The key of the viewer's own document for a `@me` call, refusing in the server's order
   * (`viewerKeyedDocKey`): not viewer-keyed, a parent unwanted, missing or outside its grammar
   * (400), a write while the switch is closed (403), sign-in, keys not derivable (503).
   */
  function viewerKeyedDocKey(ctx: Ctx, coll: string, decl: Decl, parent: string | null, write: boolean): string {
    const mode = decl.keyedBy;
    const refusal = (reason: string, message: string) => invalid(message, { reason, collection: coll });
    if (mode === undefined) {
      throw refusal('not_viewer_keyed', `collection ${coll} is not viewer-keyed: address its documents by key`);
    }
    if (mode === 'viewer' && parent !== null) {
      throw refusal('parent_not_allowed', `collection ${coll} is keyed by viewer only: use /${coll}/${MINE}`);
    }
    if (mode === 'parent+viewer') {
      if (parent === null) {
        throw refusal('parent_required', `collection ${coll} is keyed by parent and viewer: use /${coll}/${MINE}/:parent`);
      }
      if (!PARENT.test(parent) || DOT_ONLY.test(parent)) {
        throw refusal('invalid_parent', 'parent must be 1–96 characters of [A-Za-z0-9._-], not only dots');
      }
    }
    if (write && !viewerKeyedOpen(ctx, coll)) {
      throw refuse('write_policy', 'this collection is not open for writes yet', { collection: coll, reason: 'viewer_keyed_closed' });
    }
    const uid = requireViewer(ctx);
    // The server's sentence for every 503 `service_unavailable` (its CLIENT_MESSAGE).
    if (options.viewerKeysUnconfigured) {
      throw refuse('service_unavailable', 'storage is temporarily unavailable', { reason: 'viewer_keys_unconfigured' });
    }
    const d = opaqueDigest(JSON.stringify([ctx.app.id, ctx.ns, coll, mode, parent ?? '', uid]));
    return mode === 'parent+viewer' ? `${parent}:${d}` : d;
  }

  function assertStoredString(s: string) {
    if (s.includes('\u0000') || LONE_SURROGATE.test(s)) throw invalid('data contains a NUL character or an unpaired surrogate');
  }
  function assertShape(v: unknown, depth: number) {
    if (typeof v === 'string') return assertStoredString(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw invalid('data contains a non-finite number');
      return;
    }
    if (v === null || typeof v === 'boolean') return;
    if (typeof v !== 'object') throw invalid('data contains a non-JSON value');
    if (depth > B.depth) throw invalid(`data nests deeper than ${B.depth}`);
    if (Array.isArray(v)) return v.forEach((x) => assertShape(x, depth + 1));
    for (const [k, x] of Object.entries(v)) {
      assertStoredString(k);
      assertShape(x, depth + 1);
    }
  }
  function serialize(data: unknown): Record<string, unknown> {
    if (!isObject(data)) throw invalid('data must be a JSON object');
    if (utf8Length(JSON.stringify(data)) > B.docBytes) {
      throw refuse('too_large', `document exceeds ${B.docBytes} bytes`, { limit: B.docBytes });
    }
    assertShape(data, 1);
    return data;
  }

  function indexValue(type: IndexType, raw: unknown, index: string): IndexRow {
    const bad = (reason: string) => invalid(`index ${index}: ${reason}`, { index });
    switch (type) {
      case 'string':
        if (typeof raw !== 'string') throw bad('expected a string');
        if (utf8Length(raw) > B.stringIndexBytes) throw bad(`string longer than ${B.stringIndexBytes} bytes`);
        assertStoredString(raw);
        return { type, text: raw };
      case 'number':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) throw bad('expected a finite number');
        return { type, num: raw };
      case 'boolean':
        if (typeof raw !== 'boolean') throw bad('expected a boolean');
        return { type, num: raw ? 1 : 0 };
      case 'time': {
        const ms = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
        if (!Number.isFinite(ms)) throw bad('expected an ISO-8601 time or epoch milliseconds');
        return { type, num: ms };
      }
    }
  }

  function indexRows(decl: Decl, data: Record<string, unknown>): Map<string, IndexRow> {
    const rows = new Map<string, IndexRow>();
    for (const [name, type] of decl.indexes) {
      let cur: unknown = data;
      for (const seg of name.split('.')) {
        cur = isObject(cur) && Object.prototype.hasOwnProperty.call(cur, seg) ? cur[seg] : undefined;
      }
      if (cur === undefined || cur === null) continue;
      rows.set(name, indexValue(type, cur, name));
    }
    return rows;
  }

  /** The ceilings, checked before anything changes, so a refusal leaves the store as it was. */
  function chargeUsage(ctx: Ctx, uid: number, bytes: number, count: number, ceiling: string) {
    const app = appUsage.get(ctx.ns) ?? { bytes: 0, docs: 0 };
    if ((bytes > 0 && app.bytes + bytes > limits.appBytes) || (count > 0 && app.docs + count > limits.appDocs)) {
      throw refuse('quota_exceeded', 'app storage quota exceeded', { ceiling: 'app' });
    }
    const userId = `${ctx.ns}\u0000${uid}`;
    const user = userUsage.get(userId) ?? { bytes: 0, docs: 0 };
    if (
      (bytes !== 0 || count !== 0) &&
      ((bytes > 0 && user.bytes + bytes > limits.viewerBytes) || (count > 0 && user.docs + count > limits.viewerDocs))
    ) {
      throw refuse('quota_exceeded', 'storage quota exceeded', { ceiling });
    }
    return () => {
      appUsage.set(ctx.ns, { bytes: app.bytes + bytes, docs: app.docs + count });
      userUsage.set(userId, { bytes: user.bytes + bytes, docs: user.docs + count });
    };
  }

  function present(ctx: Ctx, coll: string, d: DocRow) {
    const decl = declOf(ctx, coll);
    const names = usernames();
    const author =
      d.authorKind === 'counter'
        ? { kind: 'counter' }
        : {
            kind: 'user',
            isViewer: d.authorUid === ctx.uid,
            ...(decl.showAuthor && names.has(d.authorUid) ? { username: names.get(d.authorUid) } : {}),
          };
    return {
      key: d.key,
      data: d.data,
      version: d.version,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
      author,
      // SDK compatibility, not data (the server's `presentDocs`): always empty.
      counters: {},
      marks: {},
      viewer: ctx.uid === null ? null : { marks: [] },
    };
  }

  function getMany(ctx: Ctx, coll: string, keys: unknown[]) {
    if (keys.length > B.getManyMax) throw invalid(`getMany takes at most ${B.getManyMax} keys`);
    keys.forEach(assertKey);
    if (keys.length === 0) return [];
    const scope = scopeOf(ctx, coll);
    storageOn();
    return (keys as string[]).map((k) => {
      const d = docs.get(docId(ctx, coll, scope, k));
      return d ? present(ctx, coll, d) : null;
    });
  }

  function writeDoc(ctx: Ctx, coll: string, key: string, data: unknown, ifVersion: number | undefined) {
    const decl = declOf(ctx, coll);
    assertKey(key);
    const viewer = requireViewer(ctx);
    assertShareWritable(decl);
    if (ifVersion !== undefined && !(Number.isSafeInteger(ifVersion) && ifVersion >= 0)) {
      throw invalid('ifVersion must be a non-negative integer');
    }
    const doc = serialize(data);
    const index = indexRows(decl, doc);
    const scope = scopeOf(ctx, coll);
    storageOn();
    const id = docId(ctx, coll, scope, key);
    const existing = docs.get(id);
    const size = storedSize(doc);
    const tooLarge = () => refuse('too_large', `document exceeds ${B.docBytes} bytes`, { limit: B.docBytes });
    const ceiling = decl.visibility === 'private' ? 'viewer' : 'author';
    const t = now();
    if (existing) {
      if (ifVersion !== undefined && ifVersion !== existing.version) {
        throw refuse('version_conflict', 'version conflict', { currentVersion: existing.version });
      }
      if (decl.visibility === 'shared' && !(existing.authorKind === 'user' && existing.authorUid === ctx.uid)) {
        throw refuse('not_author', 'only the author may change this document');
      }
      if (size > B.docBytes) throw tooLarge();
      const commit = chargeUsage(ctx, viewer, size - existing.size, 0, ceiling);
      commit();
      Object.assign(existing, { data: doc, size, version: existing.version + 1, updatedAt: t, index });
      return present(ctx, coll, existing);
    }
    if (ifVersion !== undefined && ifVersion !== 0) {
      throw refuse('version_conflict', 'version conflict', { currentVersion: 0 });
    }
    if (size > B.docBytes) throw tooLarge();
    chargeUsage(ctx, viewer, size, 1, ceiling)();
    const row: DocRow = {
      key,
      data: doc,
      size,
      version: 1,
      createdAt: t,
      updatedAt: t,
      authorUid: viewer,
      authorKind: 'user',
      index,
      reports: new Set(),
    };
    docs.set(id, row);
    return present(ctx, coll, row);
  }

  function remove(ctx: Ctx, coll: string, key: string, ifVersion: number | undefined) {
    const decl = declOf(ctx, coll);
    assertKey(key);
    const viewer = requireViewer(ctx);
    assertShareWritable(decl);
    const scope = scopeOf(ctx, coll);
    storageOn();
    const id = docId(ctx, coll, scope, key);
    const row = docs.get(id);
    if (!row) {
      if (ifVersion !== undefined && ifVersion !== 0) throw refuse('version_conflict', 'version conflict', { currentVersion: 0 });
      return { deleted: false };
    }
    if (ifVersion !== undefined && ifVersion !== row.version) {
      throw refuse('version_conflict', 'version conflict', { currentVersion: row.version });
    }
    if (decl.visibility === 'shared' && !(row.authorKind === 'user' && row.authorUid === ctx.uid)) {
      throw refuse('not_author', 'only the author may change this document');
    }
    chargeUsage(ctx, viewer, -row.size, -1, decl.visibility === 'private' ? 'viewer' : 'author')();
    docs.delete(id);
    return { deleted: true };
  }

  type Sort =
    | { kind: 'key'; desc: boolean }
    | { kind: 'createdAt' | 'updatedAt'; desc: boolean }
    | { kind: 'index'; desc: boolean; name: string; type: IndexType };

  function parseSort(decl: Decl, raw: string | undefined): Sort {
    const s = raw ?? 'key';
    const desc = s.startsWith('-');
    const field = desc ? s.slice(1) : s;
    if (field === 'key') return { kind: 'key', desc };
    if (field === 'createdAt' || field === 'updatedAt') return { kind: field, desc };
    // `counter:<name>` / `mark:<name>` were removed: refused as any undeclared sort field.
    const type = decl.indexes.get(field);
    if (!type) throw refuse('index_not_declared', `sort field ${field} is not declared`, { field });
    return { kind: 'index', desc, name: field, type };
  }

  /** The value a document sorts by; `undefined` = not in this ordering. */
  function sortValue(sort: Sort, d: DocRow): string | number | undefined {
    switch (sort.kind) {
      case 'key':
        return '';
      case 'createdAt':
        return d.createdAt;
      case 'updatedAt':
        return d.updatedAt;
      case 'index': {
        const row = d.index.get(sort.name);
        if (!row || row.type !== sort.type) return undefined;
        return sort.type === 'string' ? row.text : row.num;
      }
    }
  }

  function list(ctx: Ctx, coll: string, q: ListQuery) {
    const decl = declOf(ctx, coll);
    const limit = q.limit ?? B.listLimitDefault;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > B.listLimitMax) throw invalid(`limit must be 1–${B.listLimitMax}`);
    const scope = scopeOf(ctx, coll);
    const sort = parseSort(decl, q.sort);
    let rows = docsIn(ctx, coll, scope);

    const where = Object.entries(q.where ?? {});
    if (where.length > B.equalityFilters) throw invalid(`at most ${B.equalityFilters} equality filter`);
    for (const [field, raw] of where) {
      const type = decl.indexes.get(field);
      if (!type) throw refuse('index_not_declared', `${field} is not a declared index`, { field });
      const want = indexValue(type, raw, field);
      rows = rows.filter((d) => {
        const row = d.index.get(field);
        return !!row && row.type === type && (type === 'string' ? row.text === want.text : row.num === want.num);
      });
    }
    if (q.keyPrefix !== undefined) {
      if (!/^[A-Za-z0-9._:-]{0,128}$/.test(q.keyPrefix)) {
        throw invalid('keyPrefix must be at most 128 characters of [A-Za-z0-9._:-]');
      }
      const prefix = q.keyPrefix;
      rows = rows.filter((d) => d.key.startsWith(prefix));
    }
    if (q.author !== undefined) {
      if (q.author !== 'me') throw invalid('author must be "me"');
      const me = requireViewer(ctx);
      rows = rows.filter((d) => d.authorKind === 'user' && d.authorUid === me);
    }

    const keyed = rows
      .map((d) => ({ d, v: sortValue(sort, d) }))
      .filter((x): x is { d: DocRow; v: string | number } => x.v !== undefined);
    const dir = sort.desc ? -1 : 1;
    const cmp = (a: string | number, b: string | number) =>
      typeof a === 'string' && typeof b === 'string' ? byCodePoint(a, b) : a < b ? -1 : a > b ? 1 : 0;
    const order = (a: { v: string | number; key: string }, b: { v: string | number; key: string }) =>
      (cmp(a.v, b.v) || cmp(a.key, b.key)) * dir;
    let ordered = keyed.map((x) => ({ d: x.d, v: x.v, key: x.d.key })).sort(order);
    // OPAQUE, and bound to the query that issued it: a token for a stored position,
    // refused (`invalid_request`) for any other collection, sort or filter.
    // (Stricter than the server, which binds a cursor to its sort only.)
    const binding = JSON.stringify([
      ctx.ns,
      coll,
      q.sort ?? 'key',
      q.where ?? {},
      q.keyPrefix ?? null,
      q.author ?? null,
    ]);
    if (q.cursor !== undefined) {
      const cur = cursors.get(q.cursor);
      if (!cur || cur.binding !== binding) throw invalid('invalid cursor');
      const bound = { v: cur.value, key: cur.key };
      ordered = ordered.filter((x) => order(x, bound) > 0);
    }
    storageOn();
    const page = ordered.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((x) => present(ctx, coll, x.d)),
      nextCursor: ordered.length > limit && last ? issueCursor(binding, last.v, last.key) : null,
    };
  }

  function storageOn() {
    if (options.disabled) throw refuse('storage_disabled', 'document storage is unavailable');
  }

  // --- the route -----------------------------------------------------------

  type Route =
    | { op: 'info' }
    | { op: 'list' | 'create' | 'getMany'; collection: string }
    | { op: 'get' | 'put' | 'delete'; collection: string; key: string }
    // The viewer's own document in a viewer-keyed collection; run as get / put / delete at the
    // derived key. `parent` is the raw path segment, checked by `viewerKeyedDocKey`.
    | { op: 'getMine' | 'putMine' | 'deleteMine'; collection: string; parent: string | null }

  function match(method: string, s: string[]): { route: Route } | { methods: string[] } | null {
    const [a, b, c] = s;
    const pick = (table: Record<string, Route>) =>
      table[method] ? { route: table[method]! } : { methods: Object.keys(table) };
    const pickMine = (collection: string, parent: string | null) =>
      pick({
        GET: { op: 'getMine', collection, parent },
        PUT: { op: 'putMine', collection, parent },
        DELETE: { op: 'deleteMine', collection, parent },
      });
    switch (s.length) {
      case 0:
        return pick({ GET: { op: 'info' } });
      case 1:
        if (a!.startsWith('_')) return null;
        return pick({ GET: { op: 'list', collection: a! }, POST: { op: 'create', collection: a! } });
      case 2:
        if (a === '_get') return pick({ POST: { op: 'getMany', collection: b! } });
        // `_publish` / `_unpublish` were removed: no route, as any other `_` segment.
        if (a!.startsWith('_')) return null;
        if (b === MINE) return pickMine(a!, null);
        return pick({
          GET: { op: 'get', collection: a!, key: b! },
          PUT: { op: 'put', collection: a!, key: b! },
          DELETE: { op: 'delete', collection: a!, key: b! },
        });
      case 3:
        if (a!.startsWith('_') || b !== MINE) return null;
        return pickMine(a!, c!);
      default:
        return null;
    }
  }

  type ListQuery = {
    where?: Record<string, string | number | boolean>;
    sort?: string;
    author?: string;
    keyPrefix?: string;
    limit?: number;
    cursor?: string;
  };

  function parseListQuery(query: Record<string, string | string[]>, decl: Decl): ListQuery {
    const q: ListQuery = {};
    for (const [name, raw] of Object.entries(query)) {
      if (Array.isArray(raw)) throw invalid(`${name} must be given once`);
      const where = /^where\[([^\]]+)\]$/.exec(name);
      if (where) {
        const field = where[1]!;
        let value: string | number | boolean = raw;
        const type = decl.indexes.get(field);
        if (type === 'number') {
          if (raw.trim() === '' || !Number.isFinite(Number(raw))) throw invalid(`where[${field}] must be a number`);
          value = Number(raw);
        } else if (type === 'boolean') {
          if (raw !== 'true' && raw !== 'false') throw invalid(`where[${field}] must be true or false`);
          value = raw === 'true';
        } else if (type === 'time' && /^-?[0-9]+$/.test(raw)) {
          value = Number(raw);
        }
        q.where = { ...q.where, [field]: value };
        continue;
      }
      if (name === 'from') continue; // the import selector, resolved before the route runs
      // `markedBy` and `mark` were removed: refused as any unknown parameter.
      if (!['sort', 'author', 'keyPrefix', 'limit', 'cursor'].includes(name)) {
        throw invalid(`unknown query parameter ${name}`);
      }
      if (name === 'limit') {
        if (!/^[0-9]{1,3}$/.test(raw)) throw invalid('limit must be an integer');
        q.limit = Number(raw);
      } else if (name === 'author') {
        if (raw !== 'me') throw invalid(`${name} must be "me"`);
        q.author = 'me';
      } else {
        q[name as 'sort' | 'keyPrefix' | 'cursor'] = raw;
      }
    }
    return q;
  }

  /** A strict body: an object holding only `allowed` keys, each passing its check. */
  function parseBody(body: unknown, allowed: Record<string, (v: unknown) => boolean>, required: string[] = []) {
    const value = body === undefined ? {} : body;
    const issues: { path: string; message: string }[] = [];
    if (!isObject(value)) issues.push({ path: '', message: 'expected an object' });
    else {
      for (const k of Object.keys(value)) {
        if (!(k in allowed)) issues.push({ path: k, message: 'unrecognized key' });
        else if (value[k] !== undefined && !allowed[k]!(value[k])) issues.push({ path: k, message: 'invalid value' });
      }
      for (const k of required) if (value[k] === undefined) issues.push({ path: k, message: 'required' });
    }
    if (issues.length > 0) throw invalid('invalid request body', { issues });
    return value as Record<string, unknown>;
  }
  const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

  /** Every string leaf and object key, plus the document key when the app chose it. */
  function moderateWrite(input: { data?: Record<string, unknown>; key?: string }) {
    const fields: string[][] = [];
    if (input.data !== undefined) {
      const texts: string[] = [];
      const walk = (v: unknown) => {
        if (typeof v === 'string') texts.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (isObject(v)) {
          for (const [k, x] of Object.entries(v)) {
            texts.push(k);
            walk(x);
          }
        }
      };
      walk(input.data);
      fields.push(texts);
    }
    if (input.key !== undefined) fields.push([input.key]);
    for (const texts of fields) {
      const verdicts = texts.map(moderate);
      if (verdicts.includes('unavailable')) {
        throw refuse('moderation_unavailable', 'content could not be reviewed right now', { retryAfter: 5 });
      }
      const hit = verdicts.includes('link') ? 'link' : verdicts.includes('blocked') ? 'blocked' : null;
      if (hit) throw refuse('content_rejected', 'content was rejected by moderation', { category: hit });
    }
  }

  function assertTrusted(viewer: FakeStorageViewer) {
    if (viewer.trusted === false) {
      throw refuse('not_eligible', 'this account cannot write shared data yet', {
        reason: viewer.untrustedReason ?? 'account_too_new',
      });
    }
  }

  /**
   * The collection's `ownedModelVersions` rule, as the server's
   * `doc-store-ownership.ts` applies it: a pointer that resolves to nothing is
   * allowed; every value found must be a positive `integer` id — all of them are
   * checked before any ownership — and then the writer's own version. One code
   * and message for every reason, so a refusal reveals nothing about whether a
   * version exists.
   */
  function assertOwnedModelVersions(decl: Decl, data: Record<string, unknown>, viewer: FakeStorageViewer) {
    if (decl.ownedModelVersions.length === 0) return;
    const notOwned = (pointer: string) =>
      refuse('resource_not_owned', 'the model version at this field is not one the author owns', { pointer });
    const claimed: { pointer: string; id: number }[] = [];
    for (const pointer of decl.ownedModelVersions) {
      let cur: unknown = data;
      let found = true;
      for (const seg of pointer.split('/').slice(1)) {
        if (!isObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) {
          found = false;
          break;
        }
        cur = cur[seg];
      }
      if (!found) continue;
      if (typeof cur !== 'number' || !Number.isInteger(cur) || cur < 1 || cur > INT4_MAX) throw notOwned(pointer);
      claimed.push({ pointer, id: cur });
    }
    const owned = new Set(viewer.modelVersions ?? []);
    for (const { pointer, id } of claimed) {
      if (!owned.has(id)) throw notOwned(pointer);
    }
  }

  /**
   * The collection's `schema`, against the WHOLE body the write would store (a put replaces
   * it). The server checks it in the route layer first, so a refusal spends nothing.
   */
  function assertMatchesSchema(coll: string, decl: Decl, data: unknown) {
    const failure = decl.schema?.(data);
    if (!failure) return;
    throw refuse('schema_violation', schemaViolationMessage(coll, failure), {
      collection: coll,
      pointer: failure.pointer,
      keyword: failure.keyword,
    });
  }

  /** The server's refusals that are ITS fault: refunded without a rejection charge. */
  const isOurFault = (err: unknown) =>
    !(err instanceof Refusal) ||
    (err.code === 'rate_limited' ? err.details?.reason === 'contention' : ['storage_disabled', 'moderation_unavailable', 'consent_unavailable'].includes(err.code));

  function handle(
    caller: FakeStorageCaller & { token: NonNullable<FakeStorageCaller['token']> },
    method: string,
    path: string,
    query: Record<string, string | string[]>,
    sent: unknown,
  ) {
    const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
    // The report API is its own page beside the storage catch-all, behind the same middleware.
    const reporting = segments.join('/') === REPORTS_PATH;
    if (!reporting && (segments[0] !== 'blocks' || segments[1] !== 'storage')) {
      throw new Error(`fake storage: no route for ${path}`);
    }
    let rest: string[];
    try {
      rest = reporting ? [] : segments.slice(2).map((s) => decodeURIComponent(s));
    } catch {
      throw refuse('not_found', 'no such storage route');
    }
    // The wire: only POST and PUT bodies are read, and only what JSON carries.
    const body =
      (method === 'POST' || method === 'PUT') && sent !== undefined
        ? (JSON.parse(JSON.stringify(sent)) as unknown)
        : undefined;
    const viewer = caller.viewer === undefined ? defaultViewer : caller.viewer;
    const app = apps.get(caller.app ?? ownId);
    if (!app) throw new Error(`fake storage: no app ${String(caller.app)} — name it in \`sources\``);

    // The token middleware: its refusals come first, whatever the path.
    if (caller.token === 'none') throw refuse('unauthenticated', 'a block token is required');
    if (app.status !== 'approved') {
      throw refuse('not_eligible', 'app block is not approved', { reason: 'app_not_approved' });
    }
    const consent = app.consent;
    const consentUnavailable = consent === 'unavailable';
    const revoked: readonly string[] = consent === undefined || consent === 'unavailable' ? [] : consent.revoked;
    const tokenScopes = (caller.scopes ?? app.scopes).filter(
      (s) => !(CONSENT_GATED.has(s) && (consentUnavailable || revoked.includes(s))),
    );
    if (!tokenScopes.includes(BASE_SCOPE)) throw refuse('insufficient_scope', `${BASE_SCOPE} scope required`);
    if (reporting) {
      const reporter = viewer === null ? null : uidOf(viewer);
      // Its dev-token sign-in refusal comes after the route's own existence check (reportDoc).
      const reporterCtx: Ctx = { app, ns: `${app.id}\u0000${caller.token === 'dev' ? `dev:${reporter}` : 'prod'}`, uid: reporter };
      return reportDoc(caller, method, query, body, viewer, reporterCtx, tokenScopes, consentUnavailable);
    }

    const m = match(method, rest);
    if (!m) throw refuse('not_found', 'no such storage route');
    if ('methods' in m) throw refuse('method_not_allowed', 'method not allowed');
    let route = m.route;
    // Every collection route also takes `from` (an import); `info` takes none.
    const allowedQuery =
      route.op === 'list'
        ? null
        : route.op === 'delete' || route.op === 'deleteMine'
          ? ['ifVersion', 'from']
          : route.op === 'info'
            ? []
            : ['from'];
    if (allowedQuery) {
      const stray = Object.keys(query).find((k) => !allowedQuery.includes(k));
      if (stray) throw invalid(`unknown query parameter ${stray}`);
    }
    const uid = viewer === null ? null : uidOf(viewer);
    if (caller.token === 'dev' && uid === null) throw refuse('sign_in_required', 'sign in required');
    const ownCtx: Ctx = { app, ns: `${app.id}\u0000${caller.token === 'dev' ? `dev:${uid}` : 'prod'}`, uid };
    // Before the body is read, as the server resolves it; the call then runs AS THE SOURCE:
    // its data, declarations, ceilings and rate limits, and only the scopes the import confers.
    const imported =
      route.op === 'info'
        ? null
        : resolveImport(caller, route.collection, importOpOf(route), query.from, ownCtx, tokenScopes, consentUnavailable);
    const ctx = imported?.ctx ?? ownCtx;
    const scopes: readonly string[] = imported?.scopes ?? tokenScopes;
    const consentGone = imported ? false : consentUnavailable;
    const from = imported?.from;
    /** A write that changes what the collection's other viewers see, without the publish scope. */
    const publishRefusal = () =>
      consentGone
        ? refuse('consent_unavailable', 'permission state is temporarily unavailable', { retryAfter: 1 })
        : from === undefined
          ? refuse('consent_required', `${PUBLISH_SCOPE} has not been granted`, { scope: PUBLISH_SCOPE })
          : refuse('consent_required', `${PUBLISH_SCOPE} has not been granted in ${from}`, { scope: PUBLISH_SCOPE, from });
    if (body !== undefined && utf8Length(JSON.stringify(body)) > BODY_LIMIT_BYTES) {
      throw refuse('too_large', `request body exceeds ${BODY_LIMIT_BYTES} bytes`, { limit: BODY_LIMIT_BYTES });
    }
    const requireSignedIn = (): number => {
      if (uid === null) throw refuse('sign_in_required', 'sign in required');
      return uid;
    };

    const mine = route.op === 'getMine' || route.op === 'putMine' || route.op === 'deleteMine';
    // Every `@me` op, reads included, is the signed-in viewer's own: anonymous is refused first.
    if (route.op === 'info' || mine) requireSignedIn();
    if (route.op === 'info' || route.op === 'list' || route.op === 'get' || route.op === 'getMany' || route.op === 'getMine') {
      charge('read', uid, ctx.app.id);
    }
    if (route.op === 'info') {
      storageOn();
      const app = appUsage.get(ctx.ns) ?? { bytes: 0, docs: 0 };
      const mine = userUsage.get(`${ctx.ns}\u0000${uid}`) ?? { bytes: 0, docs: 0 };
      return {
        status: 200,
        body: {
          collections: Object.fromEntries(
            [...ctx.app.collections].map(([name, d]) => [
              name,
              {
                kind: 'docs',
                visibility: d.visibility,
                ...(d.visibility === 'shared' ? { write: d.write ?? 'own' } : {}),
                // Always empty, whatever the manifest declares (the server's `presentDeclaration`).
                counters: [],
                marks: [],
                indexes: Object.fromEntries(d.indexes),
                showAuthor: d.showAuthor,
                // `open`: whether a `@me` write can land at all (`isViewerKeyedWritable`).
                ...(d.keyedBy
                  ? { keyedBy: d.keyedBy, open: !options.viewerKeysUnconfigured && viewerKeyedOpen(ctx, name) }
                  : {}),
              },
            ]),
          ),
          limits: {
            docBytes: B.docBytes,
            appBytes: limits.appBytes,
            appDocs: limits.appDocs,
            viewerBytes: limits.viewerBytes,
            viewerDocs: limits.viewerDocs,
            listLimitMax: B.listLimitMax,
            getManyMax: B.getManyMax,
            rate: {
              readsPerMinute: RATE.read.max,
              privateWritesPerMinute: RATE.write.max,
              // Removed with marks and counters; the server still sends 0 for SDKs before 0.33.
              marksAndCountersPerMinute: 0,
              reportsPerDay: RATE.report.max,
              sharedWritesBurst: SHARED_WRITE_BUDGET[0]![0],
              sharedWritesPerDay: SHARED_WRITE_BUDGET[1]![0],
            },
          },
          usage: { app: { ...app }, viewer: { ...mine } },
        },
      };
    }

    if (!COLLECTION_NAME.test(route.collection) || !ctx.app.collections.has(route.collection)) {
      throw refuse('collection_not_declared', `collection ${route.collection} is not declared`, { collection: route.collection });
    }
    const coll = route.collection;
    const decl = declOf(ctx, coll);
    const shared = decl.visibility === 'shared';
    // VIEWER-KEYED: a `@me` route becomes exactly the get, put or delete of the viewer's own
    // document at the derived key, so every check below applies to it as to any document; its
    // parent is what a put's moderation scan sees in place of the key. A create, or a write by
    // key, to a viewer-keyed collection is refused.
    let keyed: { parent: string | null } | null = null;
    if (route.op === 'getMine' || route.op === 'putMine' || route.op === 'deleteMine') {
      const key = viewerKeyedDocKey(ctx, coll, decl, route.parent, route.op !== 'getMine');
      keyed = { parent: route.parent };
      route = { op: route.op === 'getMine' ? 'get' : route.op === 'putMine' ? 'put' : 'delete', collection: coll, key };
    } else if (route.op === 'create' || route.op === 'put' || route.op === 'delete') {
      refuseViewerKeyed(coll, decl, 'writing by key');
    }

    switch (route.op) {
      case 'getMine':
      case 'putMine':
      case 'deleteMine':
        throw new Error('fake storage: a @me route is translated above');
      case 'list':
        return { status: 200, body: list(ctx, coll, parseListQuery(query, decl)) };
      case 'get': {
        const [doc] = getMany(ctx, coll, [route.key]);
        if (!doc) throw refuse('not_found', 'document not found');
        return { status: 200, body: doc };
      }
      case 'getMany': {
        const { keys } = parseBody(body, { keys: isStringArray }, ['keys']);
        return { status: 200, body: { items: getMany(ctx, coll, keys as unknown[]) } };
      }
      case 'create':
      case 'put':
      case 'delete': {
        const me = requireSignedIn();
        assertShareWritable(decl);
        if (route.op !== 'delete' && shared && decl.write === 'own' && !scopes.includes(PUBLISH_SCOPE)) {
          throw publishRefusal();
        }
        const created = route.op === 'create' ? parseBody(body, { data: isObject }, ['data']) : null;
        const putIn = route.op === 'put' ? parseBody(body, { data: isObject, ifVersion: isNumber }, ['data']) : null;
        let deleteVersion: number | undefined;
        if (route.op === 'delete' && query.ifVersion !== undefined) {
          const raw = query.ifVersion;
          if (Array.isArray(raw) || !/^[0-9]{1,15}$/.test(raw)) throw invalid('ifVersion must be a non-negative integer');
          deleteVersion = Number(raw);
        }
        // Every write that sets `data`, before the trust gate, the write budget and the
        // moderation scan (and so before the store's own checks), as the server orders it:
        // the collection's schema, then the owned-model-version rule.
        const newData = created?.data ?? putIn?.data;
        if (newData) assertMatchesSchema(coll, decl, newData);
        if (newData) assertOwnedModelVersions(decl, newData as Record<string, unknown>, viewer!);
        const write = (moderated: boolean, landed: () => void) => {
          if (created) {
            if (moderated) moderateWrite({ data: created.data as Record<string, unknown> });
            const doc = writeDoc(ctx, coll, newKey(), created.data, 0);
            landed();
            return { status: 201, body: doc };
          }
          if (putIn && route.op === 'put') {
            // A viewer-keyed document's key is a digest, not client text: only its parent is scanned.
            const scannedKey = keyed ? (keyed.parent ?? undefined) : route.key;
            if (moderated) moderateWrite({ data: putIn.data as Record<string, unknown>, key: scannedKey });
            const doc = writeDoc(ctx, coll, route.key, putIn.data, putIn.ifVersion as number | undefined);
            landed();
            return { status: 200, body: doc };
          }
          if (route.op !== 'delete') throw new Error('fake storage: unreachable write op');
          return { status: 200, body: remove(ctx, coll, route.key, deleteVersion) };
        };
        if (!shared || route.op === 'delete') {
          charge('write', uid, ctx.app.id);
          return write(false, () => undefined);
        }
        assertTrusted(viewer!);
        const release = reserveSharedWrite(`${ctx.app.id}:${me}`);
        let hasLanded = false;
        try {
          return write(true, () => {
            hasLanded = true;
          });
        } catch (err) {
          if (!hasLanded) release(!isOurFault(err));
          throw err;
        }
      }
    }
  }

  /**
   * What a route does, for an import (the server's `importOpOf`): a read, a delete, or an
   * authoring write — the only kind that can need the viewer's publish consent in the source.
   */
  function importOpOf(route: Exclude<Route, { op: 'info' }>): 'read' | 'delete' | 'author' {
    if (route.op === 'list' || route.op === 'get' || route.op === 'getMany' || route.op === 'getMine') return 'read';
    return route.op === 'delete' || route.op === 'deleteMine' ? 'delete' : 'author';
  }

  /**
   * `POST blocks/moderation/reports {collection, key, from?}`, as the server's report handler
   * runs it, in its order: the per-app switch (`reports`), the method, the query and the body,
   * an import (an authoring call), the collection, sign-in, shared only, the import's publish
   * scope, the daily report budget, the trust gate, then the document. One row per (document,
   * viewer); the answer is the same whether or not it was new, and never a count.
   */
  function reportDoc(
    caller: FakeStorageCaller & { token: NonNullable<FakeStorageCaller['token']> },
    method: string,
    query: Record<string, string | string[]>,
    body: unknown,
    viewer: FakeStorageViewer | null,
    ownCtx: Ctx,
    tokenScopes: readonly string[],
    consentUnavailable: boolean,
  ) {
    // Off, the path is not a route at all, before any other answer (sign-in and a 405 included).
    if (options.reports !== true) throw refuse('not_found', 'no such route');
    if (caller.token === 'dev' && ownCtx.uid === null) throw refuse('sign_in_required', 'sign in required');
    if (method !== 'POST') throw refuse('method_not_allowed', 'method not allowed');
    const stray = Object.keys(query)[0];
    if (stray !== undefined) throw invalid(`unknown query parameter ${stray}`);
    const isString = (v: unknown) => typeof v === 'string';
    const input = parseBody(body, { collection: isString, key: isString, from: isString }, ['collection', 'key']);
    const coll = input.collection as string;
    const imported = resolveImport(
      caller,
      coll,
      'author',
      input.from as string | undefined,
      ownCtx,
      tokenScopes,
      consentUnavailable,
    );
    const ctx = imported?.ctx ?? ownCtx;
    if (!COLLECTION_NAME.test(coll) || !ctx.app.collections.has(coll)) {
      throw refuse('collection_not_declared', `collection ${coll} is not declared`, { collection: coll });
    }
    fileReport(ctx, coll, declOf(ctx, coll), input.key as string, viewer, imported);
    return { status: 200, body: { reported: true } };
  }

  /**
   * FILE ONE REPORT, as the server's `fileReport` runs it, in its order: sign-in, shared only, the import's publish
   * scope, the daily report budget, the trust gate, then the document. One row per (document,
   * viewer); the answer is the same whether or not it was new, and never a count.
   */
  function fileReport(
    ctx: Ctx,
    coll: string,
    decl: Decl,
    key: string,
    viewer: FakeStorageViewer | null,
    imported: { scopes: readonly string[]; from: string } | null,
  ): void {
    const uid = requireViewer(ctx);
    if (decl.visibility !== 'shared') throw invalid('reports exist on shared collections only');
    if (imported && !imported.scopes.includes(PUBLISH_SCOPE)) {
      throw refuse('consent_required', `${PUBLISH_SCOPE} has not been granted in ${imported.from}`, {
        scope: PUBLISH_SCOPE,
        from: imported.from,
      });
    }
    charge('report', uid, ctx.app.id);
    assertTrusted(viewer!);
    assertKey(key);
    storageOn();
    const row = docs.get(docId(ctx, coll, 0, key));
    if (!row) throw refuse('not_found', 'document not found');
    row.reports.add(uid);
  }

  /**
   * `?from=<blockId>` on a collection route, as the server's `resolveImportAccess` checks it,
   * in its order — or `null` without one. Charged to the CONSUMER's read bucket first, so
   * every refusal below is charged too.
   */
  function resolveImport(
    caller: FakeStorageCaller & { token: NonNullable<FakeStorageCaller['token']> },
    coll: string,
    op: 'read' | 'delete' | 'author',
    from: string | string[] | undefined,
    consumer: Ctx,
    tokenScopes: readonly string[],
    consentUnavailable: boolean,
  ): { ctx: Ctx; scopes: string[]; from: string } | null {
    if (from === undefined) return null;
    if (Array.isArray(from)) throw invalid('from must be given once');
    charge('read', consumer.uid, consumer.app.id);
    if (!BLOCK_ID.test(from)) throw invalid('from must be an app blockId', { from });
    // Only an ordinary production token imports. (Hub and review tokens are not modelled.)
    if (caller.token === 'dev') {
      throw refuse('not_eligible', 'a development token cannot reach another app', { reason: 'import_dev_token' });
    }
    const declared = consumer.app.imports.get(from);
    if (!declared || !declared.collections.has(coll)) {
      throw refuse('import_not_declared', `this app does not declare an import of ${coll} from ${from}`, {
        from,
        collection: coll,
      });
    }
    if (op !== 'read' && declared.access === 'read') {
      throw refuse('write_policy', `the import from ${from} is read-only`, { from, reason: 'import_read_only' });
    }
    if (consumer.uid === null) throw refuse('sign_in_required', 'sign in required');
    // A source's own imports are never followed, and a source is never this app.
    const source = from === consumer.app.id ? undefined : apps.get(from);
    if (!source || source.status !== 'approved') {
      throw refuse('not_eligible', `the app ${from} is not available`, { reason: 'source_not_approved' });
    }
    const decl = source.collections.get(coll);
    if (!decl) throw refuse('collection_not_declared', `collection ${coll} is not declared by ${from}`, { collection: coll, from });
    if (!decl.exportable) throw refuse('not_exportable', `${from} does not share ${coll} with other apps`, { collection: coll, from });
    const consentRequired = () =>
      refuse('consent_required', `${IMPORT_SCOPE} has not been granted`, { scope: IMPORT_SCOPE, from });
    if (!tokenScopes.includes(IMPORT_SCOPE)) {
      if (consentUnavailable) {
        throw refuse('consent_unavailable', 'permission state is temporarily unavailable', { retryAfter: 1 });
      }
      throw consentRequired();
    }
    // The viewer's grant must cover the CURRENT import: every collection it names, at its access.
    const grant = importGrants[from];
    if (
      !grant ||
      ![...declared.collections].every((c) => grant.collections.includes(c)) ||
      (declared.access === 'readwrite' && grant.access !== 'readwrite')
    ) {
      throw consentRequired();
    }
    // The viewer's own publish consent IN THE SOURCE, for an authoring call only. The
    // consumer's own `apps:storage:publish` never counts.
    const sourceRevoked: readonly string[] =
      source.consent === undefined || source.consent === 'unavailable' ? [] : source.consent.revoked;
    const publishes =
      op === 'author' &&
      declared.access === 'readwrite' &&
      source.scopes.includes(PUBLISH_SCOPE) &&
      !sourceRevoked.includes(PUBLISH_SCOPE);
    return {
      ctx: { app: source, ns: `${source.id}\u0000prod`, uid: consumer.uid },
      scopes: publishes ? [BASE_SCOPE, PUBLISH_SCOPE] : [BASE_SCOPE],
      from,
    };
  }

  /** A sortable server-chosen key, ULID-shaped: time, then a per-fake sequence. */
  let seq = 0;
  const newKey = () => `${now().toString(36).padStart(10, '0')}${(seq++).toString(36).padStart(16, '0')}`.toUpperCase();

  function session(caller: FakeStorageCaller): FakeStorageSession {
    const resolved = { ...caller, token: caller.token ?? 'block' };
    const http = (async (method: string, path: string, opts: RequestOptions = {}) => {
      // The query as a URL carries it: null/undefined dropped, everything a string.
      const query: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        const values = (Array.isArray(v) ? v : [v]).filter((x) => x != null).map(String);
        if (values.length === 1) query[k] = values[0]!;
        else if (values.length > 1) query[k] = values;
      }
      const call: FakeStorageCall = { method, path, query, body: opts.body, status: 0, response: undefined };
      calls.push(call);
      try {
        const reply = handle(resolved, method, path, query, opts.body);
        call.status = reply.status;
        call.response = JSON.parse(JSON.stringify(reply.body)) as unknown;
        return call.response;
      } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        const response: Record<string, unknown> = { code: err.code, message: err.message, error: err.message };
        if (err.details) response.details = err.details;
        call.status = STATUS[err.code] ?? 500;
        call.response = response;
        throw new ApiError(call.status, err.message, response);
      }
    }) as Http;
    const prompt = options.requestGrants;
    const requestGrants =
      prompt &&
      (async (scopes: readonly string[], { from }: { from?: string }) => {
        const allowed = await prompt(scopes, { from });
        // Allow records the publish grant IN THE SOURCE, which every later write there reads.
        const source = from === undefined ? undefined : apps.get(from);
        if (allowed && source && from !== ownId && scopes.length === 1 && scopes[0] === PUBLISH_SCOPE) {
          const revoked = source.consent === undefined || source.consent === 'unavailable' ? [] : source.consent.revoked;
          source.consent = { revoked: revoked.filter((s) => s !== PUBLISH_SCOPE) };
        }
        return allowed;
      });
    const grants = requestGrants ? { requestGrants } : {};
    return { http, storage: createDocumentStorage(http, grants), moderation: createModerationClient(http, grants) };
  }

  const own = session({});
  return { ...own, as: session, calls };
}
