/**
 * `@civitai/app-sdk/safe-storage` — survive an opaque-origin sandbox.
 *
 * Civitai Apps run in an iframe sandboxed as `allow-scripts allow-forms`,
 * deliberately WITHOUT `allow-same-origin`. The document therefore has an
 * **opaque origin**, and there is no origin to key web storage against, so the
 * platform does not merely return an empty store — merely *reading* the
 * property throws:
 *
 *   SecurityError: Failed to read the 'localStorage' property from 'Window':
 *   The document is sandboxed and lacks the 'allow-same-origin' flag.
 *
 * Guarding your own call sites is not enough: any third-party dependency that
 * touches storage unguarded takes the whole app down, and libraries routinely
 * *mislabel* the failure. A real production example — Photo Sphere Viewer's
 * `SYSTEM.load()` runs an unguarded ``TOUCH_KEY in localStorage`` touch probe,
 * its `Viewer` constructor catches the resulting SecurityError, reports the
 * generic "Your browser does not seem to support WebGL", and returns without
 * rethrowing. The app's own fallback never ran and users with perfectly good
 * GPUs saw a WebGL error. (The sandbox does not block WebGL — only storage.)
 *
 * So this module installs a spec-shaped in-memory `Storage` over any
 * `localStorage`/`sessionStorage` that is present but unusable. Importing it
 * runs the install (see the bottom of the file); it is also re-exported as a
 * function for explicit use.
 *
 * The fallback is session-scoped — nothing survives a reload — which is the
 * honest semantic at an opaque origin: there is no origin to persist against.
 * Treat storage in a block as a cache, never a source of truth; the durable
 * per-user store is the platform's app-storage API.
 */

/** Which globals a call to {@link installSafeStorage} actually replaced. */
export interface SafeStorageInstallResult {
  /** `true` when `localStorage` was replaced by the in-memory fallback. */
  localStorage: boolean;
  /** `true` when `sessionStorage` was replaced by the in-memory fallback. */
  sessionStorage: boolean;
}

const STORAGE_NAMES = ['localStorage', 'sessionStorage'] as const;

/** The web-storage globals this module can repair. */
export type SafeStorageName = (typeof STORAGE_NAMES)[number];

const PROBE_KEY = '__civitai_app_sdk_storage_probe__';

/**
 * A `Storage` work-alike backed by a `Map`.
 *
 * Implemented as a **Proxy, not a class**, because real `Storage` is an exotic
 * object: `s.foo = 1`, `'foo' in s`, `s.foo` and `delete s.foo` are aliases for
 * `setItem`/`getItem`/`removeItem`. Libraries use exactly that form (PSV's
 * touch probe is literally ``KEY in localStorage`` then
 * `localStorage[KEY] === 'true'`), so a plain class would still break them.
 */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>();

  const api = {
    getItem(key: string): string | null {
      const k = String(key);
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(key: string, value: string): void {
      map.set(String(key), String(value));
    },
    removeItem(key: string): void {
      map.delete(String(key));
    },
    clear(): void {
      map.clear();
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    get length(): number {
      return map.size;
    },
  };

  // `Reflect.has` walks the prototype chain, so `'toString' in storage` stays
  // true exactly as it is for a real Storage instance. Only keys that are NOT
  // part of the Storage API fall through to the backing map.
  const isApiKey = (prop: string | symbol): boolean =>
    typeof prop === 'symbol' || Reflect.has(api, prop);

  return new Proxy(api, {
    get(target, prop, receiver) {
      if (isApiKey(prop)) return Reflect.get(target, prop, receiver);
      return map.get(prop as string);
    },
    set(target, prop, value, receiver) {
      if (isApiKey(prop)) return Reflect.set(target, prop, value, receiver);
      map.set(prop as string, String(value));
      return true;
    },
    has(_target, prop) {
      return isApiKey(prop) || map.has(prop as string);
    },
    deleteProperty(target, prop) {
      if (isApiKey(prop)) return Reflect.deleteProperty(target, prop);
      map.delete(prop as string);
      return true;
    },
    // Enumeration sees only stored keys — matching real Storage, where
    // `Object.keys(localStorage)` lists the entries, not the methods.
    ownKeys() {
      return Array.from(map.keys());
    },
    getOwnPropertyDescriptor(target, prop) {
      if (!isApiKey(prop) && map.has(prop as string)) {
        return {
          value: map.get(prop as string),
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as unknown as Storage;
}

/** What a probe of `scope[name]` concluded. */
type Health = 'usable' | 'absent' | 'broken';

/**
 * Classify `scope[name]`.
 *
 * Reading the property can succeed while writing still throws (storage
 * disabled, private-browsing quirks, quota exhausted), so probe a real
 * round-trip rather than trusting the getter.
 *
 * `absent` is deliberately distinct from `broken`: a runtime with no web
 * storage at all (Node/SSR, a worker) must be left alone. Inventing a
 * `localStorage` there would flip isomorphic libraries onto their browser code
 * path and cause a *different* class of bug than the one we are fixing.
 */
function probe(scope: object, name: SafeStorageName): Health {
  let storage: Storage | undefined;
  try {
    storage = (scope as Record<string, unknown>)[name] as Storage | undefined;
  } catch {
    // The opaque-origin case: the getter itself throws.
    return 'broken';
  }

  if (storage === undefined || storage === null) return 'absent';
  if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return 'broken';
  }

  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return 'usable';
  } catch {
    return 'broken';
  }
}

/**
 * Replace any present-but-unusable `localStorage`/`sessionStorage` on `scope`
 * with an in-memory `Storage`, so third-party code that touches it unguarded
 * cannot throw.
 *
 * - **No-op where storage works.** A healthy `Storage` is never replaced, and
 *   its contents are never touched.
 * - **No-op where storage is absent** (Node/SSR/workers). Nothing is invented.
 * - **Idempotent.** Once the fallback is installed the round-trip probe
 *   succeeds, so a second call is a no-op and values already written survive.
 *
 * This module installs on import, so most apps never need to call it. Call it
 * explicitly when you want the guarantee at a specific moment — e.g. right
 * before `await import('some-lib')` that reads storage while evaluating.
 *
 * @param scope Object carrying the storage globals. Defaults to `globalThis`.
 */
export function installSafeStorage(scope: object = globalThis): SafeStorageInstallResult {
  const result: SafeStorageInstallResult = { localStorage: false, sessionStorage: false };

  for (const name of STORAGE_NAMES) {
    if (probe(scope, name) !== 'broken') continue;
    try {
      Object.defineProperty(scope, name, {
        value: createMemoryStorage(),
        configurable: true,
        writable: false,
        enumerable: false,
      });
      result[name] = true;
    } catch {
      // Non-configurable in this engine — nothing more we can do. Swallowing
      // keeps a best-effort shim from becoming its own boot failure.
    }
  }

  return result;
}

// Install on import.
//
// Import order is the whole game: ES module imports are hoisted, so a
// *statement* can never run before a sibling `import` of a dependency that
// reads storage while evaluating. Only an import side effect can, which is why
// this is not opt-in — `@civitai/app-sdk/blocks` and `@civitai/blocks-react`
// import this module first, and an app can put
// `import '@civitai/app-sdk/safe-storage';` at the very top of its entry to be
// ahead of everything.
//
// The blast radius is bounded by the rules above: it only ever replaces a
// global that is already *provably* unusable, so in every healthy runtime this
// is a couple of `setItem`/`removeItem` calls and nothing else.
installSafeStorage();
