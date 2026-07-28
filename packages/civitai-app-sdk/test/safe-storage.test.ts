import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryStorage, installSafeStorage } from '../src/safe-storage/index.js';

/**
 * The exact message a browser produces when a document sandboxed without
 * `allow-same-origin` touches web storage.
 */
const SECURITY_ERROR_MESSAGE =
  "Failed to read the 'localStorage' property from 'Window': The document is " +
  "sandboxed and lacks the 'allow-same-origin' flag.";

type StorageName = 'localStorage' | 'sessionStorage';

/** A `scope` whose storage getter throws exactly like an opaque origin does. */
function scopeWhereStorageThrows(name: StorageName = 'localStorage'): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  Object.defineProperty(scope, name, {
    configurable: true,
    get() {
      throw new DOMException(SECURITY_ERROR_MESSAGE, 'SecurityError');
    },
  });
  return scope;
}

/** A `scope` carrying a healthy, real-enough Storage. */
function scopeWithWorkingStorage(name: StorageName = 'localStorage'): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  Object.defineProperty(scope, name, {
    configurable: true,
    writable: false,
    value: createMemoryStorage(),
  });
  return scope;
}

/** Same failure, but installed on the real global — with a restore function. */
function breakGlobalStorage(name: StorageName = 'localStorage'): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new DOMException(SECURITY_ERROR_MESSAGE, 'SecurityError');
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete (globalThis as Record<string, unknown>)[name];
  };
}

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length) restores.pop()?.();
  vi.resetModules();
});

describe('createMemoryStorage', () => {
  it('implements the whole Storage API', () => {
    const s = createMemoryStorage();

    expect(s.length).toBe(0);
    expect(s.getItem('missing')).toBeNull();

    s.setItem('a', '1');
    s.setItem('b', '2');
    expect(s.getItem('a')).toBe('1');
    expect(s.length).toBe(2);

    s.removeItem('a');
    expect(s.getItem('a')).toBeNull();
    expect(s.length).toBe(1);

    s.clear();
    expect(s.length).toBe(0);
    expect(s.getItem('b')).toBeNull();
  });

  it('reports key() in insertion order and null past the end', () => {
    const s = createMemoryStorage();
    s.setItem('first', '1');
    s.setItem('second', '2');
    s.setItem('third', '3');

    expect(s.key(0)).toBe('first');
    expect(s.key(1)).toBe('second');
    expect(s.key(2)).toBe('third');
    expect(s.key(3)).toBeNull();
    expect(s.key(-1)).toBeNull();

    // Overwriting keeps the original position, as a real Storage does.
    s.setItem('first', 'updated');
    expect(s.key(0)).toBe('first');
    expect(s.length).toBe(3);

    s.removeItem('second');
    expect(s.key(1)).toBe('third');
  });

  it('coerces keys and values to strings', () => {
    const s = createMemoryStorage();
    s.setItem('n', 1 as unknown as string);
    expect(s.getItem('n')).toBe('1');
    s.setItem('bool', true as unknown as string);
    expect(s.getItem('bool')).toBe('true');
    s.setItem(7 as unknown as string, 'seven');
    expect(s.getItem('7')).toBe('seven');
  });

  it('honours the exotic access patterns libraries actually use', () => {
    // `in`, bracket get, bracket set, delete — the shape that makes a plain
    // class insufficient and forces the Proxy.
    const s = createMemoryStorage() as unknown as Record<string, unknown>;
    const KEY = 'lib_touchSupport';

    expect(KEY in s).toBe(false);
    expect(s[KEY]).toBeUndefined();

    s[KEY] = true;

    expect(KEY in s).toBe(true);
    // Libraries compare against the STRING 'true' — the shim must stringify.
    expect(s[KEY]).toBe('true');
    expect((s as unknown as Storage).getItem(KEY)).toBe('true');

    delete s[KEY];
    expect(KEY in s).toBe(false);
    expect((s as unknown as Storage).getItem(KEY)).toBeNull();
  });

  it('enumerates stored entries only, never the API methods', () => {
    const s = createMemoryStorage();
    s.setItem('x', '1');
    s.setItem('y', '2');

    expect(Object.keys(s).sort()).toEqual(['x', 'y']);
    expect({ ...(s as unknown as Record<string, unknown>) }).toEqual({ x: '1', y: '2' });
    expect(Object.entries(s as unknown as Record<string, string>)).toEqual([
      ['x', '1'],
      ['y', '2'],
    ]);
  });

  it('still exposes the Storage methods through the proxy', () => {
    const s = createMemoryStorage();
    expect(typeof s.getItem).toBe('function');
    expect(typeof s.setItem).toBe('function');
    expect(typeof s.removeItem).toBe('function');
    expect(typeof s.clear).toBe('function');
    expect(typeof s.key).toBe('function');
    expect('getItem' in s).toBe(true);
    expect('length' in s).toBe(true);
    // Prototype-chain lookups behave like a real object, not a bare map.
    expect('toString' in s).toBe(true);
  });
});

