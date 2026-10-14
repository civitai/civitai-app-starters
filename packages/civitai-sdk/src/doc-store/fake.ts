import { ApiError, type Http, type RequestOptions } from '../http/index.js';
import { createDocumentStorage, type DocumentStorage } from './index.js';

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
 * NOT MODELLED: moderator hides (a hidden document reads as not found on the server;
 * nothing here hides one), moderator exemption from the scanner, the review-preview
 * namespace, and the token middleware's other refusals (revoked instance, context
 * binding, an approval read that fails).
 */

// ---------------------------------------------------------------------------
// Bounds — the server's, one copy here (the contract run pins the ones it reaches)
// ---------------------------------------------------------------------------

const BASE_SCOPE = 'apps:storage';
const PUBLISH_SCOPE = 'apps:storage:publish';
/** Scopes the host strips when the viewer revokes consent; `apps:storage` is consent-exempt. */
const CONSENT_GATED = new Set([PUBLISH_SCOPE]);

const COLLECTION_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const TALLY_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const INDEX_PATH = /^[A-Za-z][A-Za-z0-9_]{0,31}(\.[A-Za-z][A-Za-z0-9_]{0,31}){0,2}$/;
const KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const DOT_ONLY = /^\.+$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const REPORT = 'report';
const RESERVED_INDEX_NAMES = ['key', 'createdAt', 'updatedAt'];
const INDEX_TYPES = ['string', 'number', 'boolean', 'time'] as const;
const WRITE_POLICIES = ['own', 'anyone', 'owner', 'none'] as const;

