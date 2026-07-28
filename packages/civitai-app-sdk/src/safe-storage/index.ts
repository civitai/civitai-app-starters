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
    deleteProperty(_target, prop) {
      // `delete storage.getItem` must NOT destroy the method, and
      // `delete storage.length` must NOT leave `length` undefined — a
      // `for (i < storage.length)` loop would then silently iterate zero
      // times. Real `Storage` is unbothered: its API lives on
      // `Storage.prototype`, so deleting it from the instance finds no own
      // property, reports success and changes nothing. Mirror that exactly.
      if (isApiKey(prop)) return true;
      map.delete(prop as string);
      return true;
    },
    // Enumeration sees only stored keys — matching real Storage, where
    // `Object.keys(localStorage)` lists the entries, not the methods.
    ownKeys() {
      return Array.from(map.keys());
    },
    // A non-extensible target would make the `ownKeys` trap above violate a
    // proxy invariant (it must then report every own key of the target), so a
    // single `Object.freeze(localStorage)` — from a SES/`harden()` lockdown
    // sweep, say — would make `Object.keys` / spread / `JSON.stringify` /
    // `for...in` throw on this object FOREVER. Refusing keeps enumeration
    // alive and matches the platform: `Storage` is a legacy platform object
    // with a named-property handler, whose `[[PreventExtensions]]` also
    // returns false.
    preventExtensions: () => false,
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

interface ProbeResult {
  health: Health;
  /**
   * Whatever `scope[name]` read back as, when reading it succeeded at all.
   * Carried out of the probe so the caller never has to invoke the getter a
   * second time — it can be arbitrary user code with arbitrary side effects.
   */
  storage?: Storage;
}

/**
 * Is `scope[name]` Node's *disabled* web-storage stub?
 *
 * Node >= 22 defines `globalThis.localStorage` / `sessionStorage` as lazy
 * accessors. Without `--localstorage-file` they return `undefined` **and emit
 * `ExperimentalWarning: localStorage is not available because
 * --localstorage-file was not provided.` on every read** — so importing this
 * module would print that on every server boot and in CI. `in` does not trip
 * the warning, but it does report `true` there, so existence alone is not
 * enough to skip the read.
 *
 * Both signals must agree, and anything ambiguous falls through to a real
 * probe:
 *
 * 1. we are running on Node;
 * 2. the property is an **own, non-enumerable accessor with a setter** —
 *    Node's replaceable global. The web platform can never match this:
 *    `Window.localStorage` is a WebIDL *readonly* attribute, so it is
 *    `enumerable: true` with `set: undefined`, in a sandbox exactly as much as
 *    anywhere else. That is a spec guarantee, not a guess, and it is why the
 *    check does not also test for `window` — happy-dom-style test
 *    environments expose a `window` while `globalThis.localStorage` is still
 *    Node's stub underneath.
 *
 * Skipping costs nothing either way. Without `--localstorage-file` the read
 * would have returned `undefined` → `absent`, which is what we return; *with*
 * it the storage works → `usable`, which is also a no-op.
 */
function isNodeWebStorageStub(scope: object, name: SafeStorageName): boolean {
  const runtime = globalThis as { process?: { versions?: { node?: unknown } } };
  if (typeof runtime.process?.versions?.node !== 'string') return false;

  const descriptor = Object.getOwnPropertyDescriptor(scope, name);
  return (
    descriptor !== undefined &&
    typeof descriptor.get === 'function' &&
    typeof descriptor.set === 'function' &&
    descriptor.enumerable === false
  );
}

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
 *
 * **Never throws.** `installSafeStorage()` runs at module scope, so an escaping
 * error would reject `import '@civitai/app-sdk/blocks'` outright and take down
 * every block that imports it — a worse failure than the one being fixed.
 */
