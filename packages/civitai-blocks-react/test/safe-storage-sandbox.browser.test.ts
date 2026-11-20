/**
 * REAL-BROWSER verification of `@civitai/app-sdk/safe-storage`, inside a
 * genuinely sandboxed (`allow-scripts allow-forms`, NO `allow-same-origin`)
 * iframe — i.e. the exact opaque-origin environment a Civitai App block runs in.
 *
 * WHY THIS FILE EXISTS: the shim's unit suite (app-sdk `test/safe-storage.test.ts`)
 * *emulates* the sandbox with hand-built throwing getters. That proves the shim's
 * logic given a set of assumptions about the platform, but it cannot prove the
 * assumptions themselves — and the shim auto-installs on import, so it ships to
 * EVERY block via npm. Four platform claims are load-bearing, and until this file
 * none of them had been observed in a real browser:
 *
 *   A1. `typeof localStorage` ITSELF throws at an opaque origin, so the
 *       conventional `typeof localStorage === 'undefined'` guard does not protect.
 *   A2. `'localStorage' in window` is nevertheless `true` there — which is why the
 *       existence pre-check must classify the sandbox `broken`, never `absent`.
 *   A3. `Window.localStorage` is a WebIDL *readonly* attribute: an own accessor
 *       that is `enumerable: true` with `set === undefined`. This shape is the
 *       whole basis of `isNodeWebStorageStub()`, which skips the install when the
 *       property is a non-enumerable accessor WITH a setter (Node >= 22's lazy
 *       stub). If a real browser matched that shape, the shim would SILENTLY NOT
 *       INSTALL in production — the worst failure mode in the module.
 *   A4. Real `Storage` shrugs off `Object.freeze` / `Object.preventExtensions`
 *       (they throw; the object keeps working and stays enumerable) — the
 *       behaviour `createMemoryStorage()`'s `preventExtensions: () => false` trap
 *       imitates.
 *   A5. After install, storage actually WORKS across the surface libraries use:
 *       `setItem`/`getItem`, `'k' in storage`, `storage['k']`, `length`, `key()`.
 *
 * Plus a NEGATIVE CONTROL: the same sandboxed page WITHOUT the shim must still
 * reproduce the production failure (an unguarded module-scope storage read throws
 * `SecurityError`). Without it, a green suite here would prove nothing.
 *
 * HOW: three sandboxed `srcdoc` iframes, each reporting back over `postMessage`
 * (the only channel an opaque origin has). The iframes run the SHIPPED BUILD —
 * `packages/civitai-app-sdk/dist/safe-storage/index.js`, imported here as raw text
 * and injected as an inline `<script type="module">` — because a cross-origin
 * module fetch is not available to an opaque origin, and because the built file is
 * what npm actually delivers to blocks. The ONLY edit made to those bytes is an
 * appended `window.__installSafeStorage = installSafeStorage;` line, so the
 * idempotency check can call it a second time.
 *
 * The third iframe is the direct test of A3's failure mode: it defines a fake
 * `process.versions.node` before loading the shim, which makes
 * `isNodeWebStorageStub()`'s runtime gate pass so the DESCRIPTOR check alone
 * decides. If a real browser's `Window.localStorage` descriptor looked like Node's
 * stub, that iframe would end up with NO shim and broken storage. (This is not a
 * hypothetical: block bundlers routinely inject a `process` shim.)
 */
import { beforeAll, describe, expect, it } from 'vitest';

// Raw text of the SHIPPED build. CI builds @civitai/app-sdk before running this
// package's browser project (see .github/workflows/ci.yml); locally, run
// `pnpm --filter @civitai/app-sdk build` first.
// eslint-disable-next-line import/no-unresolved
import shimBuildSource from '../../civitai-app-sdk/dist/safe-storage/index.js?raw';

/* ------------------------------------------------------------------ helpers */

interface Descriptor {
  foundOn: string;
  isAccessor: boolean;
  getType: string;
  setType: string;
  setIsUndefined: boolean | null;
  enumerable: boolean | null;
  configurable: boolean | null;
  isDataProperty: boolean;
  /** Mirrors `isNodeWebStorageStub()`'s descriptor half in the shipped shim. */
  matchesNodeStubShape: boolean;
}

interface Measurement {
  typeofThrew: boolean;
  typeofValue?: string;
  typeofErrorName?: string;
  typeofErrorMessage?: string;
  conventionalGuardThrew: boolean;
  conventionalGuardValue?: boolean;
  inWindow: boolean;
  inWindowSession: boolean;
  localStorageDescriptor: Descriptor;
  sessionStorageDescriptor: Descriptor;
  hasProcess: boolean;
}