describe('installSafeStorage', () => {
  it('repairs a storage whose getter throws', () => {
    const scope = scopeWhereStorageThrows();
    expect(() => scope.localStorage).toThrow(/allow-same-origin/);

    expect(installSafeStorage(scope)).toEqual({ localStorage: true, sessionStorage: false });

    expect(() => scope.localStorage).not.toThrow();
    const ls = scope.localStorage as Storage;
    ls.setItem('k', 'v');
    expect(ls.getItem('k')).toBe('v');
  });

  it('repairs sessionStorage independently of localStorage', () => {
    const scope = scopeWhereStorageThrows('sessionStorage');
    expect(installSafeStorage(scope)).toEqual({ localStorage: false, sessionStorage: true });
    expect(() => (scope.sessionStorage as Storage).setItem('a', 'b')).not.toThrow();
  });

  it('repairs both when both are broken', () => {
    const scope = scopeWhereStorageThrows('localStorage');
    Object.defineProperty(scope, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException(SECURITY_ERROR_MESSAGE, 'SecurityError');
      },
    });

    expect(installSafeStorage(scope)).toEqual({ localStorage: true, sessionStorage: true });
  });

  it('leaves a working storage completely untouched', () => {
    const scope = scopeWithWorkingStorage();
    const before = scope.localStorage as Storage;
    before.setItem('preexisting', 'kept');

    expect(installSafeStorage(scope)).toEqual({ localStorage: false, sessionStorage: false });

    expect(scope.localStorage).toBe(before);
    expect((scope.localStorage as Storage).getItem('preexisting')).toBe('kept');
    expect((scope.localStorage as Storage).length).toBe(1);
  });

  it('does not invent storage where the runtime has none (Node/SSR/workers)', () => {
    // Feature detection (`typeof localStorage === 'undefined'`) is how
    // isomorphic libraries pick their browser path. Fabricating a Storage in a
    // server runtime would swap one bug class for another.
    const scope: Record<string, unknown> = {};

    expect(installSafeStorage(scope)).toEqual({ localStorage: false, sessionStorage: false });

    expect('localStorage' in scope).toBe(false);
    expect(scope.localStorage).toBeUndefined();
    expect(scope.sessionStorage).toBeUndefined();
  });

  it('treats an explicitly null storage as absent, not broken', () => {
    const scope: Record<string, unknown> = { localStorage: null };
    expect(installSafeStorage(scope).localStorage).toBe(false);
    expect(scope.localStorage).toBeNull();
  });

  it('is idempotent and preserves values written to the fallback', () => {
    const scope = scopeWhereStorageThrows();

    expect(installSafeStorage(scope).localStorage).toBe(true);
    (scope.localStorage as Storage).setItem('keep', 'me');
    const first = scope.localStorage;

    // Second call must be a no-op — the fallback now round-trips, so it reads
    // as a working Storage.
    expect(installSafeStorage(scope).localStorage).toBe(false);
    expect(scope.localStorage).toBe(first);
    expect((scope.localStorage as Storage).getItem('keep')).toBe('me');
  });

  it('repairs a storage that reads fine but throws on write', () => {
    // Storage disabled / quota exhausted / private-browsing quirks: the getter
    // succeeds, so only a real round-trip probe catches it.
    const scope: Record<string, unknown> = {
      localStorage: {
        getItem: () => null,
        setItem() {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        },
        removeItem() {},
      },
    };

    expect(installSafeStorage(scope).localStorage).toBe(true);
    expect(() => (scope.localStorage as Storage).setItem('a', 'b')).not.toThrow();
  });

  it('repairs an object that is not Storage-shaped at all', () => {
    const scope: Record<string, unknown> = { localStorage: { nope: true } };
    expect(installSafeStorage(scope).localStorage).toBe(true);
    expect(typeof (scope.localStorage as Storage).getItem).toBe('function');
  });

  it('degrades quietly when the property cannot be redefined', () => {
    const scope: Record<string, unknown> = {};
    Object.defineProperty(scope, 'localStorage', {
      configurable: false,
      get() {
        throw new DOMException(SECURITY_ERROR_MESSAGE, 'SecurityError');
      },
    });

    // Best-effort: it must never become its own boot failure.
    expect(() => installSafeStorage(scope)).not.toThrow();
    expect(installSafeStorage(scope).localStorage).toBe(false);
  });

  it('repairs the real global when called with no scope', () => {
    restores.push(breakGlobalStorage());
    expect(() => globalThis.localStorage).toThrow(/allow-same-origin/);

    expect(installSafeStorage().localStorage).toBe(true);

    expect(() => globalThis.localStorage).not.toThrow();
    globalThis.localStorage.setItem('k', 'v');
    expect(globalThis.localStorage.getItem('k')).toBe('v');
  });
});