const B = {
  docBytes: 65536,
  depth: 16,
  stringIndexBytes: 128,
  equalityFilters: 1,
  listLimitMax: 100,
  listLimitDefault: 25,
  getManyMax: 100,
  cursorChars: 512,
  incrementMax: 100,
  maxCollections: 16,
  maxTallies: 8,
  maxIndexes: 4,
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
type RateBucket = 'read' | 'write' | 'tally' | 'report';
const RATE: Record<RateBucket, { max: number; windowSeconds: number }> = {
  read: { max: 300, windowSeconds: MINUTE },
  write: { max: 120, windowSeconds: MINUTE },
  tally: { max: 30, windowSeconds: MINUTE },
  report: { max: 20, windowSeconds: DAY },
};
/** burst, daily, rejections: [capacity, refill interval ms]. */
const SHARED_WRITE_BUDGET: readonly (readonly [number, number])[] = [
  [10, 6 * 60 * 1000],
  [50, (DAY * 1000) / 50],
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
  unauthenticated: 401,
  sign_in_required: 401,
  insufficient_scope: 403,
  consent_required: 403,
  not_eligible: 403,
  not_author: 403,
  write_policy: 403,
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
}

/** Who is calling: a viewer (or `null`, anonymous) holding a token of some kind and scopes. */
export interface FakeStorageCaller {
  /** Default: the fake's `viewer`. `null` is an anonymous viewer with a token. */
  viewer?: FakeStorageViewer | null;
  /** `block` (default), `dev` (the developer's own namespace) or `none` (no token at all). */
  token?: 'block' | 'dev' | 'none';
  /** The token's scopes. Default: the manifest's `scopes`. */
  scopes?: readonly string[];
}

export type FakeModerationVerdict = 'blocked' | 'link' | 'unavailable' | null;

export interface FakeStorageOptions {
  /** The app's manifest; `storage.collections` is what the fake enforces. */
  manifest: { scopes?: readonly string[]; storage?: unknown };
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
  /** The clock rate limits and timestamps read. Default `Date.now`. */
  now?: () => number;
  /**
   * Classify one string (a value, an object key or a document key) of a shared write.
   * Default: {@link FAKE_STORAGE_MODERATION}'s words.
   */
  moderate?: (text: string) => FakeModerationVerdict;
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
  kind: string;
  visibility: 'private' | 'shared';
  write?: string;
  counters: string[];
  marks: string[];
  indexes: Map<string, IndexType>;
  showAuthor: boolean;
  ttlSeconds?: unknown;
  maxEntries?: unknown;
  dailyWritesPerAuthor?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The declaration's SHAPE, every phased feature admitted — as the server reads an
 * approved manifest. A collection using a feature that is not built yet is refused at
 * use, per collection (`invalid_request`), exactly as the store does.
 */
function parseManifest(manifest: unknown): Map<string, Decl> {
  const out = new Map<string, Decl>();
  if (!isObject(manifest) || manifest.storage === undefined) return out;
  const errors: string[] = [];
  const storage = manifest.storage;
  if (!isObject(storage) || !isObject(storage.collections)) {
    throw new Error('createFakeStorage: manifest.storage.collections must be an object');
  }
  for (const k of Object.keys(storage)) if (k !== 'collections') errors.push(`storage.${k} is not allowed`);
  const names = Object.keys(storage.collections);
  if (names.length === 0 || names.length > B.maxCollections) errors.push('storage.collections: 1 to 16 collections');
  for (const name of names) {
    const at = `storage.collections.${name}`;
    const raw = storage.collections[name];
    if (!COLLECTION_NAME.test(name)) errors.push(`${at}: invalid collection name`);
    if (!isObject(raw)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    for (const k of Object.keys(raw)) {
      if (!['kind', 'visibility', 'write', 'counters', 'marks', 'indexes', 'showAuthor', 'ttlSeconds', 'maxEntries', 'dailyWritesPerAuthor'].includes(k)) {
        errors.push(`${at}.${k} is not allowed`);
      }
    }
    if (raw.visibility !== 'private' && raw.visibility !== 'shared') {
      errors.push(`${at}.visibility must be private or shared`);
      continue;
    }
    const shared = raw.visibility === 'shared';
    if (raw.kind !== undefined && raw.kind !== 'docs' && raw.kind !== 'log') errors.push(`${at}.kind must be docs or log`);
    if (!shared && raw.write !== undefined) errors.push(`${at}.write applies only to shared collections`);
    if (shared && !(WRITE_POLICIES as readonly unknown[]).includes(raw.write)) {
      errors.push(`${at}.write must be one of ${WRITE_POLICIES.join(', ')}`);
    }
    const tallies = (field: 'counters' | 'marks'): string[] => {
      const list = raw[field];
      if (list === undefined) return [];
      if (!shared) errors.push(`${at}.${field} applies only to shared collections`);
      if (!Array.isArray(list) || list.length > B.maxTallies) {
        errors.push(`${at}.${field} must be an array of at most ${B.maxTallies} names`);
        return [];
      }
      for (const n of list) {
        if (typeof n !== 'string' || !TALLY_NAME.test(n) || n === REPORT) errors.push(`${at}.${field}: invalid name ${String(n)}`);
      }
      if (new Set(list).size !== list.length) errors.push(`${at}.${field}: duplicate name`);
      return list as string[];
    };
    const counters = tallies('counters');
    const marks = tallies('marks');
    if (counters.some((c) => marks.includes(c))) errors.push(`${at}: a name is both a counter and a mark`);
    if (raw.write === 'none' && counters.length === 0 && marks.length === 0) {
      errors.push(`${at}: write "none" needs at least one counter or mark`);
    }
    const indexes = new Map<string, IndexType>();
    if (raw.indexes !== undefined) {
      if (!isObject(raw.indexes) || Object.keys(raw.indexes).length > B.maxIndexes) {
        errors.push(`${at}.indexes must map at most ${B.maxIndexes} field paths to a type`);
      } else {
        for (const [path, type] of Object.entries(raw.indexes)) {
          if (!INDEX_PATH.test(path) || RESERVED_INDEX_NAMES.includes(path)) errors.push(`${at}.indexes: invalid path ${path}`);
          else if (!(INDEX_TYPES as readonly unknown[]).includes(type)) errors.push(`${at}.indexes.${path}: invalid type`);
          else indexes.set(path, type as IndexType);
        }
      }
    }
    if (raw.showAuthor !== undefined && (!shared || typeof raw.showAuthor !== 'boolean')) {
      errors.push(`${at}.showAuthor must be a boolean on a shared collection`);
    }
    const decl: Decl = {
      kind: typeof raw.kind === 'string' ? raw.kind : 'docs',
      visibility: raw.visibility,
      counters,
      marks,
      indexes,
      showAuthor: raw.showAuthor === true,
    };
    if (shared && typeof raw.write === 'string') decl.write = raw.write;
    if (raw.ttlSeconds !== undefined) decl.ttlSeconds = raw.ttlSeconds;
    if (raw.maxEntries !== undefined) decl.maxEntries = raw.maxEntries;
    if (raw.dailyWritesPerAuthor !== undefined) decl.dailyWritesPerAuthor = raw.dailyWritesPerAuthor;
    out.set(name, decl);
  }
  if (errors.length > 0) throw new Error(`createFakeStorage: invalid storage declaration:\n- ${errors.join('\n- ')}`);
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
  counters: Map<string, number>;
  markCounts: Map<string, number>;
  /** `${uid}:${name}` */
  marks: Set<string>;
}

interface Usage {
  bytes: number;
  docs: number;
}

interface Ctx {
  ns: string;
  uid: number | null;
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

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

const base64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromBase64url = (text: string) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
};

// ---------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------

export function createFakeStorage(options: FakeStorageOptions): FakeStorage {
  const collections = parseManifest(options.manifest);
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
  const budgets = new Map<number, number[]>();

  const scopeOf = (ctx: Ctx, coll: string): number => {
    if (collections.get(coll)!.visibility === 'shared') return 0;
    if (ctx.uid === null) throw refuse('sign_in_required', 'sign in required');
    return ctx.uid;
  };
  const docId = (ctx: Ctx, coll: string, scope: number, key: string) => `${ctx.ns}\u0000${coll}\u0000${scope}\u0000${key}`;
  const docsIn = (ctx: Ctx, coll: string, scope: number) => {
    const prefix = `${ctx.ns}\u0000${coll}\u0000${scope}\u0000`;
    return [...docs].filter(([id]) => id.startsWith(prefix)).map(([, d]) => d);
  };

  // --- rate limits ---------------------------------------------------------

  /** A fixed window from the first request; every request counts, refused ones too. */
  function charge(bucket: RateBucket, uid: number | null) {
    const { max, windowSeconds } = RATE[bucket];
    const id = `${bucket}:${uid === null ? 'ip' : `u:${uid}`}`;
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

  /** Three continuously refilling buckets; each slot is the instant that bucket is full again. */
  function reserveSharedWrite(uid: number) {
    const t = now();
    const full = (budgets.get(uid) ?? [t, t, t]).map((f) => Math.max(f, t));
    let wait = 0;
    SHARED_WRITE_BUDGET.forEach(([cap, iv], i) => {
      wait = Math.max(wait, full[i]! - t - (cap - 1) * iv);
    });
    if (wait > 0) {
      throw refuse('rate_limited', 'shared write budget exhausted', {
        bucket: 'shared-write',
        retryAfter: Math.max(1, Math.ceil(wait / 1000)),
      });
    }
    full[0]! += SHARED_WRITE_BUDGET[0]![1];
    full[1]! += SHARED_WRITE_BUDGET[1]![1];
    budgets.set(uid, full);
    return (rejected: boolean) => {
      const t2 = now();
      const f = (budgets.get(uid) ?? [t2, t2, t2]).map((x) => Math.max(x, t2));
      f[0] = Math.max(f[0]! - SHARED_WRITE_BUDGET[0]![1], t2);
      f[1] = Math.max(f[1]! - SHARED_WRITE_BUDGET[1]![1], t2);
      if (rejected) {
        const [cap, iv] = SHARED_WRITE_BUDGET[2]!;
        f[2] = Math.min(f[2]! + iv, t2 + 2 * cap * iv);
      }
      budgets.set(uid, f);
    };
  }

  // --- store ---------------------------------------------------------------

  function assertCollection(name: string): Decl {
    const decl = collections.get(name)!;
    if (decl.ttlSeconds !== undefined) throw invalid('ttlSeconds is not supported yet', { collection: name });
    if (decl.kind === 'log' || decl.maxEntries !== undefined) {
      throw invalid('log collections are not supported yet', { collection: name });
    }
    if (decl.dailyWritesPerAuthor !== undefined) {
      throw invalid('dailyWritesPerAuthor is not supported yet', { collection: name });
    }
    if ((decl.write ?? 'own') === 'anyone') throw invalid('write: anyone is not supported yet', { collection: name });
    return decl;
  }

  function assertShareWritable(decl: Decl) {
    if (decl.visibility !== 'shared') return;
    if (decl.write === 'owner') throw refuse('write_policy', 'only the app owner writes this collection');
    if (decl.write === 'none') throw refuse('write_policy', 'documents in this collection are written by counters only');
  }

  function assertKey(key: unknown): asserts key is string {
    if (typeof key !== 'string' || !KEY.test(key)) throw invalid('key must be 1–128 characters of [A-Za-z0-9._:-]');
    if (DOT_ONLY.test(key)) throw invalid('key must not consist only of dots: it cannot be addressed in a URL path');
  }

  const requireViewer = (ctx: Ctx): number => {
    if (ctx.uid === null) throw refuse('sign_in_required', 'sign in required');
    return ctx.uid;
  };
  const requireShared = (decl: Decl, what: string) => {
    if (decl.visibility !== 'shared') throw invalid(`${what} exist on shared collections only`);
  };

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
    const decl = collections.get(coll)!;
    const counters: Record<string, number> = {};
    const marks: Record<string, number> = {};
    if (decl.visibility === 'shared') {
      for (const n of decl.counters) counters[n] = d.counters.get(n) ?? 0;
      for (const n of decl.marks) if (n !== REPORT) marks[n] = d.markCounts.get(n) ?? 0;
    }
    const names = usernames();
    const author =
      d.authorKind === 'counter'
        ? { kind: 'counter' }
        : {
            kind: 'user',
            isViewer: d.authorUid === ctx.uid,
            ...(decl.showAuthor && names.has(d.authorUid) ? { username: names.get(d.authorUid) } : {}),
          };
    const mine =
      ctx.uid === null
        ? null
        : {
            marks: [...d.marks]
              .filter((m) => decl.visibility === 'shared' && m.startsWith(`${ctx.uid}:`))
              .map((m) => m.slice(m.indexOf(':') + 1))
              .sort(),
          };
    return {
      key: d.key,
      data: d.data,
      version: d.version,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
      author,
      counters,
      marks,
      viewer: mine,
    };
  }

  function getMany(ctx: Ctx, coll: string, keys: unknown[]) {
    assertCollection(coll);
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
    const decl = assertCollection(coll);
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
      counters: new Map(),
      markCounts: new Map(),
      marks: new Set(),
    };
    docs.set(id, row);
    return present(ctx, coll, row);
  }

  function remove(ctx: Ctx, coll: string, key: string, ifVersion: number | undefined) {
    const decl = assertCollection(coll);
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

  function increment(ctx: Ctx, coll: string, key: string, counter: string, by = 1) {
    const decl = assertCollection(coll);
    assertKey(key);
    requireShared(decl, 'counters');
    if (!TALLY_NAME.test(counter) || !decl.counters.includes(counter)) {
      throw invalid(`counter ${counter} is not declared`, { counter });
    }
    if (!Number.isSafeInteger(by) || by < 1 || by > B.incrementMax) {
      throw invalid(`by must be an integer from 1 to ${B.incrementMax}`);
    }
    const viewer = requireViewer(ctx);
    storageOn();
    const id = docId(ctx, coll, 0, key);
    let row = docs.get(id);
    if (!row) {
      if ((decl.write ?? 'own') !== 'none') throw refuse('not_found', 'document not found');
      const t = now();
      const size = storedSize({});
      chargeUsage(ctx, viewer, size, 1, 'viewer')();
      row = {
        key,
        data: {},
        size,
        version: 1,
        createdAt: t,
        updatedAt: t,
        authorUid: viewer,
        authorKind: 'counter',
        index: new Map(),
        counters: new Map(),
        markCounts: new Map(),
        marks: new Set(),
      };
      docs.set(id, row);
    }
    const value = (row.counters.get(counter) ?? 0) + by;
    row.counters.set(counter, value);
    return { value };
  }

  function assertMarkName(decl: Decl, name: string) {
    requireShared(decl, 'marks');
    if (name === REPORT) return;
    if (!TALLY_NAME.test(name) || !decl.marks.includes(name)) throw invalid(`mark ${name} is not declared`, { mark: name });
  }

  function setMark(ctx: Ctx, coll: string, key: string, name: string, on: boolean) {
    const decl = assertCollection(coll);
    assertKey(key);
    assertMarkName(decl, name);
    const viewer = requireViewer(ctx);
    storageOn();
    const row = docs.get(docId(ctx, coll, 0, key));
    if (!row) throw refuse('not_found', 'document not found');
    const id = `${viewer}:${name}`;
    const had = row.marks.has(id);
    if (on && !had) {
      row.marks.add(id);
      row.markCounts.set(name, (row.markCounts.get(name) ?? 0) + 1);
    } else if (!on && had) {
      row.marks.delete(id);
      row.markCounts.set(name, (row.markCounts.get(name) ?? 0) - 1);
    }
    return { marked: on, count: row.markCounts.get(name) ?? 0 };
  }

  type Sort =
    | { kind: 'key'; desc: boolean }
    | { kind: 'createdAt' | 'updatedAt'; desc: boolean }
    | { kind: 'index'; desc: boolean; name: string; type: IndexType }
    | { kind: 'tally'; desc: boolean; tally: 'counter' | 'mark'; name: string };

  function parseSort(decl: Decl, raw: string | undefined): Sort {
    const s = raw ?? 'key';
    const desc = s.startsWith('-');
    const field = desc ? s.slice(1) : s;
    if (field === 'key') return { kind: 'key', desc };
    if (field === 'createdAt' || field === 'updatedAt') return { kind: field, desc };
    const tally = /^(counter|mark):(.+)$/.exec(field);
    if (tally) {
      requireShared(decl, 'counters and marks');
      const kind = tally[1] as 'counter' | 'mark';
      const name = tally[2]!;
      const declared = kind === 'counter' ? decl.counters : decl.marks;
      if (!declared.includes(name) || (kind === 'mark' && name === REPORT)) {
        throw refuse('index_not_declared', `${kind} ${name} is not declared`, { field });
      }
      return { kind: 'tally', desc, tally: kind, name };
    }
    const type = decl.indexes.get(field);
    if (!type) throw refuse('index_not_declared', `sort field ${field} is not declared`, { field });
    return { kind: 'index', desc, name: field, type };
  }

  const sortTag = (sort: Sort) => {
    const dir = sort.desc ? 'd' : 'a';
    switch (sort.kind) {
      case 'key':
        return `k${dir}`;
      case 'createdAt':
        return `c${dir}`;
      case 'updatedAt':
        return `u${dir}`;
      case 'tally':
        return `t${dir}`;
      case 'index':
        return `${sort.type === 'string' ? 's' : 'n'}${dir}`;
    }
  };

  /** The sort value, as the cursor carries it; `undefined` = not in this ordering. */
  function sortValue(sort: Sort, d: DocRow): string | number | undefined {
    switch (sort.kind) {
      case 'key':
        return '';
      case 'createdAt':
        return d.createdAt * 1000;
      case 'updatedAt':
        return d.updatedAt * 1000;
      case 'tally':
        return (sort.tally === 'counter' ? d.counters : d.markCounts).get(sort.name) ?? 0;
      case 'index': {
        const row = d.index.get(sort.name);
        if (!row || row.type !== sort.type) return undefined;
        return sort.type === 'string' ? row.text : row.num;
      }
    }
  }

  function decodeCursor(sort: Sort, cursor: string): { value: string | number; key: string } {
    const bad = () => invalid('invalid cursor');
    if (cursor.length > B.cursorChars) throw bad();
    const first = cursor.indexOf('~');
    const last = cursor.lastIndexOf('~');
    if (first < 0 || last === first) throw bad();
    const payload = cursor.slice(first + 1, last);
    const key = cursor.slice(last + 1);
    if (cursor.slice(0, first) !== sortTag(sort) || !KEY.test(key)) throw bad();
    if (sort.kind === 'key') return { value: '', key };
    if (sort.kind === 'index' && sort.type === 'string') {
      if (!/^[A-Za-z0-9_-]*$/.test(payload)) throw bad();
      return { value: fromBase64url(payload), key };
    }
    if (sort.kind === 'index') {
      if (!/^-?[0-9.eE+-]{1,32}$/.test(payload) || !Number.isFinite(Number(payload))) throw bad();
      return { value: Number(payload), key };
    }
    if (!new RegExp(`^[0-9]{1,${sort.kind === 'tally' ? 18 : 17}}$`).test(payload)) throw bad();
    return { value: Number(payload), key };
  }

  function encodeCursor(sort: Sort, value: string | number, key: string) {
    let payload = String(value);
    if (sort.kind === 'key') payload = '';
    else if (sort.kind === 'index' && sort.type === 'string') payload = base64url(payload);
    return `${sortTag(sort)}~${payload}~${key}`;
  }

  function list(ctx: Ctx, coll: string, q: ListQuery) {
    const decl = assertCollection(coll);
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
    if (q.markedBy !== undefined || q.mark !== undefined) {
      if (q.markedBy !== 'me' || q.mark === undefined) throw invalid('markedBy=me and mark are required together');
      assertMarkName(decl, q.mark);
      const id = `${requireViewer(ctx)}:${q.mark}`;
      rows = rows.filter((d) => d.marks.has(id));
    }

    const keyed = rows
      .map((d) => ({ d, v: sortValue(sort, d) }))
      .filter((x): x is { d: DocRow; v: string | number } => x.v !== undefined);
    const dir = sort.desc ? -1 : 1;
    const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
    const order = (a: { v: string | number; key: string }, b: { v: string | number; key: string }) =>
      (cmp(a.v, b.v) || cmp(a.key, b.key)) * dir;
    let ordered = keyed.map((x) => ({ d: x.d, v: x.v, key: x.d.key })).sort(order);
    if (q.cursor !== undefined) {
      const cur = decodeCursor(sort, q.cursor);
      const bound = { v: cur.value, key: cur.key };
      ordered = ordered.filter((x) => order(x, bound) > 0);
    }
    storageOn();
    const page = ordered.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((x) => present(ctx, coll, x.d)),
      nextCursor: ordered.length > limit && last ? encodeCursor(sort, last.v, last.key) : null,
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
    | { op: 'increment' | 'mark' | 'unmark'; collection: string; key: string; name: string };

  function match(method: string, s: string[]): { route: Route } | { methods: string[] } | null {
    const [a, b, c, d] = s;
    const pick = (table: Record<string, Route>) =>
      table[method] ? { route: table[method]! } : { methods: Object.keys(table) };
    switch (s.length) {
      case 0:
        return pick({ GET: { op: 'info' } });
      case 1:
        if (a!.startsWith('_')) return null;
        return pick({ GET: { op: 'list', collection: a! }, POST: { op: 'create', collection: a! } });
      case 2:
        if (a === '_get') return pick({ POST: { op: 'getMany', collection: b! } });
        if (a!.startsWith('_')) return null;
        return pick({
          GET: { op: 'get', collection: a!, key: b! },
          PUT: { op: 'put', collection: a!, key: b! },
          DELETE: { op: 'delete', collection: a!, key: b! },
        });
      case 4:
        if (a!.startsWith('_')) return null;
        if (c === 'counters') return pick({ POST: { op: 'increment', collection: a!, key: b!, name: d! } });
        if (c === 'marks') {
          return pick({
            PUT: { op: 'mark', collection: a!, key: b!, name: d! },
            DELETE: { op: 'unmark', collection: a!, key: b!, name: d! },
          });
        }
        return null;
      default:
        return null;
    }
  }

  type ListQuery = {
    where?: Record<string, string | number | boolean>;
    sort?: string;
    author?: string;
    markedBy?: string;
    mark?: string;
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
      if (!['sort', 'author', 'markedBy', 'mark', 'keyPrefix', 'limit', 'cursor'].includes(name)) {
        throw invalid(`unknown query parameter ${name}`);
      }
      if (name === 'limit') {
        if (!/^[0-9]{1,3}$/.test(raw)) throw invalid('limit must be an integer');
        q.limit = Number(raw);
      } else if (name === 'author' || name === 'markedBy') {
        if (raw !== 'me') throw invalid(`${name} must be "me"`);
        q[name] = 'me';
      } else {
        q[name as 'sort' | 'mark' | 'keyPrefix' | 'cursor'] = raw;
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
    if (segments[0] !== 'blocks' || segments[1] !== 'storage') {
      throw new Error(`fake storage: no route for ${path}`);
    }
    let rest: string[];
    try {
      rest = segments.slice(2).map((s) => decodeURIComponent(s));
    } catch {
      throw refuse('not_found', 'no such storage route');
    }
    // The wire: only POST and PUT bodies are read, and only what JSON carries.
    const body =
      (method === 'POST' || method === 'PUT') && sent !== undefined
        ? (JSON.parse(JSON.stringify(sent)) as unknown)
        : undefined;
    const viewer = caller.viewer === undefined ? defaultViewer : caller.viewer;

    // The token middleware: its refusals come first, whatever the path.
    if (caller.token === 'none') throw refuse('unauthenticated', 'a block token is required');
    if ((options.appStatus ?? 'approved') !== 'approved') {
      throw refuse('not_eligible', 'app block is not approved', { reason: 'app_not_approved' });
    }
    const consent = options.consent;
    const consentUnavailable = consent === 'unavailable';
    const revoked: readonly string[] = consent === undefined || consent === 'unavailable' ? [] : consent.revoked;
    const scopes = (caller.scopes ?? options.manifest.scopes ?? []).filter(
      (s) => !(CONSENT_GATED.has(s) && (consentUnavailable || revoked.includes(s))),
    );
    if (!scopes.includes(BASE_SCOPE)) throw refuse('insufficient_scope', `${BASE_SCOPE} scope required`);

    const m = match(method, rest);
    if (!m) throw refuse('not_found', 'no such storage route');
    if ('methods' in m) throw refuse('method_not_allowed', 'method not allowed');
    const route = m.route;
    const allowedQuery = route.op === 'list' ? null : route.op === 'delete' ? ['ifVersion'] : [];
    if (allowedQuery) {
      const stray = Object.keys(query).find((k) => !allowedQuery.includes(k));
      if (stray) throw invalid(`unknown query parameter ${stray}`);
    }
    const uid = viewer === null ? null : uidOf(viewer);
    if (caller.token === 'dev' && uid === null) throw refuse('sign_in_required', 'sign in required');
    const ctx: Ctx = { ns: caller.token === 'dev' ? `dev:${uid}` : 'prod', uid };
    if (body !== undefined && utf8Length(JSON.stringify(body)) > BODY_LIMIT_BYTES) {
      throw refuse('too_large', `request body exceeds ${BODY_LIMIT_BYTES} bytes`, { limit: BODY_LIMIT_BYTES });
    }
    const requireSignedIn = (): number => {
      if (uid === null) throw refuse('sign_in_required', 'sign in required');
      return uid;
    };

    if (route.op === 'info') requireSignedIn();
    if (route.op === 'info' || route.op === 'list' || route.op === 'get' || route.op === 'getMany') charge('read', uid);
    if (route.op === 'info') {
      storageOn();
      const app = appUsage.get(ctx.ns) ?? { bytes: 0, docs: 0 };
      const mine = userUsage.get(`${ctx.ns}\u0000${uid}`) ?? { bytes: 0, docs: 0 };
      return {
        status: 200,
        body: {
          collections: Object.fromEntries(
            [...collections].map(([name, d]) => [
              name,
              {
                kind: d.kind,
                visibility: d.visibility,
                ...(d.visibility === 'shared' ? { write: d.write ?? 'own' } : {}),
                counters: [...d.counters],
                marks: [...d.marks],
                indexes: Object.fromEntries(d.indexes),
                showAuthor: d.showAuthor,
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
              marksAndCountersPerMinute: RATE.tally.max,
              reportsPerDay: RATE.report.max,
              sharedWritesBurst: SHARED_WRITE_BUDGET[0]![0],
              sharedWritesPerDay: SHARED_WRITE_BUDGET[1]![0],
            },
          },
          usage: { app: { ...app }, viewer: { ...mine } },
        },
      };
    }

    if (!COLLECTION_NAME.test(route.collection) || !collections.has(route.collection)) {
      throw refuse('collection_not_declared', `collection ${route.collection} is not declared`, { collection: route.collection });
    }
    const coll = route.collection;
    const decl = assertCollection(coll);
    const shared = decl.visibility === 'shared';

    switch (route.op) {
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
          if (consentUnavailable) {
            throw refuse('consent_unavailable', 'permission state is temporarily unavailable', { retryAfter: 1 });
          }
          throw refuse('consent_required', `${PUBLISH_SCOPE} has not been granted`, { scope: PUBLISH_SCOPE });
        }
        const created = route.op === 'create' ? parseBody(body, { data: isObject }, ['data']) : null;
        const putIn = route.op === 'put' ? parseBody(body, { data: isObject, ifVersion: isNumber }, ['data']) : null;
        let deleteVersion: number | undefined;
        if (route.op === 'delete' && query.ifVersion !== undefined) {
          const raw = query.ifVersion;
          if (Array.isArray(raw) || !/^[0-9]{1,15}$/.test(raw)) throw invalid('ifVersion must be a non-negative integer');
          deleteVersion = Number(raw);
        }
        const write = (moderated: boolean, landed: () => void) => {
          if (created) {
            if (moderated) moderateWrite({ data: created.data as Record<string, unknown> });
            const doc = writeDoc(ctx, coll, newKey(), created.data, 0);
            landed();
            return { status: 201, body: doc };
          }
          if (putIn && route.op === 'put') {
            if (moderated) moderateWrite({ data: putIn.data as Record<string, unknown>, key: route.key });
            const doc = writeDoc(ctx, coll, route.key, putIn.data, putIn.ifVersion as number | undefined);
            landed();
            return { status: 200, body: doc };
          }
          if (route.op !== 'delete') throw new Error('fake storage: unreachable write op');
          return { status: 200, body: remove(ctx, coll, route.key, deleteVersion) };
        };
        if (!shared || route.op === 'delete') {
          charge('write', uid);
          return write(false, () => undefined);
        }
        assertTrusted(viewer!);
        const release = reserveSharedWrite(me);
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
      case 'increment': {
        requireSignedIn();
        const { by } = parseBody(body, { by: isNumber });
        charge('tally', uid);
        if (shared) assertTrusted(viewer!);
        if (shared && decl.write === 'none') moderateWrite({ key: route.key });
        return { status: 200, body: increment(ctx, coll, route.key, route.name, by as number | undefined) };
      }
      case 'mark':
      case 'unmark': {
        requireSignedIn();
        if (route.op === 'mark') parseBody(body, {});
        charge('tally', uid);
        if (route.op === 'mark' && route.name === REPORT) charge('report', uid);
        if (shared) assertTrusted(viewer!);
        const result = setMark(ctx, coll, route.key, route.name, route.op === 'mark');
        return { status: 200, body: route.name === REPORT ? { marked: result.marked } : result };
      }
    }
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
    return { http, storage: createDocumentStorage(http) };
  }

  const own = session({});
  return { ...own, as: session, calls };
}