interface Surface {
  ok: boolean;
  errorName?: string;
  getItem?: string | null;
  inOperator?: boolean;
  indexAccess?: string;
  lengthAfterOne?: number;
  getItemBeta?: string | null;
  lengthAfterTwo?: number;
  key0?: string | null;
  key1?: string | null;
  keyOutOfRange?: string | null;
  objectKeys?: string[];
  missing?: string | null;
  lengthAfterDelete?: number;
  betaAfterDelete?: string | null;
  sessionRoundTrip?: string | null;
}

interface FreezeBehaviour {
  preventExtensionsThrew: boolean;
  preventExtensionsError?: string;
  isExtensible?: boolean;
  freezeThrew: boolean;
  freezeError?: string;
  usable: boolean;
  afterFreezeGet?: string | null;
  afterFreezeKeys?: string[];
  errorName?: string;
}

interface SandboxReport {
  token: string;
  uncaught: Array<{ name: string | null; message: string }>;
  pre: Measurement;
  post: Measurement;
  surface: Surface;
  freeze: FreezeBehaviour;
  secondInstall?: { localStorage: boolean; sessionStorage: boolean };
  afterSecondInstall?: string | null;
  shimCallable: boolean;
}

/**
 * Measurement + exercise code, shared verbatim by every iframe so the control and
 * the shimmed pages differ ONLY by whether the shim ran. Injected as a classic
 * script (it must run during parse, i.e. before the deferred module scripts).
 */
const HARNESS_SCRIPT = `
window.__describe = function (scope, name) {
  var own = Object.getOwnPropertyDescriptor(scope, name);
  var proto = null;
  var protoName = null;
  var walk = Object.getPrototypeOf(scope);
  while (walk && !proto) {
    var found = Object.getOwnPropertyDescriptor(walk, name);
    if (found) {
      proto = found;
      protoName = walk.constructor ? walk.constructor.name : 'anonymous';
    }
    walk = Object.getPrototypeOf(walk);
  }
  var d = own || proto;
  return {
    foundOn: own ? 'own' : (proto ? 'prototype:' + protoName : 'nowhere'),
    isAccessor: !!d && typeof d.get === 'function',
    getType: d ? typeof d.get : 'none',
    setType: d ? typeof d.set : 'none',
    setIsUndefined: d ? d.set === undefined : null,
    enumerable: d ? d.enumerable : null,
    configurable: d ? d.configurable : null,
    isDataProperty: !!d && Object.prototype.hasOwnProperty.call(d, 'value'),
    // The descriptor half of isNodeWebStorageStub() in the shipped shim:
    // own accessor + setter + non-enumerable => "Node's disabled stub, skip".
    matchesNodeStubShape:
      !!own && typeof own.get === 'function' && typeof own.set === 'function' && own.enumerable === false
  };
};

window.__measure = function () {
  var out = {};
  try {
    out.typeofValue = typeof localStorage;
    out.typeofThrew = false;
  } catch (error) {
    out.typeofThrew = true;
    out.typeofErrorName = error && error.name ? error.name : null;
    out.typeofErrorMessage = String(error && error.message);
  }
  // The conventional guard, evaluated exactly as app code would write it.
  try {
    out.conventionalGuardValue = typeof localStorage === 'undefined';
    out.conventionalGuardThrew = false;
  } catch (error) {
    out.conventionalGuardThrew = true;
  }
  out.inWindow = 'localStorage' in window;
  out.inWindowSession = 'sessionStorage' in window;
  out.localStorageDescriptor = window.__describe(window, 'localStorage');
  out.sessionStorageDescriptor = window.__describe(window, 'sessionStorage');
  out.hasProcess = typeof window.process !== 'undefined';
  return out;
};

window.__exerciseSurface = function () {
  var s = { ok: false };
  try {
    localStorage.setItem('alpha', 'one');
    s.getItem = localStorage.getItem('alpha');
    s.inOperator = 'alpha' in localStorage;
    s.indexAccess = localStorage['alpha'];
    s.lengthAfterOne = localStorage.length;
    localStorage['beta'] = 'two';
    s.getItemBeta = localStorage.getItem('beta');
    s.lengthAfterTwo = localStorage.length;
    s.key0 = localStorage.key(0);
    s.key1 = localStorage.key(1);
    s.keyOutOfRange = localStorage.key(9);
    s.objectKeys = Object.keys(localStorage);
    s.missing = localStorage.getItem('nope');
    delete localStorage['beta'];
    s.lengthAfterDelete = localStorage.length;
    s.betaAfterDelete = localStorage.getItem('beta');
    sessionStorage.setItem('sAlpha', 'sOne');
    s.sessionRoundTrip = sessionStorage.getItem('sAlpha');
    s.ok = true;
  } catch (error) {
    s.ok = false;
    s.errorName = error && error.name ? error.name : null;
  }
  return s;
};

window.__exerciseFreeze = function () {
  var r = { preventExtensionsThrew: false, freezeThrew: false, usable: false };
  try {
    Object.preventExtensions(localStorage);
  } catch (error) {
    r.preventExtensionsThrew = true;
    r.preventExtensionsError = error && error.name ? error.name : null;
  }
  try {
    r.isExtensible = Object.isExtensible(localStorage);
  } catch (error) {
    r.isExtensible = null;
  }
  try {
    Object.freeze(localStorage);
  } catch (error) {
    r.freezeThrew = true;
    r.freezeError = error && error.name ? error.name : null;
  }
  try {
    localStorage.setItem('gamma', 'three');
    r.afterFreezeGet = localStorage.getItem('gamma');
    r.afterFreezeKeys = Object.keys(localStorage);
    r.usable = true;
  } catch (error) {
    r.usable = false;
    r.errorName = error && error.name ? error.name : null;
  }
  return r;
};
`;

