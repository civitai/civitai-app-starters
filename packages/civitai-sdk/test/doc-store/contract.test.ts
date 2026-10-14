import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { StorageError, type DocumentStorage } from '../../src/doc-store/index.js';
import { ApiError } from '../../src/http/index.js';
import {
  createFakeStorage,
  FAKE_STORAGE_MODERATION,
  type FakeStorage,
  type FakeStorageCaller,
} from '../../src/testing.js';

/**
 * The document-store CONTRACT — the request table civitai runs against its real
 * storage handlers — run here twice per case:
 *
 *   raw     every step sent through the fake's `Http` seam exactly as written, and
 *   client  every step the client can express sent through the REAL client wired to
 *           the fake, its result compared as a caller sees it.
 *
 * So the fake agrees with the server where the contract speaks, and the client
 * builds the requests the contract describes and reads their replies back.
 *
 * 🔴 The vendored file is pinned by hash to civitai `main` (the routes are not
 * released yet, so civitai.com does not serve it). `scripts/check-storage-contract.sh`
 * diffs it against the live source; after the release it must be re-checked against
 * civitai.com and the pin below moved with it.
 */

const CONTRACT_URL = new URL('../../schemas/app-block/storage-contract.v1.json', import.meta.url);
const CONTRACT_BYTES = readFileSync(fileURLToPath(CONTRACT_URL));
/** civitai/civitai@afcc3f78 (main, 2026-10-14) public/schemas/app-block/storage-contract.v1.json */
const CONTRACT_SHA256 = 'f6c0ac122a508d9fc3fdbfdb55c2dad9fa949344d33a789a889c155765db1a0b';

type Step = {
  as: string;
  token?: 'dev';
  scopes?: string[];
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  repeat?: number;
  expect: { status: number; code?: string; body?: unknown };
};
type Case = {
  name: string;
  consentMarker?: 'unavailable' | string[];
  appStatus?: string;
  storage?: 'disabled';
  steps: Step[];
};
type Contract = {
  conventions: Record<string, string>;
  storage: { collections: Record<string, unknown> };
  apps: string[];
  viewers: Record<string, { username: string; trusted: boolean; untrustedReason?: string }>;
  limits: { viewerDocs: number };
  defaultScopes: string[];
  stepFields: Record<string, string>;
  cases: Case[];
};

const contract = JSON.parse(CONTRACT_BYTES.toString('utf8')) as Contract;

// ---------------------------------------------------------------------------
// What this runner understands. A contract that grows past it fails here, not
// silently: a field the runner ignores is a rule it never ran.
// ---------------------------------------------------------------------------

const TOP_LEVEL_KEYS = [
  '$comment',
  'version',
  'conventions',
  'storage',
  'apps',
  'viewers',
  'limits',
  'defaultScopes',
  'stepFields',
  'cases',
];
const CASE_KEYS = ['name', 'consentMarker', 'appStatus', 'storage', 'steps', '$comment'];
const STEP_KEYS = ['as', 'token', 'scopes', 'method', 'path', 'query', 'body', 'repeat', 'expect', '$comment'];
/** The contract's own `stepFields` (case- and step-level modifiers) this runner applies. */
const HANDLED_STEP_FIELDS = ['as', 'token', 'scopes', 'consentMarker', 'appStatus', 'storage', 'repeat'];
const MATCHERS = ['$string', '$number', '$iso', '$present', '$absent', '$null'];
const CONVENTION_KEYS = ['blockedText', 'blockedLink', 'scannerDown', 'note', 'rateLimits', 'keys'];

/**
 * Steps the CLIENT has no way to send — a method, query parameter or body field
 * outside its API (most of them refused on purpose: TTL is a later phase, a mark
 * carries no payload). They run in the client pass through the same fake's raw
 * `Http`, and this ledger fails if the set grows or shrinks.
 */
const RAW_ONLY_STEPS = [
  'marks and the report mark #8 PUT /posts/p1/marks/vote: body field note',
  'marks and the report mark #9 PUT /posts/p1/marks/report: body field reason',
  'request errors #2 PUT /prefs/k: body field expiresAt',
  'request errors #4 GET /prefs: query colour',
  'request errors #5 GET /prefs/k: query colour',
  'request errors #10 GET /prefs/k/extra: no client method for 3 segments',
  'request errors #11 PATCH /prefs/k: no client method for PATCH',
];

/** Cases the fake cannot model: none. A case added here must say why. */
const FAKE_CANNOT_MODEL: Record<string, string> = {};

