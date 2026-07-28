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

/**
 * A `scope` whose storage getter throws exactly like an opaque origin does.
 *
 * `enumerable: true` + no setter is the real `Window.localStorage` shape (a
 * WebIDL *readonly* attribute), and the sandbox does not change it — only the
 * getter's behaviour differs there.
 */
function scopeWhereStorageThrows(name: StorageName = 'localStorage'): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  Object.defineProperty(scope, name, {
    configurable: true,
    enumerable: true,
    set: undefined,
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

/**
 * Same failure, but installed on the real global — with a restore function.
 *
 * The descriptor is spelled out in full on purpose. `Object.defineProperty`
 * *merges* into an existing configurable property, and Node >= 22 already
 * defines `globalThis.localStorage` as a non-enumerable accessor **with a
 * setter** — so a `{ get }`-only redefinition would silently inherit Node's
 * `set` and `enumerable: false` and no longer look like a browser at all.
 * A real `Window.localStorage` is a WebIDL *readonly* attribute: enumerable,
 * with no setter.
 */
function breakGlobalStorage(name: StorageName = 'localStorage'): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    set: undefined,
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

  it('refuses preventExtensions/freeze instead of bricking enumeration forever', () => {
    const s = createMemoryStorage();
    s.setItem('a', '1');

    // A SES / `harden()` lockdown sweep freezes every reachable global. Real
    // `Storage` is a legacy platform object with a named-property handler, so
    // its [[PreventExtensions]] returns false and it carries on working.
    expect(() => Object.preventExtensions(s)).toThrow(TypeError);
    expect(() => Object.freeze(s)).toThrow(TypeError);
    expect(Object.isExtensible(s)).toBe(true);

    // The point of refusing: a non-extensible target would make the `ownKeys`
    // trap violate a proxy invariant, and `Object.keys` / spread /
    // `JSON.stringify` / `for...in` would throw on this object PERMANENTLY.
    expect(Object.keys(s)).toEqual(['a']);
    expect(JSON.stringify(s)).toBe('{"a":"1"}');

    s.setItem('b', '2');
    expect({ ...(s as unknown as Record<string, unknown>) }).toEqual({ a: '1', b: '2' });
    const seen: string[] = [];
    for (const key in s as unknown as Record<string, unknown>) seen.push(key);
    expect(seen).toEqual(['a', 'b']);
  });

  it('ignores deletes of the Storage API, exactly as the real thing does', () => {
    const s = createMemoryStorage();
    s.setItem('kept', 'yes');
    const bare = s as unknown as Record<string, unknown>;

    // Real `Storage` keeps its API on `Storage.prototype`, so an instance
    // delete finds no own property: it reports success and changes nothing.
    expect(delete bare.getItem).toBe(true);
    expect(delete bare.setItem).toBe(true);
    expect(delete bare.length).toBe(true);

    expect(typeof s.getItem).toBe('function');
    expect(typeof s.setItem).toBe('function');
    expect(s.length).toBe(1);
    expect(s.getItem('kept')).toBe('yes');

    // The corruption this prevents: `length` gone undefined makes every
    // `for (i < storage.length)` loop silently iterate zero times.
    const keys: Array<string | null> = [];
    for (let i = 0; i < s.length; i += 1) keys.push(s.key(i));
    expect(keys).toEqual(['kept']);

    // Stored keys still delete for real.
    expect(delete bare.kept).toBe(true);
    expect(s.getItem('kept')).toBeNull();
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
    // Nothing to inherit at an opaque origin — the old store was unreadable.
    expect(ls.length).toBe(0);
    ls.setItem('k', 'v');
    expect(ls.getItem('k')).toBe('v');
  });

  it('classifies the sandbox as broken even though `typeof` throws there too', () => {
    const scope = scopeWhereStorageThrows();

    // The conventional `typeof localStorage === 'undefined'` guard does NOT
    // protect: `typeof` still resolves the property and runs the throwing
    // getter. Only `typeof` of an *undeclared identifier* is safe.
    expect(() => typeof (scope as { localStorage: unknown }).localStorage).toThrow(
      /allow-same-origin/,
    );

    // `in` runs [[HasProperty]], which never invokes the getter — and it
    // correctly answers `true`: in the sandbox the global exists, it is merely
    // unreadable. So the sandbox must never be mistaken for `absent`.
    expect('localStorage' in scope).toBe(true);
    expect(installSafeStorage(scope).localStorage).toBe(true);
  });

  it('installs the fallback as a non-writable property', () => {
    const scope = scopeWhereStorageThrows();
    installSafeStorage(scope);
    const installed = scope.localStorage;

    const descriptor = Object.getOwnPropertyDescriptor(scope, 'localStorage');
    expect(descriptor?.writable).toBe(false);

    // Matches the browser, sandboxed or not: `window.localStorage = x` throws
    // in strict mode on the real thing. A writable shim would quietly accept
    // the assignment and hand blocks behaviour production does not have.
    expect(() => {
      (scope as Record<string, unknown>).localStorage = createMemoryStorage();
    }).toThrow(TypeError);
    expect(scope.localStorage).toBe(installed);

    // Still `configurable`, so a consumer can deliberately swap in its own.
    expect(descriptor?.configurable).toBe(true);
    const own = createMemoryStorage();
    Object.defineProperty(scope, 'localStorage', { configurable: true, value: own });
    expect(scope.localStorage).toBe(own);
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

  it('answers "does it exist" with `in`, never by reading the property', () => {
    // [[HasProperty]] cannot run user code; a property *read* can run anything.
    let reads = 0;
    const scope = new Proxy({} as Record<string, unknown>, {
      has: () => false,
      get(_target, prop) {
        reads += 1;
        throw new Error(`must not read ${String(prop)}`);
      },
    });

    expect(installSafeStorage(scope)).toEqual({ localStorage: false, sessionStorage: false });
    expect(reads).toBe(0);
  });

  it("never reads Node's disabled web-storage stub", () => {
    // Node >= 22 defines `localStorage`/`sessionStorage` as lazy accessors.
    // Without `--localstorage-file` they return `undefined` AND emit
    // `ExperimentalWarning: localStorage is not available…` on every read — so
    // a bare import of this module would print that on every server boot and
    // in CI. `in` does not trip the warning, but it does answer `true` there,
    // so existence alone is not enough to skip the read.
    let reads = 0;
    const scope: Record<string, unknown> = {};
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(scope, name, {
        configurable: true,
        enumerable: false, // Node's stub. A browser's is enumerable.
        get() {
          reads += 1;
          return undefined;
        },
        set() {}, // Node's stub is replaceable. A WebIDL readonly attribute is not.
      });
    }

    expect(installSafeStorage(scope)).toEqual({ localStorage: false, sessionStorage: false });
    expect(reads).toBe(0);
  });

  it('still probes a browser-shaped accessor while running on Node', () => {
    // The guard above must never swallow a real sandbox — including in the
    // Node-hosted test/SSR runs where every one of these tests executes.
    // `Window.localStorage` is a WebIDL *readonly* attribute, so it is
    // enumerable with no setter; that is what separates it from Node's stub.
    let reads = 0;
    const scope: Record<string, unknown> = {};
    Object.defineProperty(scope, 'localStorage', {
      configurable: true,
      enumerable: true,
      set: undefined,
      get() {
        reads += 1;
        throw new DOMException(SECURITY_ERROR_MESSAGE, 'SecurityError');
      },
    });

    expect(installSafeStorage(scope).localStorage).toBe(true);
    // Read exactly once: an arbitrary getter can have arbitrary side effects,
    // so the probe carries its value out rather than re-reading it to seed.
    expect(reads).toBe(1);
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

  it('inherits the entries of a store that reads fine but refuses writes', () => {
    // The likeliest real-world trigger — a full quota, historically the
    // Safari-private-mode shape — on an ordinary (non-sandboxed) origin, where
    // the data is real and readable. Shadowing it with an empty store would
    // turn "can't save" into "the session is gone".
    const entries = new Map([
      ['session', 'abc123'],
      ['prefs', '{"theme":"dark"}'],
    ]);
    const full = {
      get length() {
        return entries.size;
      },
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem() {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      },
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    };
    const scope: Record<string, unknown> = { localStorage: full };

    expect(installSafeStorage(scope).localStorage).toBe(true);

    const now = scope.localStorage as Storage;
    expect(now).not.toBe(full);
    expect(now.getItem('session')).toBe('abc123');
    expect(now.getItem('prefs')).toBe('{"theme":"dark"}');
    expect(now.length).toBe(2);
    // …and writes stop throwing, which is why we replaced it at all.
    expect(() => now.setItem('fresh', 'v')).not.toThrow();
    expect(now.getItem('fresh')).toBe('v');
  });

  it('still installs when the old store cannot be enumerated', () => {
    // Seeding is best-effort: a store that reads but explodes mid-enumeration
    // must still end up replaced, not propagate.
    const scope: Record<string, unknown> = {
      localStorage: {
        length: 3,
        key() {
          throw new Error('enumeration exploded');
        },
        getItem: () => null,
        setItem() {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        },
        removeItem() {},
      },
    };

    expect(() => installSafeStorage(scope)).not.toThrow();
    expect(installSafeStorage(scope).localStorage).toBe(false);
    expect((scope.localStorage as Storage).length).toBe(0);
    expect(() => (scope.localStorage as Storage).setItem('a', 'b')).not.toThrow();
  });

  it('repairs an object that is not Storage-shaped at all', () => {
    const scope: Record<string, unknown> = { localStorage: { nope: true } };
    expect(installSafeStorage(scope).localStorage).toBe(true);
    expect(typeof (scope.localStorage as Storage).getItem).toBe('function');
  });

  it('repairs a revoked Proxy without propagating its TypeError', () => {
    // Every operation on a revoked Proxy throws — including the plain property
    // read of `.getItem`. This runs at module scope, so an escaping error would
    // reject `import '@civitai/app-sdk/blocks'` and take the whole block down.
    const { proxy, revoke } = Proxy.revocable(
      { getItem: () => null, setItem() {}, removeItem() {} },
      {},
    );
    revoke();
    const scope: Record<string, unknown> = { localStorage: proxy };

    expect(() => (proxy as { getItem: unknown }).getItem).toThrow(TypeError);
    expect(() => installSafeStorage(scope)).not.toThrow();
    expect(installSafeStorage(scope).localStorage).toBe(false);

    const now = scope.localStorage as Storage;
    now.setItem('k', 'v');
    expect(now.getItem('k')).toBe('v');
  });

  it('repairs an object whose property access throws', () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'getItem', {
      configurable: true,
      get() {
        throw new TypeError('property access explodes');
      },
    });
    const scope: Record<string, unknown> = { localStorage: hostile };

    expect(() => installSafeStorage(scope)).not.toThrow();
    expect(installSafeStorage(scope).localStorage).toBe(false);
    expect(typeof (scope.localStorage as Storage).getItem).toBe('function');
    expect(() => (scope.localStorage as Storage).setItem('a', 'b')).not.toThrow();
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