/** The unguarded module-scope storage read a third-party dependency performs. */
const UNGUARDED_IMPORT_TIME_READ = `
// Deliberately unguarded, at module scope — this is the shape of the real
// production failure (Photo Sphere Viewer's \`TOUCH_KEY in localStorage\` probe).
const touched = 'psv_touch' in localStorage;
window.__report.unguardedReadResult = touched;
`;

interface SandboxOptions {
  /** Inject the shipped shim build ahead of the unguarded read. */
  installShim: boolean;
  /** Define a fake `process.versions.node` before the shim runs. */
  fakeNodeProcess?: boolean;
}

let sandboxSeq = 0;

/**
 * Load a genuinely sandboxed (opaque-origin) iframe and resolve its report.
 *
 * Script order inside the document is load-bearing:
 *   1. classic: error listener + report object   (runs during parse)
 *   2. classic: optional fake `process`          (runs during parse)
 *   3. classic: harness                          (runs during parse)
 *   4. classic: PRE-install measurement          (runs during parse)
 *   5. module:  the shipped shim (optional)      (deferred, in order)
 *   6. module:  unguarded import-time read       (deferred, in order)
 *   7. module:  POST measurement + postMessage   (deferred, in order)
 */
function loadSandbox(options: SandboxOptions): Promise<SandboxReport> {
  sandboxSeq += 1;
  const token = `safe-storage-probe-${sandboxSeq}`;

  const html = [
    '<!doctype html><meta charset="utf-8">',
    `<script>
      window.__report = { token: ${JSON.stringify(token)}, uncaught: [] };
      window.addEventListener('error', function (event) {
        window.__report.uncaught.push({
          name: event.error && event.error.name ? event.error.name : null,
          message: String((event.error && event.error.message) || event.message)
        });
      });
    </script>`,
    options.fakeNodeProcess
      ? `<script>
          // What a bundler's Node-shim looks like to isNodeWebStorageStub()'s
          // FIRST gate. With this present the gate passes, so the descriptor
          // check alone decides whether the shim installs.
          window.process = { versions: { node: '22.11.0' } };
        </script>`
      : '',
    `<script>${HARNESS_SCRIPT}</script>`,
    `<script>window.__report.pre = window.__measure();</script>`,
    options.installShim
      ? `<script type="module">
          ${shimBuildSource}
          window.__installSafeStorage = installSafeStorage;
        </script>`
      : '',
    `<script type="module">${UNGUARDED_IMPORT_TIME_READ}</script>`,
    `<script type="module">
      window.__report.shimCallable = typeof window.__installSafeStorage === 'function';
      window.__report.post = window.__measure();
      window.__report.surface = window.__exerciseSurface();
      if (window.__report.shimCallable) {
        window.__report.secondInstall = window.__installSafeStorage();
        try {
          window.__report.afterSecondInstall = localStorage.getItem('alpha');
        } catch (error) {
          window.__report.afterSecondInstall = 'THREW:' + (error && error.name);
        }
      }
      window.__report.freeze = window.__exerciseFreeze();
      parent.postMessage(window.__report, '*');
    </script>`,
  ].join('\n');

  return new Promise<SandboxReport>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    // The production sandbox, verbatim: NO allow-same-origin => opaque origin.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    iframe.style.cssText = 'position:absolute;left:-9999px;width:200px;height:200px';

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`sandbox "${token}" never reported back (10s)`));
    }, 10_000);

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    }

    function onMessage(event: MessageEvent) {
      const data = event.data as SandboxReport | undefined;
      if (!data || data.token !== token) return;
      cleanup();
      resolve(data);
    }

    window.addEventListener('message', onMessage);
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