function probe(scope: object, name: SafeStorageName): ProbeResult {
  // `in` is the only safe existence check, and it has to come first.
  //
  // It runs [[HasProperty]], which does NOT invoke the getter — on an ordinary
  // object (`globalThis` included) it runs no user code at all, so it cannot
  // throw and cannot trip Node's stub (above).
  //
  // The conventional `typeof localStorage === 'undefined'` guard is NOT a
  // substitute: inside a real opaque-origin sandbox `typeof localStorage`
  // ALSO throws, because `typeof` on a member/global reference still resolves
  // the property and runs the throwing getter — only `typeof` of an
  // *undeclared identifier* is safe, and this identifier is declared.
  // `'localStorage' in window` is the probe that survives there, and it
  // correctly answers `true`: in the sandbox the global exists, it is merely
  // unreadable. So the sandbox is classified `broken` below, never `absent`.
  if (!(name in scope)) return { health: 'absent' };
  if (isNodeWebStorageStub(scope, name)) return { health: 'absent' };

  let storage: Storage | undefined;
  try {
    storage = (scope as Record<string, unknown>)[name] as Storage | undefined;
  } catch {
    // The opaque-origin case: the getter itself throws.
    return { health: 'broken' };
  }

  if (storage === undefined || storage === null) return { health: 'absent' };

  // Everything below TOUCHES the object we were handed, and every one of those
  // touches can throw — a revoked `Proxy` answers even a plain property read
  // with a TypeError, and any exotic object can have a throwing getter. So the
  // shape check lives inside the `try` alongside the round-trip probe rather
  // than in front of it.
  //
  // A property read that throws is classified `broken`, not `usable`: every
  // consumer's `localStorage.getItem(...)` would throw exactly the same way, so
  // the global is unusable by definition — the same conclusion the throwing
  // *getter* above already reaches. Leaving it in place would keep a provably
  // lethal global on the page; replacing it cannot produce a false positive,
  // because a healthy `Storage` never throws on method access.
  try {
    if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return { health: 'broken', storage };
    }
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return { health: 'usable', storage };
  } catch {
    return { health: 'broken', storage };
  }
}

/**
 * Copy whatever `existing` still holds into `into`, best-effort.
 *
 * The write probe fails for two very different reasons. At an opaque origin
 * there is nothing to read and nothing to preserve. But a *full* (or
 * write-disabled) storage on an ordinary origin — historically the
 * Safari-private-mode shape, and the likeliest real-world trigger — reads
 * perfectly well: swapping a bare in-memory `Storage` over it would shadow
 * live data, turning "can't save" into "the session is gone". So the fallback
 * inherits the current entries first.
 *
 * Values written *after* the swap are session-scoped and lost on reload, the
 * same as every other install path — the fallback never claims to persist.
 *
 * Reading the old store is itself unguarded territory (revoked proxies,
 * throwing getters, an object that is not `Storage`-shaped at all), so the
 * whole copy is best-effort: an empty fallback still beats a global that
 * throws.
 */
function seedFrom(existing: Storage, into: Storage): void {
  try {
    const size = existing.length;
    if (typeof size !== 'number' || typeof existing.key !== 'function') return;
    if (typeof existing.getItem !== 'function') return;

    for (let index = 0; index < size; index += 1) {
      const key = existing.key(index);
      if (key === null || key === undefined || key === PROBE_KEY) continue;
      const value = existing.getItem(key);
      if (value !== null && value !== undefined) into.setItem(key, value);
    }
  } catch {
    // Unreadable after all. Nothing to inherit; carry on with an empty store.
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
 * - **Never loses readable data.** When the old store reads but refuses writes
 *   (full / disabled), its entries are copied into the fallback first, so the
 *   shim cannot shadow a live session.
 * - **Idempotent.** Once the fallback is installed the round-trip probe
 *   succeeds, so a second call is a no-op and values already written survive.
 * - **Never throws.** Every step is guarded; a shim that could fail at import
 *   would be a worse outage than the bug it fixes.
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
    const { health, storage } = probe(scope, name);
    if (health !== 'broken') continue;

    // Inherit anything the old store still holds, so a storage that reads
    // fine but refuses writes (full / disabled) does not lose its data behind
    // the shim. Skipped at an opaque origin, where the read itself threw and
    // there is nothing to inherit.
    const fallback = createMemoryStorage();
    if (storage) seedFrom(storage, fallback);

    try {
      Object.defineProperty(scope, name, {
        value: fallback,
        // `configurable: true` on purpose — a consumer (or a second call) can
        // still swap in its own store via `Object.defineProperty`.
        configurable: true,
        // `writable: false` matches the browser: `window.localStorage = x` is
        // a no-op in sloppy mode and a TypeError in strict mode on the real
        // thing, sandboxed or not. A writable shim would quietly accept that
        // assignment and hand blocks a *different* behaviour from production.
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