// ---------------------------------------------------------------------------
// The matcher — the contract's own semantics (see its `$comment`)
// ---------------------------------------------------------------------------

type Vars = Record<string, unknown>;

const interpolate = (s: string, vars: Vars) => s.replace(/\$\{([a-z]+)\}/g, (_, name: string) => String(vars[name]));

function materialise(v: unknown, vars: Vars): unknown {
  if (typeof v === 'string') {
    const rep = /^\$repeat:(.):([0-9]+)$/.exec(v);
    return rep ? rep[1]!.repeat(Number(rep[2])) : interpolate(v, vars);
  }
  if (Array.isArray(v)) return v.map((x) => materialise(x, vars));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [interpolate(k, vars), materialise(x, vars)]));
  }
  return v;
}

function matches(actual: unknown, expected: unknown, at: string, vars: Vars, errors: string[]) {
  const fail = (why: string): void => {
    errors.push(`${at}: ${why} (got ${JSON.stringify(actual)})`);
  };
  if (typeof expected === 'string') {
    switch (expected) {
      case '$string':
        if (typeof actual !== 'string') fail('expected a string');
        return;
      case '$number':
        if (typeof actual !== 'number') fail('expected a number');
        return;
      case '$iso':
        if (typeof actual !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(actual) || Number.isNaN(Date.parse(actual))) {
          fail('expected an ISO timestamp');
        }
        return;
      case '$present':
        if (actual === undefined) fail('expected present');
        return;
      case '$absent':
        if (actual !== undefined) fail('expected absent');
        return;
      case '$null':
        if (actual !== null) fail('expected null');
        return;
      default:
        if (actual !== interpolate(expected, vars)) fail(`expected ${interpolate(expected, vars)}`);
        return;
    }
  }
  if (expected && typeof expected === 'object' && '$capture' in expected) {
    if (actual === undefined || actual === null) fail('expected a value to capture');
    vars[(expected as { $capture: string }).$capture] = actual;
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return fail(`expected an array of ${expected.length}`);
    expected.forEach((e, i) => matches(actual[i], e, `${at}[${i}]`, vars, errors));
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return fail('expected an object');
    for (const [k, e] of Object.entries(expected)) matches((actual as Record<string, unknown>)[k], e, `${at}.${k}`, vars, errors);
    return;
  }
  if (actual !== expected) fail(`expected ${JSON.stringify(expected)}`);
}

// Distinctive viewer ids, so the "no numeric user id" check cannot pass by
// coincidence: none of them appears in any fixture value.
const VIEWER_IDS = Object.fromEntries(Object.keys(contract.viewers).map((name, i) => [name, 730_041 + i * 7])) as Record<
  string,
  number
>;
const ALL_IDS = new Set(Object.values(VIEWER_IDS));

function assertNoUserId(body: unknown, where: string) {
  const walk = (v: unknown, at: string) => {
    if (typeof v === 'number') expect(ALL_IDS.has(v), `${where}: user id at ${at}`).toBe(false);
    else if (typeof v === 'string') {
      for (const id of ALL_IDS) expect(v.includes(String(id)), `${where}: user id in ${at}`).toBe(false);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        expect(['uid', 'userId', 'authorUserId', 'author_uid', 'id'], `${where}: key ${k}`).not.toContain(k);
        walk(x, `${at}.${k}`);
      }
    }
  };
  walk(body, '$');
}

// ---------------------------------------------------------------------------
// Driving one case
// ---------------------------------------------------------------------------

type Observed = { status: number; body: unknown };
type Mode = 'raw' | 'client';

function fakesFor(c: Case): Record<string, FakeStorage> {
  let t = Date.parse('2031-03-04T05:06:07.000Z');
  const consent =
    c.consentMarker === undefined ? undefined : c.consentMarker === 'unavailable' ? ('unavailable' as const) : { revoked: c.consentMarker };
  return Object.fromEntries(
    contract.apps.map((label) => [
      label,
      createFakeStorage({
        manifest: { scopes: contract.defaultScopes, storage: contract.storage },
        limits: { viewerDocs: contract.limits.viewerDocs },
        ...(c.appStatus ? { appStatus: c.appStatus } : {}),
        ...(consent ? { consent } : {}),
        ...(c.storage === 'disabled' ? { disabled: true } : {}),
        now: () => t++,
      }),
    ]),
  );
}

