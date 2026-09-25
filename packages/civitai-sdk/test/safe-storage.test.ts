/**
 * What this file does NOT contain, and why.
 *
 * `src/safe-storage/index.ts` is a deliberate independent COPY of
 * `@civitai/app-sdk`'s module — comment-stripped, the two bodies are 139 lines
 * each and byte-identical. Its behaviour is therefore already pinned twice:
 *
 *   - `packages/civitai-app-sdk/test/safe-storage.test.ts` — the full unit
 *     suite over the same 139 lines (the Proxy semantics, the probe, the
 *     seeding, the hostile-object cases).
 *   - `packages/civitai-blocks-react/test/safe-storage-sandbox.browser.test.ts`
 *     — the same shim in a REAL `<iframe sandbox="allow-scripts">` against the
 *     shipped artifact, in a required CI job.
 *
 * A third copy of those cases here would re-measure a byte-identical body and
 * report it as coverage. What was genuinely unchecked is that the two copies
 * STAY identical, and that is now
 * `tests/guards/safe-storage-copy-parity.test.mjs` (`pnpm test:guards`) — a
 * mechanical replacement for the docblock line that used to ask a human to
 * "check the other".
 *
 * So this file keeps only what is specific to THIS package: the wiring that
 * makes the copy reachable from `@civitai/sdk`, plus the negative control that
 * keeps the harness honest.
 */
import { existsSync, readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The exact message a browser produces when a document sandboxed without
 * `allow-same-origin` touches web storage.
 */
const SECURITY_ERROR_MESSAGE =
  "Failed to read the 'localStorage' property from 'Window': The document is " +
  "sandboxed and lacks the 'allow-same-origin' flag.";

/**
 * Break `globalThis.localStorage` exactly as an opaque origin does, with a
 * restore function.
 *
 * The descriptor is spelled out in full on purpose. `Object.defineProperty`
 * *merges* into an existing configurable property, and Node >= 22 already
 * defines `globalThis.localStorage` as a non-enumerable accessor **with a
 * setter** — so a `{ get }`-only redefinition would silently inherit Node's
 * `set` and `enumerable: false` and no longer look like a browser at all.
 * A real `Window.localStorage` is a WebIDL *readonly* attribute: enumerable,
 * with no setter.
 */
function breakGlobalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    set: undefined,
    get() {
      throw new DOMException(SECURITY_ERROR_MESSAGE, 'SecurityError');
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as Record<string, unknown>).localStorage;
  };
}

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length) restores.pop()?.();
  vi.resetModules();
});

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { sideEffects: unknown; exports: Record<string, unknown> };

describe('opaque-origin storage repair: the wiring @civitai/sdk owns', () => {
  const FIXTURE = './fixtures/reads-storage-on-import.js';

  it('NEGATIVE CONTROL: an unrepaired opaque origin kills the dependency at import', async () => {
    restores.push(breakGlobalStorage());
    vi.resetModules();

    // Without this, every green below is indistinguishable from a harness that
    // has lost its ability to see the throw at all. Nothing outside the
    // dependency can guard it — it throws while the module body evaluates,
    // before any app code runs.
    await expect(import(FIXTURE)).rejects.toThrow(/allow-same-origin/);
  });

  it('importing @civitai/sdk/safe-storage first lets that dependency load', async () => {
    restores.push(breakGlobalStorage());
    vi.resetModules();

    // The only ordering that works: a side-effect IMPORT, not a call — module
    // imports are hoisted above every statement. This is the line the README
    // tells a block author to put first in their entry module.
    await import('../src/safe-storage/index.js');
    const mod = await import(FIXTURE);

    expect(mod.state.touchEnabled).toBe(false);
    // Its unguarded bracket write landed in the fallback, stringified.
    expect(globalThis.localStorage.getItem(mod.state.key)).toBe('true');
  });

  // 🔴 REGRESSION #1. The test above imports a RELATIVE path, which says nothing
  // about whether a consumer can reach the module at all: `exports` is a closed
  // allowlist, so a subpath missing from it is `ERR_PACKAGE_PATH_NOT_EXPORTED`
  // for every consumer no matter what `dist/` contains. Pinned as the whole
  // normalised entry — a mapping that forgets `types`, or points at a path the
  // build does not emit, fails.
  it('REGRESSION: package.json exports ./safe-storage as a public subpath', () => {
    expect(manifest.exports['./safe-storage']).toEqual({
      types: './dist/safe-storage/index.d.ts',
      import: './dist/safe-storage/index.js',
    });

    // …and the source that compiles to that path exists, so the mapping is not
    // pointing at a file the build will never produce.
    expect(existsSync(new URL('../src/safe-storage/index.ts', import.meta.url))).toBe(true);
  });

  // 🔴 REGRESSION #2. The behavioural test above passes in vitest whatever
  // `package.json` says — vitest does not tree-shake. A bundler does, and
  // `sideEffects: false` is a standing promise to EVERY bundler that a module
  // whose exports go unused can be dropped. `import '@civitai/sdk/safe-storage'`
  // uses no exports at all, so under `false` it is exactly the import a bundler
  // is licensed to delete. Pinned as the whole normalised array: a reordered
  // but complete allowlist passes, and a return to `false` — or an allowlist
  // that forgets this module — fails.
  //
  // `./dist/index.js` is deliberately NOT in the allowlist. The package root is
  // pure re-exports and installs nothing, so listing it would suppress
  // tree-shaking of the entry for no side effect to protect.
  it('REGRESSION: package.json declares the sideEffects allowlist, never `false`', () => {
    const declared = manifest.sideEffects;
    // Normalised, not destructured: a regression to `false` must fail as a
    // value mismatch, not as a TypeError from spreading a boolean.
    expect(Array.isArray(declared) ? [...declared].sort() : declared).toEqual([
      './dist/safe-storage/index.js',
    ]);
  });
});