/* ------------------------------------------------------------------- suites */

let control: SandboxReport;
let shimmed: SandboxReport;
let shimmedWithFakeNode: SandboxReport;

beforeAll(async () => {
  // Guard against a stale/absent app-sdk build silently turning this suite into
  // a no-op that "passes".
  expect(shimBuildSource, 'app-sdk dist is missing — run `pnpm --filter @civitai/app-sdk build`').toContain(
    'function installSafeStorage',
  );
  expect(shimBuildSource).toContain('isNodeWebStorageStub');
  expect(shimBuildSource).toContain('preventExtensions');

  [control, shimmed, shimmedWithFakeNode] = await Promise.all([
    loadSandbox({ installShim: false }),
    loadSandbox({ installShim: true }),
    loadSandbox({ installShim: true, fakeNodeProcess: true }),
  ]);
}, 40_000);

describe('opaque-origin sandbox: the platform assumptions the shim rests on', () => {
  it('A1: `typeof localStorage` itself throws — the conventional guard does NOT protect', () => {
    expect(control.pre.typeofThrew).toBe(true);
    expect(control.pre.typeofErrorName).toBe('SecurityError');
    expect(control.pre.typeofErrorMessage).toMatch(/sandbox/i);

    // The whole point: `typeof localStorage === 'undefined'` is not a guard here
    // — evaluating the guard is itself the crash. It never yields a boolean.
    expect(control.pre.conventionalGuardThrew).toBe(true);
    expect(control.pre.conventionalGuardValue).toBeUndefined();
  });

  it('A2: `\'localStorage\' in window` is true — the sandbox is broken, not absent', () => {
    expect(control.pre.inWindow).toBe(true);
    expect(control.pre.inWindowSession).toBe(true);
  });

  it('A3: `Window.localStorage` is an own, ENUMERABLE accessor with `set === undefined`', () => {
    const descriptor = control.pre.localStorageDescriptor;

    expect(descriptor.foundOn).toBe('own');
    expect(descriptor.isAccessor).toBe(true);
    expect(descriptor.getType).toBe('function');
    expect(descriptor.setIsUndefined).toBe(true);
    expect(descriptor.setType).toBe('undefined');
    expect(descriptor.enumerable).toBe(true);
    expect(descriptor.configurable).toBe(true);
    expect(descriptor.isDataProperty).toBe(false);

    // Same for sessionStorage — both are WebIDL readonly attributes.
    expect(control.pre.sessionStorageDescriptor.setIsUndefined).toBe(true);
    expect(control.pre.sessionStorageDescriptor.enumerable).toBe(true);
  });

  it('A3: the real descriptor does NOT match `isNodeWebStorageStub()`\'s Node-stub shape', () => {
    expect(control.pre.localStorageDescriptor.matchesNodeStubShape).toBe(false);
    expect(control.pre.sessionStorageDescriptor.matchesNodeStubShape).toBe(false);
  });

  it('A3: the shim installs even when a bundler has shimmed `process` — so only the descriptor decides', () => {
    // Gate 1 (are we on Node?) passes here. If the browser descriptor matched
    // Node's stub, gate 2 would classify the sandbox `absent` and the shim would
    // silently NOT install — production blocks would still crash.
    expect(shimmedWithFakeNode.pre.hasProcess).toBe(true);
    expect(shimmedWithFakeNode.pre.typeofThrew).toBe(true);
    expect(shimmedWithFakeNode.post.typeofThrew).toBe(false);
    expect(shimmedWithFakeNode.post.localStorageDescriptor.isDataProperty).toBe(true);
    expect(shimmedWithFakeNode.surface.ok).toBe(true);
    expect(shimmedWithFakeNode.surface.getItem).toBe('one');
    expect(shimmedWithFakeNode.uncaught).toEqual([]);

    // And confirm the plain sandbox has NO `process`, so the run above is the
    // only one that actually exercises the descriptor gate.
    expect(control.pre.hasProcess).toBe(false);
  });

  it('A4: real `Storage` survives freeze/preventExtensions (they throw, it keeps working)', () => {
    // Measured on the TOP-LEVEL page's genuine `Storage` — the sandbox has none.
    const probeKey = '__civitai_safe_storage_browser_probe__';
    try {
      expect(() => Object.preventExtensions(localStorage)).toThrow(TypeError);
      expect(Object.isExtensible(localStorage)).toBe(true);
      expect(() => Object.freeze(localStorage)).toThrow(TypeError);

      localStorage.setItem(probeKey, 'still-alive');
      expect(localStorage.getItem(probeKey)).toBe('still-alive');
      expect(Object.keys(localStorage)).toContain(probeKey);
      expect(localStorage.length).toBeGreaterThan(0);
    } finally {
      localStorage.removeItem(probeKey);
    }
  });

  it('A4: the installed shim reproduces that behaviour (the `preventExtensions` trap)', () => {
    expect(shimmed.freeze.preventExtensionsThrew).toBe(true);
    expect(shimmed.freeze.preventExtensionsError).toBe('TypeError');
    expect(shimmed.freeze.isExtensible).toBe(true);
    expect(shimmed.freeze.freezeThrew).toBe(true);
    expect(shimmed.freeze.freezeError).toBe('TypeError');
    expect(shimmed.freeze.usable).toBe(true);
    expect(shimmed.freeze.afterFreezeGet).toBe('three');
    // Enumeration still works — the trap's reason for existing.
    expect(shimmed.freeze.afterFreezeKeys).toContain('gamma');
  });

  it('A5: after install the sandbox has working storage across the full surface', () => {
    expect(shimmed.post.typeofThrew).toBe(false);
    expect(shimmed.post.typeofValue).toBe('object');

    // Replaced by the shim's data property, not the platform accessor.
    const descriptor = shimmed.post.localStorageDescriptor;
    expect(descriptor.foundOn).toBe('own');
    expect(descriptor.isDataProperty).toBe(true);
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(true);

    const surface = shimmed.surface;
    expect(surface.ok).toBe(true);
    expect(surface.getItem).toBe('one');
    expect(surface.inOperator).toBe(true);
    expect(surface.indexAccess).toBe('one');
    expect(surface.lengthAfterOne).toBe(1);
    expect(surface.getItemBeta).toBe('two'); // index WRITE aliases setItem
    expect(surface.lengthAfterTwo).toBe(2);
    expect(surface.key0).toBe('alpha');
    expect(surface.key1).toBe('beta');
    expect(surface.keyOutOfRange).toBeNull();
    expect(surface.objectKeys).toEqual(['alpha', 'beta']);
    expect(surface.missing).toBeNull();
    expect(surface.lengthAfterDelete).toBe(1); // index DELETE aliases removeItem
    expect(surface.betaAfterDelete).toBeNull();
    expect(surface.sessionRoundTrip).toBe('sOne'); // sessionStorage repaired too
  });

  it('A5: a second install is a no-op that preserves already-written values', () => {
    expect(shimmed.shimCallable).toBe(true);
    expect(shimmed.secondInstall).toEqual({ localStorage: false, sessionStorage: false });
    expect(shimmed.afterSecondInstall).toBe('one');
  });

  it('A5: the unguarded import-time read that crashes production runs clean with the shim', () => {
    expect(shimmed.uncaught).toEqual([]);
  });
});

describe('NEGATIVE CONTROL — the same sandbox WITHOUT the shim still fails', () => {
  it('an unguarded module-scope storage read throws SecurityError', () => {
    expect(control.uncaught).toHaveLength(1);
    expect(control.uncaught[0]?.name).toBe('SecurityError');
    expect(control.uncaught[0]?.message).toMatch(/sandbox/i);
  });

  it('storage stays unusable end to end (no shim installed)', () => {
    expect(control.shimCallable).toBe(false);
    expect(control.post.typeofThrew).toBe(true);
    expect(control.post.localStorageDescriptor.isDataProperty).toBe(false);
    expect(control.surface.ok).toBe(false);
    expect(control.surface.errorName).toBe('SecurityError');
    expect(control.freeze.usable).toBe(false);
  });
});