function callerFor(step: Step): { app: string; caller: FakeStorageCaller } {
  const scopes = step.scopes ?? contract.defaultScopes;
  if (step.as === 'none') return { app: contract.apps[0]!, caller: { token: 'none', scopes } };
  const [who, app] = step.as.split('@') as [string, string];
  const v = contract.viewers[who];
  return {
    app,
    caller: {
      viewer:
        who === 'anon'
          ? null
          : {
              username: v!.username,
              id: VIEWER_IDS[who]!,
              trusted: v!.trusted,
              ...(v!.untrustedReason ? { untrustedReason: v!.untrustedReason } : {}),
            },
      token: step.token === 'dev' ? 'dev' : 'block',
      scopes,
    },
  };
}

const LIST_PARAMS = ['sort', 'author', 'markedBy', 'mark', 'keyPrefix', 'limit', 'cursor'];
const onlyKeys = (v: unknown, allowed: string[]) =>
  v === undefined || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => allowed.includes(k)));

type ClientOp = { run: (s: DocumentStorage) => Promise<unknown>; get?: true } | { raw: string };

/** The client call a step describes, or why the client cannot send it. */
function clientOp(method: string, path: string, query: Record<string, string>, body: unknown): ClientOp {
  const seg = path.split('/').filter(Boolean);
  const q = Object.keys(query);
  const b = body as Record<string, unknown> | undefined;
  const strayBody = (allowed: string[]) =>
    onlyKeys(body, allowed) ? null : `body field ${Object.keys(body as object).filter((k) => !allowed.includes(k)).join(',')}`;
  const strayQuery = (allowed: (k: string) => boolean) => {
    const bad = q.filter((k) => !allowed(k));
    return bad.length ? `query ${bad.join(',')}` : null;
  };
  const why = (reason: string | null, run: ClientOp): ClientOp => (reason ? { raw: reason } : run);
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return { raw: `no client method for ${method}` };

  if (seg.length === 0 && method === 'GET') return why(strayQuery(() => false), { run: (s) => s.info() });
  if (seg.length === 1) {
    const [c] = seg as [string];
    if (method === 'GET') {
      return why(strayQuery((k) => LIST_PARAMS.includes(k) || /^where\[[^\]]+\]$/.test(k)), {
        run: (s) => {
          const where: Record<string, string> = {};
          for (const [k, v] of Object.entries(query)) {
            const m = /^where\[([^\]]+)\]$/.exec(k);
            if (m) where[m[1]!] = v;
          }
          return s.collection(c).list({
            ...(Object.keys(where).length ? { where } : {}),
            ...(query.sort !== undefined ? { sort: query.sort } : {}),
            ...(query.author !== undefined ? { author: query.author as 'me' } : {}),
            ...(query.markedBy !== undefined ? { markedBy: query.markedBy as 'me' } : {}),
            ...(query.mark !== undefined ? { mark: query.mark } : {}),
            ...(query.keyPrefix !== undefined ? { keyPrefix: query.keyPrefix } : {}),
            ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
            ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
          });
        },
      });
    }
    if (method === 'POST') {
      return why(strayQuery(() => false) ?? strayBody(['data']), { run: (s) => s.collection(c).create(b?.data as Record<string, unknown>) });
    }
  }
  if (seg.length === 2 && seg[0] === '_get' && method === 'POST') {
    return why(strayQuery(() => false) ?? strayBody(['keys']), {
      run: async (s) => ({ items: await s.collection(seg[1]!).getMany(b?.keys as string[]) }),
    });
  }
  if (seg.length === 2) {
    const [c, k] = seg as [string, string];
    if (method === 'GET') return why(strayQuery(() => false), { run: (s) => s.collection(c).get(k), get: true });
    if (method === 'PUT') {
      return why(strayQuery(() => false) ?? strayBody(['data', 'ifVersion']), {
        run: (s) =>
          s.collection(c).put(k, b?.data as Record<string, unknown>, b?.ifVersion === undefined ? {} : { ifVersion: b.ifVersion as number }),
      });
    }
    if (method === 'DELETE') {
      return why(strayQuery((x) => x === 'ifVersion'), {
        run: (s) => s.collection(c).delete(k, query.ifVersion === undefined ? {} : { ifVersion: Number(query.ifVersion) }),
      });
    }
  }
  if (seg.length === 4 && seg[2] === 'counters' && method === 'POST') {
    const [c, k, , n] = seg as [string, string, string, string];
    return why(strayQuery(() => false) ?? strayBody(['by']), {
      run: (s) => s.collection(c).increment(k, n, b?.by as number | undefined),
    });
  }
  if (seg.length === 4 && seg[2] === 'marks' && (method === 'PUT' || method === 'DELETE')) {
    const [c, k, , n] = seg as [string, string, string, string];
    return why(strayQuery(() => false) ?? (body === undefined ? null : strayBody([])), {
      run: (s) => (method === 'PUT' ? s.collection(c).mark(k, n) : s.collection(c).unmark(k, n)),
    });
  }
  return { raw: `no client method for ${seg.length} segments` };
}

