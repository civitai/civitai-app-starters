/**
 * A fake for the eleven `/blocks/shared-storage/*` routes — THIS SUITE'S ONLY,
 * and deliberately not part of `@civitai/sdk/testing`, for the same reason
 * `fake-app-storage.ts` is not: one adopter is not enough to freeze names on the
 * published surface. Promote it when a SECOND consumer asks.
 *
 * The seam is `fetch`, not the client. Pass it as `initialize({ token, fetch })`
 * and the client's METHODS, URLs, query strings, bodies, status handling and date
 * revival are all real. A fake that replaced the client instead would answer a
 * conversation nobody is having.
 *
 * 🔴 It enforces the ROUTE'S OWN METHOD — GET for the four reads, POST for the
 * seven writes — and answers 405 otherwise. That is the single most important
 * thing it does: the per-viewer client POSTs everything, so a shared-storage
 * client that copied it would be wrong on four routes, and a fake that accepted
 * either verb could not see it.
 *
 * 🔴 It puts ISO STRINGS on the wire for `createdAt`/`updatedAt`, exactly as
 * `res.json()` does. A fake that put `Date`s there would make the client's
 * revival unobservable — `new Date(aDate)` is a `Date` — so deleting it would
 * survive a fully green suite.
 */

/** A row the fake holds. Both stamps are `Date`s here and ISO STRINGS on the wire. */
export interface FakeSharedRow {
  key: string;
  authorUserId: number;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeSharedStorageOptions {
  /** Seed rows. One without stamps or an author gets distinct ones of its own. */
  seed?: {
    key: string;
    value: unknown;
    authorUserId?: number;
    createdAt?: Date;
    updatedAt?: Date;
    /** User ids that have up-voted this row. */
    votes?: number[];
  }[];
  /** Seed app-defined counters, as `increment` would have created them. */
  counters?: Record<string, number>;
  /**
   * 🔴 DEFAULT 2, NOT the server's 50, and that is the point. A page size big
   * enough to hold every fixture is precisely the condition under which a client
   * that never sends `cursor` passes an entire suite: every scan finishes on page
   * one, so the bug has nowhere to show.
   */
  pageSize?: number;
  /**
   * `null` ⇒ an ANONYMOUS viewer: reads are SERVED and writes are refused 403.
   * That asymmetry is this surface's defining rule and the per-viewer fake's
   * flat "403 everything" would hide it.
   */
  viewer?: { id: number } | null;
  /** `false` ⇒ signed in but below the write trust gate: reads served, writes 403. */
  trusted?: boolean;
  /** Scripted refusals, consumed in order across all ops: `{status, body}`. */
  refuse?: { status: number; body: unknown }[];
  /** Keys `append` hands out, in order. Models the SERVER generating the ULID. */
  mintKeys?: string[];
}

/** One request the CLIENT sent, as the server saw it. */
export interface FakeSharedCall {
  /** The last path segment: `list`, `item`, `append`, … */
  op: string;
  /** The whole path, so a test can pin the route and not just the verb. */
  path: string;
  method: string;
  /** The bearer, so a token refresh is observable as two different values. */
  token: string;
  /** Parsed query params. A repeated key collects into an array. */
  query: Record<string, string[]>;
  /** The parsed JSON body, or `undefined` when the request carried none. */
  body?: Record<string, unknown>;
}

export interface FakeSharedStorage {
  fetch: typeof fetch;
  /**
   * 🔴 Every request the CLIENT sent, verbatim — not what the caller asked for.
   * A suite that mocks the client asserts the caller *asks* for the next page and
   * never that the client *sends* the ask; that gap is how a dropped `cursor`
   * survives a green run.
   */
  calls: FakeSharedCall[];
  rows: () => FakeSharedRow[];
  counters: () => Record<string, number>;
  votesFor: (key: string) => number[];
  reports: () => { key: string; reason?: string; reporter: number }[];
}

/** The base path the fake answers under, matching the site client's default. */
const SHARED_PATH = '/blocks/shared-storage/';

/** The four routes the server serves over GET. Everything else is POST. */
const GET_OPS = new Set(['list', 'item', 'counts', 'top']);
const POST_OPS = new Set([
  'append',
  'update',
  'vote',
  'unvote',
  'withdraw',
  'report',
  'increment',
]);

/** Arbitrary, non-round, and fixed: seeded stamps are then pairwise distinct. */
const SEED_EPOCH_MS = 1_756_000_000_123;
/** Deliberately not 1, so a fixture author id can never collide with the viewer's. */
const SEED_AUTHOR_ID = 4242;

const utf8 = (text: string) => new TextEncoder().encode(text);
const toBase64 = (text: string) => btoa(String.fromCharCode(...utf8(text)));
const fromBase64 = (encoded: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createFakeSharedStorage(
  options: FakeSharedStorageOptions = {},
): FakeSharedStorage {
  const pageSize = options.pageSize ?? 2;
  const viewer = options.viewer === undefined ? { id: 1 } : options.viewer;
  const trusted = options.trusted ?? true;
  const refusals = [...(options.refuse ?? [])];
  const minted = [...(options.mintKeys ?? [])];
  const calls: FakeSharedCall[] = [];

  const store = new Map<string, FakeSharedRow>();
  const votes = new Map<string, Set<number>>();
  const counters = new Map<string, number>(Object.entries(options.counters ?? {}));
  const reports: { key: string; reason?: string; reporter: number }[] = [];

  (options.seed ?? []).forEach((row, index) => {
    store.set(row.key, {
      key: row.key,
      authorUserId: row.authorUserId ?? SEED_AUTHOR_ID,
      value: row.value,
      createdAt: row.createdAt ?? new Date(SEED_EPOCH_MS + index),
      // Offset from `createdAt` so the two stamps are never equal — a client that
      // read one into the other's field would otherwise pass.
      updatedAt: row.updatedAt ?? new Date(SEED_EPOCH_MS + index + 500),
    });
    if (row.votes?.length) votes.set(row.key, new Set(row.votes));
  });

  /** Newest-first on the key, exactly as the server's `ORDER BY s.key DESC`. */
  const rows = () =>
    [...store.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  const countOf = (key: string) => counters.get(key) ?? votes.get(key)?.size ?? 0;

  const project = (row: FakeSharedRow) => ({
    key: row.key,
    authorUserId: row.authorUserId,
    value: row.value,
    count: countOf(row.key),
    // 🔴 ISO strings — see the header note.
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // An anonymous viewer always reads `false`, which is the server's own rule:
    // the vote join keys on a NULL subject and is never true.
    viewerVoted: viewer != null && (votes.get(row.key)?.has(viewer.id) ?? false),
  });

  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const at = url.pathname.indexOf(SHARED_PATH);
    if (at === -1) {
      throw new Error(`fake shared storage: no route for ${url.pathname}`);
    }
    const op = url.pathname.slice(at + SHARED_PATH.length);
    if (!GET_OPS.has(op) && !POST_OPS.has(op)) {
      throw new Error(`fake shared storage: no route for ${url.pathname}`);
    }

    const method = init.method ?? 'GET';
    // 🔴 The route's own verb. A read sent as POST — the mistake a copy of the
    // per-viewer client would make — gets the server's real 405.
    const wanted = GET_OPS.has(op) ? 'GET' : 'POST';
    if (method !== wanted) {
      return jsonResponse(405, { error: 'Method not allowed' });
    }

    const query: Record<string, string[]> = {};
    for (const [key, value] of url.searchParams.entries()) {
      (query[key] ??= []).push(value);
    }
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({
      op,
      path: url.pathname,
      method,
      token: (headers.Authorization ?? '').replace(/^Bearer /, ''),
      query,
      body,
    });

    const refusal = refusals.shift();
    if (refusal) return jsonResponse(refusal.status, refusal.body);

    // 🔴 THE ASYMMETRY. Reads are served to everyone holding the read scope,
    // anonymous included. Writes need a subject AND the trust gate, and both
    // refusals are a 403 from the scope binding, before any handler runs.
    if (POST_OPS.has(op)) {
      if (viewer == null) {
        return jsonResponse(403, {
          error: 'apps:storage:shared:write requires authenticated subject',
        });
      }
      if (!trusted) {
        return jsonResponse(403, { error: 'account does not meet the minimum trust requirement' });
      }
    }

    const one = (key: unknown) => store.get(String(key));

    switch (op) {
      case 'list': {
        const prefix = query.prefix?.[0] ?? '';
        const limit = query.limit?.[0] ? Number(query.limit[0]) : pageSize;
        const afterKey = query.cursor?.[0] ? fromBase64(query.cursor[0]) : null;
        const page = rows()
          .filter((row) => row.key.startsWith(prefix))
          // Keyset on a DESC order: the next page is the keys BELOW the cursor.
          .filter((row) => afterKey == null || row.key < afterKey)
          .slice(0, limit);
        return jsonResponse(200, {
          items: page.map(project),
          metadata: {
            // Set iff the page came back full — the server's own rule, so a
            // client that always forwards a cursor loops and one that never does
            // repeats page one. Neither can be silent.
            nextCursor:
              page.length === limit ? toBase64(page[page.length - 1]!.key) : undefined,
            nextPage: page.length === limit ? `${url.origin}${url.pathname}?more=1` : undefined,
          },
        });
      }
      case 'item': {
        const row = one(query.key?.[0]);
        // A miss is a 200 with `item: null`, never a 404 — "hidden" and "never
        // existed" must be indistinguishable.
        return jsonResponse(200, { item: row ? project(row) : null });
      }
      case 'counts': {
        const keys = query.keys ?? [];
        const counts: Record<string, number> = {};
        // One entry per REQUESTED key, so a 0/absent distinction cannot probe
        // for hidden rows.
        for (const key of keys) counts[key] = store.has(key) ? countOf(key) : 0;
        return jsonResponse(200, { counts });
      }
      case 'top': {
        const prefix = query.prefix?.[0] ?? '';
        const limit = query.limit?.[0] ? Number(query.limit[0]) : pageSize;
        const ranked = [...counters.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .slice(0, limit)
          .map(([key, count]) => ({ key, count }));
        // 🔴 A BARE ARRAY. No `items`, no `metadata` — unlike `list`.
        return jsonResponse(200, ranked);
      }
      case 'append': {
        const value = (body?.value ?? {}) as { title?: unknown };
        if (typeof value.title !== 'string' || value.title === '') {
          return jsonResponse(400, { error: 'Invalid request body' });
        }
        // 🔴 THE SERVER mints the key; the request carries none.
        const key = minted.shift() ?? `01J${String(store.size).padStart(3, '0')}`;
        const now = new Date(SEED_EPOCH_MS + store.size + 9000);
        store.set(key, {
          key,
          authorUserId: viewer!.id,
          value: body?.value,
          createdAt: now,
          updatedAt: now,
        });
        return jsonResponse(200, { key });
      }
      case 'update': {
        const row = one(body?.key);
        if (!row) return jsonResponse(404, { message: 'not found' });
        // Author-gated: another author's row is a 403, not a silent no-op.
        if (row.authorUserId !== viewer!.id) return jsonResponse(403, { message: 'not yours' });
        store.set(row.key, { ...row, value: body?.value, updatedAt: new Date(SEED_EPOCH_MS + 9999) });
        return jsonResponse(200, { ok: true });
      }
      case 'vote': {
        const row = one(body?.key);
        if (!row) return jsonResponse(404, { message: 'not found' });
        const set = votes.get(row.key) ?? new Set<number>();
        // Insert-gated: a second vote from the same viewer is a no-op and the
        // tally does not inflate.
        set.add(viewer!.id);
        votes.set(row.key, set);
        return jsonResponse(200, { count: set.size });
      }
      case 'unvote': {
        const row = one(body?.key);
        if (!row) return jsonResponse(404, { message: 'not found' });
        const set = votes.get(row.key) ?? new Set<number>();
        set.delete(viewer!.id);
        votes.set(row.key, set);
        return jsonResponse(200, { count: set.size });
      }
      case 'withdraw': {
        const row = one(body?.key);
        // 🔴 Another author's key and a missing key answer IDENTICALLY, so this
        // is not an existence oracle.
        const deleted = Boolean(row && row.authorUserId === viewer!.id);
        if (deleted) {
          store.delete(row!.key);
          votes.delete(row!.key);
        }
        return jsonResponse(200, { ok: true, deleted });
      }
      case 'report': {
        const key = String(body?.key);
        const reason = body?.reason as string | undefined;
        // Deduped per (reporter, key); the reply is identical either way.
        if (!reports.some((r) => r.key === key && r.reporter === viewer!.id)) {
          reports.push({ key, reason, reporter: viewer!.id });
        }
        return jsonResponse(200, { ok: true });
      }
      case 'increment': {
        const key = String(body?.key);
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        // The anchor row the counters FK needs, created once per key.
        if (!store.has(key)) {
          const now = new Date(SEED_EPOCH_MS + counters.size + 7000);
          store.set(key, {
            key,
            authorUserId: viewer!.id,
            value: {},
            createdAt: now,
            updatedAt: now,
          });
        }
        return jsonResponse(200, { key, count: next });
      }
      default:
        throw new Error(`fake shared storage: no route for ${url.pathname}`);
    }
  }) as typeof globalThis.fetch;

  return {
    fetch,
    calls,
    rows,
    counters: () => Object.fromEntries(counters),
    votesFor: (key) => [...(votes.get(key) ?? [])],
    reports: () => [...reports],
  };
}
