/**
 * A fake for the five `/blocks/app-storage/*` routes — THIS SUITE'S ONLY, and
 * deliberately not part of `@civitai/sdk/testing`.
 *
 * It was published once. It is unpublished because four of the five fleet apps
 * that store per-viewer state structurally CANNOT use it, so shipping it would
 * have frozen five names on the public surface for one adopter:
 *
 *   - `civitai-app-model-benchmarking` needs a `latencyMs` knob (without one, an
 *     ordering bug hid a live money bug), prefix-targeted refusals rather than
 *     this flat positional queue, and a quota OVERRIDE — the constants below are
 *     compile-time, so that app's criterion "the quota line comes from
 *     `getQuota()`, never a hard-coded figure" cannot be expressed against it.
 *   - `civitai-app-gen-matrix` needs a `list` that IGNORES `cursor` while still
 *     returning `nextCursor`, to drive its eviction guard. This one always
 *     honours the cursor.
 *   - `civitai-app-playable-collections` needs a read that never settles. Every
 *     op here resolves.
 *   - `civitai-app-sensei` models its cache in the host page, ABOVE the fetch seam.
 *
 * Only `civitai-app-custom-generators` would have adopted it, and its own double
 * is a 20-line `Map`. Promote this to the published surface when a SECOND
 * consumer asks for it — not before.
 */

/** A row the fake holds. `updatedAt` is a `Date` here and an ISO STRING on the wire. */
export interface FakeAppStorageRow {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface FakeAppStorageOptions {
  /** Seed rows. One without `updatedAt` gets a distinct stamp of its own. */
  seed?: { key: string; value: unknown; updatedAt?: Date }[];
  /**
   * 🔴 DEFAULT 3, NOT the server's 50, and that is the point. A page size big
   * enough to hold every realistic fixture is precisely the condition under
   * which a client that never sends `cursor` passes an entire suite: every
   * scan finishes on page one, so the bug has nowhere to show. Small makes
   * multi-page the ordinary case.
   */
  pageSize?: number;
  /** `null` ⇒ every op is refused 403, with the middleware's own body. */
  viewer?: { id: number } | null;
  /** Scripted refusals, consumed in order across all ops: `{status, body}`. */
  refuse?: { status: number; body: unknown }[];
}

/** One request the CLIENT sent, as the server saw it. */
export interface FakeAppStorageCall {
  /** The last path segment: `get`, `set`, `delete`, `list`, `quota`. */
  op: string;
  /** The whole path, so a test can pin the route and not just the verb. */
  path: string;
  /** The bearer, so a token refresh is observable as two different values. */
  token: string;
  body: Record<string, unknown>;
}

export interface FakeAppStorage {
  fetch: typeof fetch;
  /**
   * 🔴 Every request the CLIENT sent, verbatim — not what the caller asked for.
   * A suite that mocks the client asserts the caller *asks* for the next page
   * and never that the client *sends* the ask; that gap is how a dropped
   * `cursor` survives a green run.
   */
  calls: FakeAppStorageCall[];
  rows: () => FakeAppStorageRow[];
}

/** The base URL the fake answers under, matching the site client's default. */
const APP_STORAGE_PATH = '/blocks/app-storage/';

/** Arbitrary, non-round, and fixed: seeded stamps are then pairwise distinct. */
const SEED_EPOCH_MS = 1_756_000_000_123;

/** The per-user ceilings the quota route reports. */
const USER_QUOTA_BYTES = 2 * 1024 * 1024;
const USER_ROW_LIMIT = 1000;

const utf8 = (text: string) => new TextEncoder().encode(text);
const toBase64 = (text: string) => btoa(String.fromCharCode(...utf8(text)));
const fromBase64 = (encoded: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * An in-memory stand-in for the five `/blocks/app-storage/*` routes, behind a
 * `fetch`-shaped function.
 *
 * The seam is `fetch`, not the client: pass it as `initialize({ token, fetch })`
 * and the client's URLs, bodies, status handling and date revival are all real.
 * A fake that replaced the client instead would answer a conversation nobody is
 * having.
 *
 * 🔴 It sends `updatedAt` as an ISO STRING, exactly as `res.json()` does. A fake
 * that put a `Date` on the wire would make the client's revival unobservable —
 * `new Date(aDate)` is a `Date` — so deleting it would survive a green suite.
 */
export function createFakeAppStorage(options: FakeAppStorageOptions = {}): FakeAppStorage {
  const pageSize = options.pageSize ?? 3;
  const viewer = options.viewer === undefined ? { id: 1 } : options.viewer;
  const refusals = [...(options.refuse ?? [])];
  const calls: FakeAppStorageCall[] = [];

  const store = new Map<string, FakeAppStorageRow>();
  (options.seed ?? []).forEach((row, index) => {
    store.set(row.key, {
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt ?? new Date(SEED_EPOCH_MS + index),
    });
  });

  const rows = () => [...store.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const sizeOf = (value: unknown) => utf8(JSON.stringify(value ?? null)).length;

  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const at = url.pathname.indexOf(APP_STORAGE_PATH);
    if (at === -1) {
      throw new Error(`fake app storage: no route for ${url.pathname}`);
    }
    const op = url.pathname.slice(at + APP_STORAGE_PATH.length);
    if (init.method !== 'POST') {
      throw new Error(`fake app storage: ${op} is POST, got ${init.method}`);
    }
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = (init.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
    calls.push({
      op,
      path: url.pathname,
      token: (headers.Authorization ?? '').replace(/^Bearer /, ''),
      body,
    });

    const refusal = refusals.shift();
    if (refusal) return jsonResponse(refusal.status, refusal.body);

    // The middleware refuses an anonymous subject before any handler runs, and
    // it refuses it for reads as well as writes — there is no anon-reads-empty
    // arm to fall through to.
    if (viewer == null) {
      return jsonResponse(403, { error: 'apps:storage:read requires authenticated subject' });
    }

    switch (op) {
      case 'get': {
        return jsonResponse(200, { value: store.get(String(body.key))?.value ?? null });
      }
      case 'set': {
        const key = String(body.key);
        store.set(key, { key, value: body.value, updatedAt: new Date() });
        return jsonResponse(200, { ok: true, sizeBytes: sizeOf(body.value) });
      }
      case 'delete': {
        return jsonResponse(200, { ok: true, deleted: store.delete(String(body.key)) });
      }
      case 'list': {
        const prefix = typeof body.prefix === 'string' ? body.prefix : '';
        const limit = typeof body.limit === 'number' ? body.limit : pageSize;
        const afterKey = typeof body.cursor === 'string' ? fromBase64(body.cursor) : '';
        const page = rows()
          .filter((row) => row.key.startsWith(prefix) && row.key > afterKey)
          .slice(0, limit);
        return jsonResponse(200, {
          keys: page.map((row) => ({ key: row.key, updatedAt: row.updatedAt.toISOString() })),
          // Set iff the page came back full — the server's own rule, so a client
          // that always forwards a cursor loops and one that never does repeats
          // page one. Neither can be silent.
          nextCursor: page.length === limit ? toBase64(page[page.length - 1]!.key) : undefined,
        });
      }
      case 'quota': {
        const all = rows();
        return jsonResponse(200, {
          usedBytes: all.reduce((total, row) => total + sizeOf(row.value), 0),
          rowCount: all.length,
          limitBytes: USER_QUOTA_BYTES,
          limitRows: USER_ROW_LIMIT,
        });
      }
      default:
        throw new Error(`fake app storage: no route for ${url.pathname}`);
    }
  }) as typeof globalThis.fetch;

  return { fetch, calls, rows };
}