const rawLedger = new Set<string>();
const ran: Record<Mode, Set<string>> = { raw: new Set(), client: new Set() };

async function send(fake: FakeStorage, caller: FakeStorageCaller, method: string, path: string, query: Record<string, string>, body: unknown): Promise<Observed> {
  const before = fake.calls.length;
  try {
    const out = await fake.as(caller).http(method, `blocks/storage${path}`, { query, body });
    expect(fake.calls.length, 'one request per step').toBe(before + 1);
    return { status: fake.calls[before]!.status, body: out };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { status: error.status, body: error.body };
  }
}

/** A client call, observed as a caller sees it: a value or a StorageError. */
async function sendViaClient(fake: FakeStorage, caller: FakeStorageCaller, op: Extract<ClientOp, { run: unknown }>): Promise<Observed> {
  const before = fake.calls.length;
  try {
    const value = await op.run(fake.as(caller).storage);
    const sent = fake.calls.slice(before);
    expect(sent.length, 'the client sends exactly one request').toBe(1);
    if (op.get && value === null) {
      // `get` reads not_found as `null` — and ONLY that code.
      expect(sent[0]!.status).toBe(404);
      expect((sent[0]!.response as { code?: string }).code).toBe('not_found');
      return { status: 404, body: sent[0]!.response };
    }
    expect(sent[0]!.status, 'the client resolved a refusal').toBeLessThan(400);
    // As a caller would serialise it: revived Dates go back to ISO strings.
    return { status: sent[0]!.status, body: JSON.parse(JSON.stringify(value)) as unknown };
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
    const sent = fake.calls.slice(before);
    // Zero requests only for a path segment the client refuses itself.
    expect(sent.length).toBeLessThanOrEqual(1);
    if (sent[0]) expect(error.status).toBe(sent[0].status);
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        error: (error.body as { error?: unknown }).error,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
}

async function runCase(c: Case, mode: Mode) {
  const fakes = fakesFor(c);
  const vars: Vars = {};
  for (const [n, step] of c.steps.entries()) {
    for (let i = 0; i < (step.repeat ?? 1); i++) {
      vars.i = i;
      const { app, caller } = callerFor(step);
      const path = interpolate(step.path, vars);
      const query = Object.fromEntries(Object.entries(step.query ?? {}).map(([k, v]) => [k, interpolate(v, vars)]));
      const body = materialise(step.body, vars);
      const where = `[${mode}] ${c.name} — step ${n + 1}${step.repeat ? ` #${i + 1}` : ''} ${step.method} ${step.path}`;

      let observed: Observed;
      const op = clientOp(step.method, path, query, body);
      if (mode === 'client' && 'run' in op) {
        observed = await sendViaClient(fakes[app]!, caller, op);
      } else {
        if (mode === 'client' && 'raw' in op) rawLedger.add(`${c.name} #${n + 1} ${step.method} ${step.path}: ${op.raw}`);
        observed = await send(fakes[app]!, caller, step.method, path, query, body);
      }

      const errors: string[] = [];
      if (observed.status !== step.expect.status) {
        errors.push(`status ${observed.status} !== ${step.expect.status}: ${JSON.stringify(observed.body)}`);
      }
      if (step.expect.code !== undefined) {
        matches((observed.body as { code?: unknown })?.code, step.expect.code, '$.code', vars, errors);
      }
      if (step.expect.body !== undefined) matches(observed.body, step.expect.body, '$', vars, errors);
      expect(errors, where).toEqual([]);
      assertNoUserId(observed.body, where);
      if (observed.status >= 400) {
        const b = observed.body as Record<string, unknown>;
        expect(typeof b.message, where).toBe('string');
        expect(b.error, where).toBe(b.message);
      }
    }
  }
  ran[mode].add(c.name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the vendored contract', () => {
  it('is the pinned bytes of civitai main (re-check against civitai.com after release)', () => {
    expect(createHash('sha256').update(CONTRACT_BYTES).digest('hex')).toBe(CONTRACT_SHA256);
  });

  it('uses no field, modifier or matcher this runner does not apply', () => {
    expect(Object.keys(contract).filter((k) => !TOP_LEVEL_KEYS.includes(k))).toEqual([]);
    expect(Object.keys(contract.conventions).filter((k) => !CONVENTION_KEYS.includes(k))).toEqual([]);
    expect(Object.keys(contract.stepFields).sort()).toEqual([...HANDLED_STEP_FIELDS].sort());
    const strays: string[] = [];
    const matcherStrings = new Set<string>();
    const walk = (v: unknown) => {
      if (typeof v === 'string' && v.startsWith('$') && !v.startsWith('${')) matcherStrings.add(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const c of contract.cases) {
      strays.push(...Object.keys(c).filter((k) => !CASE_KEYS.includes(k)).map((k) => `${c.name}: ${k}`));
      for (const s of c.steps) {
        strays.push(...Object.keys(s).filter((k) => !STEP_KEYS.includes(k)).map((k) => `${c.name}: step ${k}`));
        strays.push(...Object.keys(s.expect).filter((k) => !['status', 'code', 'body'].includes(k)).map((k) => `${c.name}: expect ${k}`));
        if (s.token !== undefined && s.token !== 'dev') strays.push(`${c.name}: token ${s.token}`);
        walk(s.expect);
      }
      if (c.storage !== undefined && c.storage !== 'disabled') strays.push(`${c.name}: storage ${c.storage}`);
    }
    expect(strays).toEqual([]);
    expect([...matcherStrings].filter((m) => !MATCHERS.includes(m))).toEqual([]);
    // Positive control: the walk saw the matchers the file is known to use.
    expect([...matcherStrings].sort()).toEqual(['$absent', '$iso', '$null', '$number', '$string']);
  });

  it("names the fake's default scanner words in its conventions", () => {
    expect(contract.conventions.blockedText).toBe(FAKE_STORAGE_MODERATION.blockedText);
    expect(contract.conventions.blockedLink).toBe(FAKE_STORAGE_MODERATION.blockedLink);
    expect(contract.conventions.scannerDown).toBe(FAKE_STORAGE_MODERATION.scannerDown);
  });

  it('the matcher and the user-id check go red on what they must refuse (positive control)', () => {
    const errs = (actual: unknown, expected: unknown) => {
      const out: string[] = [];
      matches(actual, expected, '$', {}, out);
      return out.length;
    };
    expect(errs({ a: 1 }, { a: '$absent' })).toBe(1);
    expect(errs({ a: 0 }, { a: '$null' })).toBe(1);
    expect(errs([1, 2], [1])).toBe(1);
    expect(errs({ a: { b: 2 } }, { a: { b: 3 } })).toBe(1);
    expect(errs('x', '$iso')).toBe(1);
    expect(errs({ a: 1, extra: 2 }, { a: 1 })).toBe(0);
    const id = [...ALL_IDS][0]!;
    expect(() => assertNoUserId({ author: { n: id } }, 'control')).toThrow();
    expect(() => assertNoUserId({ author: { uid: 5 } }, 'control')).toThrow();
    expect(() => assertNoUserId({ s: `cursor~${id}` }, 'control')).toThrow();
    expect(() => assertNoUserId({ ok: 1 }, 'control')).not.toThrow();
  });
});

const runnable = contract.cases.filter((c) => !(c.name in FAKE_CANNOT_MODEL));

describe('contract cases against the fake, raw', () => {
  it.each(runnable.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    await runCase(c, 'raw');
  });
});

describe('contract cases through the client, against the fake', () => {
  it.each(runnable.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    await runCase(c, 'client');
  });
});

describe('every case ran', () => {
  it('in both passes, by name — none skipped, none unaccounted for', () => {
    const names = contract.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(FAKE_CANNOT_MODEL).filter((n) => !names.includes(n))).toEqual([]);
    const expected = names.filter((n) => !(n in FAKE_CANNOT_MODEL)).sort();
    expect([...ran.raw].sort()).toEqual(expected);
    expect([...ran.client].sort()).toEqual(expected);
    // Positive control: the file is not empty, so the equalities above compare something.
    expect(names.length).toBeGreaterThanOrEqual(18);
  });

  it('the client pass sent only the ledgered steps raw', () => {
    expect([...rawLedger].sort()).toEqual([...RAW_ONLY_STEPS].sort());
  });
});
