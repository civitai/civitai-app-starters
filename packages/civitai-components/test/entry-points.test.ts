/**
 * The `.` entry is what the Svelte starters import for `injectStyles()`. Lit
 * reaching it would put a renderer in every non-element consumer's bundle.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import pkg from '../package.json' with { type: 'json' };

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Both `import x from 'y'` / `export … from 'y'` AND a bare `import 'y'`, which
// is how a register entry pulls its side effect in.
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s*(?:[^'"]*from\s*)?['"]([^'"]+)['"]/g;

/** Every specifier reachable from an entry, following relative imports only. */
function reachableSpecifiers(entry: string): Set<string> {
  const seen = new Set<string>();
  const external = new Set<string>();
  const queue = [resolve(pkgRoot, entry)];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(IMPORT_RE)) {
      if (specifier!.startsWith('.')) queue.push(resolve(dirname(file), specifier!));
      else external.add(specifier!);
    }
  }
  return external;
}

/** Every file reachable from an entry, following relative imports only. */
function reachableFiles(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(pkgRoot, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      if (specifier!.startsWith('.')) queue.push(resolve(dirname(file), specifier!));
    }
  }
  return [...seen];
}

describe('entry points', () => {
  it('the `.` entry pulls no renderer', () => {
    const external = reachableSpecifiers('dist/index.js');
    expect([...external]).toEqual(['@civitai/theme']);
  });

  it('the elements entry is where lit enters, and nothing else does', () => {
    const external = [...reachableSpecifiers('dist/elements/register.js')].sort();
    expect(external.some((s) => s === 'lit' || s.startsWith('lit/'))).toBe(true);
    // A whitelist, not a denylist: a new dependency has to be declared here on
    // purpose, which is what keeps an external OAuth app's bundle honest.
    const allowed = new Set([
      '@civitai/theme',
      'lit',
      'lit/directives/if-defined.js',
      'lit/directives/style-map.js',
    ]);
    expect(external.filter((s) => !allowed.has(s))).toEqual([]);
  });

  it('the site entry adds only what its own elements need', () => {
    const external = [...reachableSpecifiers('dist/elements/register-site.js')].sort();
    const allowed = new Set([
      '@civitai/theme',
      'lit',
      'lit/directives/if-defined.js',
      'lit/directives/style-map.js',
    ]);
    expect(external.filter((s) => !allowed.has(s))).toEqual([]);
  });

  it('the site entry is a SUPERSET, so a page loads one bundle and not two', () => {
    const source = readFileSync(join(pkgRoot, 'src/elements/register-site.ts'), 'utf8');
    expect(source, 'register-site must pull the generic kit in').toContain(
      "from './register.js'"
    );
    expect(source).toContain('registerAll()');
  });

  it('lets @civitai/sdk in only through the elements that act as the viewer', () => {
    const generic = readdirSync(join(pkgRoot, 'dist/elements')).filter((f) => f.endsWith('.js'));
    const reachingSdk = generic.filter((f) =>
      [...reachableSpecifiers(`dist/elements/${f}`)].some((s) => s.startsWith('@civitai/sdk'))
    );
    expect(reachingSdk).toEqual([]);
    expect(reachableSpecifiers('dist/sdk/civitai-sign-in-button.js')).toContain('@civitai/sdk');
  });

  it('keeps the registration entries out of tree-shaking', () => {
    // `sideEffects: false` deletes every `*.define.js` and `register.js` as dead
    // code, so `import '.../define'` silently registers nothing. Measured: both
    // bundles drop to 0.00 kB. The listed globs are what make them survive.
    expect(pkg.sideEffects, 'a blanket false would delete every registration').not.toBe(false);
    expect(pkg.sideEffects).toContain('**/*.define.js');
    expect(pkg.sideEffects).toContain('**/elements/register.js');
    expect(pkg.sideEffects).toContain('**/elements/register-site.js');
  });

  it('the test-environment shim is its own entry, and no runtime entry reaches it', () => {
    // A guard in the elements would let production lose form association
    // silently; the shim is only ever loaded on purpose, by a test setup file.
    expect(pkg.exports['./testing/happy-dom']).toEqual({
      types: './dist/testing/happy-dom.d.ts',
      import: './dist/testing/happy-dom.js',
    });
    // Imported for its side effect, so it must survive tree-shaking too.
    expect(pkg.sideEffects).toContain('**/testing/happy-dom.js');

    const runtime = [
      'dist/index.js',
      'dist/elements/register.js',
      'dist/elements/register-site.js',
      ...readdirSync(join(pkgRoot, 'dist/elements'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => `dist/elements/${f}`),
      ...readdirSync(join(pkgRoot, 'dist/sdk'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => `dist/sdk/${f}`),
    ];
    const MARK = '@civitai/components/testing/element-internals-shim';
    // Positive control: the mark IS findable where it lives.
    expect(readFileSync(join(pkgRoot, 'dist/testing/happy-dom.js'), 'utf8')).toContain(MARK);
    for (const entry of runtime) {
      const files = reachableFiles(entry);
      expect(
        files.filter((f) => f.includes('/testing/')),
        `${entry} reaches the testing shim`
      ).toEqual([]);
    }
    // The single-file bundles are built by vite, so read them, not their imports.
    for (const bundle of ['elements.js', 'site-elements.js']) {
      expect(readFileSync(join(pkgRoot, bundle), 'utf8'), bundle).not.toContain(MARK);
    }
  });

  it('the shim is a no-op where there is no DOM (a `@vitest-environment node` file)', async () => {
    // A setup file runs for EVERY test file, including ones that opt out of the
    // DOM; throwing there would break a consumer's node-environment tests.
    expect(typeof globalThis.HTMLElement).toBe('undefined');
    const shim = await import('../src/testing/happy-dom.js');
    expect(shim.installElementInternalsShim()).toBe(false);
  });

  it('every declared export resolves to a built file', () => {
    for (const [name, target] of Object.entries(pkg.exports)) {
      const paths = typeof target === 'string' ? [target] : Object.values(target);
      for (const p of paths) {
        expect(() => readFileSync(join(pkgRoot, p)), `${name} -> ${p}`).not.toThrow();
      }
    }
  });
});