describe('import-time regression (the shape that broke production)', () => {
  const FIXTURE = './fixtures/reads-storage-on-import.js';

  it('NEGATIVE CONTROL: an unrepaired opaque origin kills the dependency at import', async () => {
    restores.push(breakGlobalStorage());
    vi.resetModules();

    // Nothing outside the dependency can guard this — it throws while the
    // module body evaluates, before any app code runs.
    await expect(import(FIXTURE)).rejects.toThrow(/allow-same-origin/);
  });

  it('importing @civitai/app-sdk/safe-storage first lets that dependency load', async () => {
    restores.push(breakGlobalStorage());
    vi.resetModules();

    // The only ordering that works: a side-effect IMPORT, not a call — module
    // imports are hoisted above every statement.
    await import('../src/safe-storage/index.js');
    const mod = await import(FIXTURE);

    expect(mod.state.touchEnabled).toBe(false);
    // Its unguarded bracket write landed in the fallback, stringified.
    expect(globalThis.localStorage.getItem(mod.state.key)).toBe('true');
  });

  it('importing the block contract (@civitai/app-sdk/blocks) is enough on its own', async () => {
    restores.push(breakGlobalStorage());
    vi.resetModules();

    // Blocks reach the shim without knowing it exists: the contract entry every
    // block builds against imports it first.
    await import('../src/blocks/index.js');

    expect(() => globalThis.localStorage).not.toThrow();
    await expect(import(FIXTURE)).resolves.toBeDefined();
  });

  it('auto-install is inert when storage already works', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const working = createMemoryStorage();
    working.setItem('preexisting', 'kept');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: false,
      value: working,
    });
    restores.push(() => {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as Record<string, unknown>).localStorage;
    });
    vi.resetModules();

    await import('../src/safe-storage/index.js');

    expect(globalThis.localStorage).toBe(working);
    expect(globalThis.localStorage.getItem('preexisting')).toBe('kept');
    // The probe cleans up after itself.
    expect(globalThis.localStorage.length).toBe(1);
  });

  it('auto-install does not fabricate storage in a runtime without it', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    delete (globalThis as Record<string, unknown>).localStorage;
    restores.push(() => {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    });
    vi.resetModules();

    await import('../src/safe-storage/index.js');

    expect((globalThis as Record<string, unknown>).localStorage).toBeUndefined();
  });
});
