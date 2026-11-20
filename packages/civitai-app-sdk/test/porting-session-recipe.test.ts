/**
 * EXECUTES the session recipe in PORTING.md "Step 4 — Session storage"
 * against this package's source, instead of reading it.
 *
 * WHY THIS EXISTS. #805 and #807. The recipe's `readSession()` refreshed in
 * place — `writeSession()` on success, `deleteCookie()` in a catch-all — while
 * the wiring note told Next.js users to call it from Server Components, where
 * Next forbids cookie writes. Its refresh call also omitted `fallbackScope`, so
 * a token response without `scope` (RFC 6749 §6 allows it) persisted scope 0,
 * and the catch-all signed the user out on a 503 as readily as on a revoked
 * refresh token. Nothing read the recipe, because PORTING.md is prose: no
 * typecheck, no test. Every reader who copied it inherited all three.
 *
 * WHAT IT DOES. Extracts the ONE TypeScript fence between the "## Step 4"
 * heading and the section's first "###" subheading, points its
 * `@civitai/app-sdk` import at `src/index.ts`, binds the recipe's free
 * `getCookie` / `setCookie` / `deleteCookie` to an in-memory jar, stubs
 * `fetch`, and imports the result as a module. Then it asserts the contract:
 *
 *  1. `readSession()` performs ZERO cookie writes and no network call, for a
 *     fresh session AND for an expired one — the expired case is the one that
 *     used to write. The jar's write operations throw, as Next's do in a
 *     Server Component, so an attempted write is also a failure.
 *  2. `refreshSession()` on a response that omits `scope` keeps the stored
 *     65537 (in the returned cookie and in a later `readSession()`), and a
 *     response that states a scope wins (control: the fallback must not
 *     simply shadow the server).
 *  3. A 503, a 429 and a network error leave the cookie byte-for-byte intact.
 *  4. A 400 `invalid_grant` and a 401 clear it.
 *  5. `refreshSession()` leaves a fresh session alone (no fetch, no write),
 *     and clears an expired one that has no refresh token without a fetch.
 *
 * WATCHED TO FAIL against the pre-fix recipe (origin/main @ 75036eca), with
 * the refresh entry point temporarily resolved as `refreshSession ??
 * readSession` so the old in-place refresh could be driven: (1) failed on the
 * attempted write, (2) persisted scope 0, (3) deleted the cookie on every
 * transient failure; (4) passed — clearing on a rejection was never the bug.
 * Recorded in the PR.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sealCookie, unsealCookie } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const PORTING = join(PKG, '..', '..', 'PORTING.md');
const SRC_INDEX = join(PKG, 'src', 'index.ts');

const SECRET = 'porting-recipe-test-secret-0123456789abcdef';
const COOKIE = 'civ_session';
const PRIOR_SCOPE = 65537;

/** The TypeScript fences of Step 4, before its first `###` subheading. */
export function step4Fences(md: string): string[] {
  const start = md.search(/^## Step 4\b/m);
  if (start < 0) return [];
  const rest = md.slice(start + 1);
  const endRel = rest.search(/^#{2,3} /m);
  const section = endRel < 0 ? rest : rest.slice(0, endRel);
  return Array.from(section.matchAll(/^```ts\n([\s\S]*?)^```$/gm), (m) => m[1]);
}

// ---------------------------------------------------------------------------
// The in-memory jar the recipe's free cookie functions are bound to.
// ---------------------------------------------------------------------------

interface JarState {
  store: Map<string, string>;
  writes: { op: 'set' | 'delete'; name: string; value?: string }[];
  /** When true, set/delete throw — Next.js's behaviour in a Server Component. */
  readOnly: boolean;
}

const jar: JarState = { store: new Map(), writes: [], readOnly: false };

(globalThis as Record<string, unknown>).__portingJar = {
  getCookie: (name: string) => jar.store.get(name),
  setCookie: (name: string, value: string) => {
    jar.writes.push({ op: 'set', name, value });
    if (jar.readOnly) throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    jar.store.set(name, value);
  },
  deleteCookie: (name: string) => {
    jar.writes.push({ op: 'delete', name });
    if (jar.readOnly) throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    jar.store.delete(name);
  },
};

interface Recipe {
  readSession: () => unknown;
  refreshSession: () => Promise<unknown>;
}

let recipe: Recipe;
let dir: string;

beforeAll(async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.CIVITAI_CLIENT_ID = 'fixture-client';
  process.env.CIVITAI_AUTH_URL = 'https://auth.fixture.invalid';

  const fences = step4Fences(readFileSync(PORTING, 'utf8'));
  // Extraction control: exactly the one recipe fence, and it is the recipe.
  expect(fences).toHaveLength(1);
  const [code] = fences;
  expect(code).toContain('function readSession');

  const importSite = /from '@civitai\/app-sdk';/g;
  expect(code.match(importSite)).toHaveLength(1);
  const module =
    `const { getCookie, setCookie, deleteCookie } = (globalThis as any).__portingJar;\n` +
    code.replace(importSite, `from ${JSON.stringify(SRC_INDEX)};`);

  dir = mkdtempSync(join(tmpdir(), 'porting-step4-'));
  const file = join(dir, 'step4.ts');
  writeFileSync(file, module);
  recipe = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Recipe;
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

beforeEach(() => {
  jar.store.clear();
  jar.writes.length = 0;
  jar.readOnly = false;
  vi.unstubAllGlobals();
});

function seed(expiresInMs: number, scope = PRIOR_SCOPE): string {
  const sealed = sealCookie(
    JSON.stringify({
      tokens: {
        access_token: 'fixture-old',
        refresh_token: 'fixture-r0',
        expires_at: Date.now() + expiresInMs,
        scope,
        token_type: 'Bearer',
      },
    }),
    SECRET,
  );
  jar.store.set(COOKIE, sealed);
  return sealed;
}

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function storedScope(): number {
  const sealed = jar.store.get(COOKIE);
  expect(sealed, 'session cookie').toBeTypeOf('string');
  const raw = unsealCookie(sealed!, SECRET);
  return JSON.parse(raw!).tokens.scope;
}

const OMITTED_SCOPE = { access_token: 'fixture-new', refresh_token: 'fixture-r1', expires_in: 3600, token_type: 'Bearer' };

describe('PORTING.md Step 4 — readSession is a pure read (#805)', () => {
  it('exports both halves', () => {
    expect(recipe.readSession).toBeTypeOf('function');
    expect(recipe.refreshSession).toBeTypeOf('function');
  });

  it('returns a fresh session with zero cookie writes and no network', async () => {
    jar.readOnly = true;
    seed(60 * 60 * 1000);
    const fetchFn = stubFetch(() => json(200, OMITTED_SCOPE));
    const session = (await recipe.readSession()) as { tokens: { access_token: string } } | null;
    expect(session?.tokens.access_token).toBe('fixture-old');
    expect(jar.writes).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns null for an EXPIRED session with zero cookie writes and no network', async () => {
    // The case that used to write: refresh-on-read called writeSession here.
    jar.readOnly = true;
    seed(-60 * 60 * 1000);
    const fetchFn = stubFetch(() => json(200, OMITTED_SCOPE));
    await expect(Promise.resolve().then(() => recipe.readSession())).resolves.toBeNull();
    expect(jar.writes).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('PORTING.md Step 4 — refreshSession only acts on an expiring session', () => {
  it('leaves a fresh session alone: no network, no cookie write', async () => {
    seed(60 * 60 * 1000);
    const fetchFn = stubFetch(() => json(200, OMITTED_SCOPE));
    await recipe.refreshSession();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(jar.writes).toEqual([]);
  });

  it('clears an expired session that has no refresh token, without a network call', async () => {
    jar.store.set(
      COOKIE,
      sealCookie(
        JSON.stringify({ tokens: { access_token: 'fixture-old', expires_at: Date.now() - 60_000, scope: PRIOR_SCOPE } }),
        SECRET,
      ),
    );
    const fetchFn = stubFetch(() => json(200, OMITTED_SCOPE));
    await recipe.refreshSession();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(jar.store.has(COOKIE)).toBe(false);
  });
});

describe('PORTING.md Step 4 — refreshSession keeps the granted scope (#807)', () => {
  it('a response that omits scope keeps the stored 65537', async () => {
    seed(-60 * 60 * 1000);
    const fetchFn = stubFetch(() => json(200, OMITTED_SCOPE));
    await recipe.refreshSession();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(storedScope()).toBe(PRIOR_SCOPE);
    const after = (await recipe.readSession()) as { tokens: { access_token: string; scope: number } };
    expect(after.tokens.access_token).toBe('fixture-new');
    expect(after.tokens.scope).toBe(PRIOR_SCOPE);
  });

  it('CONTROL — a response that states a scope wins over the stored one', async () => {
    seed(-60 * 60 * 1000);
    stubFetch(() => json(200, { ...OMITTED_SCOPE, scope: 3 }));
    await recipe.refreshSession();
    expect(storedScope()).toBe(3);
  });
});

describe('PORTING.md Step 4 — only a definite rejection clears the session (#805)', () => {
  it.each([
    ['503', () => json(503, { error: 'temporarily_unavailable' })],
    ['429', () => json(429, { error: 'slow_down' })],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
  ])('%s keeps the cookie byte-for-byte so the next request retries', async (_label, impl) => {
    const sealed = seed(-60 * 60 * 1000);
    const fetchFn = stubFetch(impl);
    await recipe.refreshSession();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(jar.writes.filter((w) => w.op === 'delete')).toEqual([]);
    expect(jar.store.get(COOKIE)).toBe(sealed);
  });

  it.each([
    ['400 invalid_grant', 400],
    ['401', 401],
  ])('%s clears it', async (_label, status) => {
    seed(-60 * 60 * 1000);
    stubFetch(() => json(status, { error: 'invalid_grant' }));
    await recipe.refreshSession();
    expect(jar.store.has(COOKIE)).toBe(false);
    expect(jar.writes.some((w) => w.op === 'delete' && w.name === COOKIE)).toBe(true);
  });
});
