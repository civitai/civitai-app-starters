import { EMPTY_SNAPSHOT, type BlockSnapshot, type BlockTransport } from './core/transport.js';
import { BridgeError, type BridgeFailureCode } from './core/errors.js';

export { __resetTransport } from './core/get-transport.js';

export interface FakeTransport extends BlockTransport {
  /** Every request sent, in order. */
  readonly sent: { type: string; payload: unknown }[];
  /**
   * Answer every request of this type from its params. Throw from the handler
   * to fail the call. A queued `reply`/`fail` is used first, so one call can
   * depart from the standing answer.
   */
  handle(type: string, handler: (params: unknown) => unknown): void;
  /** Answer the next request of this type with the value it resolves to. */
  reply(type: string, result: unknown): void;
  /** Answer the next request of this type with a failure the host classified. */
  fail(type: string, error: { code: BridgeFailureCode; message: string }): void;
  /** Never answer requests of this type; for deadline and abort tests. */
  stall(type: string): void;
  /** Deliver an unsolicited host push to `on` subscribers. */
  push(type: string, payload: unknown): void;
  /** Subscribers to a push, so a test can assert one stopped listening. */
  listenerCount(type: string): number;
  setSnapshot(next: Partial<BlockSnapshot>): void;
}

/**
 * An in-memory `BlockTransport` for testing a service against a scripted host.
 * Replaces driving a full mock host through `postMessage` when the thing under
 * test is one operation.
 */
export function createFakeTransport(snapshot: Partial<BlockSnapshot> = {}): FakeTransport {
  let current: BlockSnapshot = {
    ...EMPTY_SNAPSHOT,
    ready: true,
    hostOrigin: 'https://civitai.com',
    ...snapshot,
  };
  const listeners = new Set<() => void>();
  const sent: { type: string; payload: unknown }[] = [];
  const queued = new Map<string, unknown[]>();
  const stalled = new Set<string>();
  const pending = new Map<string, ((payload: unknown) => void)[]>();
  const handlers = new Map<string, (params: unknown) => unknown>();
  const pushListeners = new Map<string, Set<(payload: unknown) => void>>();

  const emit = () => {
    for (const l of [...listeners]) l();
  };

  /** A queued answer is either the value or the failure the host reported. */
  const settle = (answer: unknown): Promise<never> =>
    answer instanceof BridgeError ? Promise.reject(answer) : (Promise.resolve(answer) as Promise<never>);

  const answer = (type: string, outcome: unknown) => {
    const waiting = pending.get(type);
    if (waiting?.length) {
      waiting.shift()!(outcome);
      return;
    }
    queued.set(type, [...(queued.get(type) ?? []), outcome]);
  };

  return {
    sent,
    snapshot: {
      get: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notify(message) {
      sent.push({ type: message.type, payload: (message as { payload?: unknown }).payload });
    },
    request(type: string, params: unknown, opts: { signal?: AbortSignal } = {}): Promise<never> {
      sent.push({ type, payload: params });
      const responseType = type;
      const { signal } = opts;
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (stalled.has(responseType)) {
        return new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      const ready = queued.get(responseType);
      if (ready?.length) return settle(ready.shift());
      const standing = handlers.get(responseType);
      if (standing) return (async () => standing(params))() as Promise<never>;
      return new Promise<never>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        const waiting = pending.get(responseType) ?? [];
        waiting.push((outcome) => {
          if (outcome instanceof BridgeError) reject(outcome);
          else resolve(outcome as never);
        });
        pending.set(responseType, waiting);
      });
    },
    on(type, handler) {
      const set = pushListeners.get(type) ?? new Set();
      set.add(handler);
      pushListeners.set(type, set);
      return () => set.delete(handler);
    },
    push(type, payload) {
      for (const handler of [...(pushListeners.get(type) ?? [])]) handler(payload);
    },
    listenerCount(type) {
      return pushListeners.get(type)?.size ?? 0;
    },
    handle(type, handler) {
      handlers.set(type, handler);
    },
    reply(type, result) {
      answer(type, result);
    },
    fail(type, error) {
      answer(type, new BridgeError(error.code, type, error.message));
    },
    stall(type) {
      stalled.add(type);
    },
    setSnapshot(next) {
      current = { ...current, ...next };
      emit();
    },
  };
}

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
