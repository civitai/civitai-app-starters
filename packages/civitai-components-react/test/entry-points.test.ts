/**
 * Entry-point shape.
 *
 * The `.` entry used to be asserted element-free, because it carried a
 * hand-written React layer and pulling Lit into it would have put a renderer
 * in the bundle of consumers who used none. That premise died with the
 * supersession: the custom elements are now the only implementation, so the
 * root necessarily reaches Lit and every element it re-exports.
 *
 * What replaces it is the invariant that actually holds now: the root and the
 * presentational barrel reach the SAME external specifiers — asserted as set
 * equality, so an extra at the root and a gap at the root both fail.
 *
 * 🔴 READ THE SCOPE — this is a check on the root's EXTERNAL SPECIFIER SET, not
 * on what the root implements. A module added at the root that imports only
 * things the barrel already reaches (`react`, `@lit/react`) passes this
 * untouched: MEASURED, by adding a second `dist` module importing only `react`
 * and re-exporting it from `dist/index.js` — 0 failed, the whole suite green. It goes red
 * only when the root gains a specifier the barrel lacks (control: the same
 * mutant importing `clsx` fails this test by name). **A hand-written React
 * component re-added to the package is caught by `bindings.test.ts`'s
 * "src holds only the entry and generated bindings", not here.** What this
 * test does own is the `@civitai/sdk` boundary — the two viewer-bound elements
 * must stay behind their own entry. Per-element bundle discipline is pinned by
 * the single-binding test below.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detailTypes, elements, usesSdk } from '../scripts/bindings.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Both `import x from 'y'` / `export … from 'y'` AND a bare `import 'y'`, which
// is how a register entry pulls its side effect in.
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s*(?:[^'"]*from\s*)?['"]([^'"]+)['"]/g;

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

// ---------------------------------------------------------------------------
// What a consumer can NAME off a built entry, as opposed to what it imports.
//
// `reachableSpecifiers` above answers "what does this entry pull in"; these
// answer "what does it hand out". Read against the BUILT `.d.ts`, because that
// is the artifact a consumer's `tsc` resolves — a type-only export is erased
// from the emitted `.js`, so a check over `dist/**/*.js` is structurally blind
// to it.
// ---------------------------------------------------------------------------

/** `'./civitai-menu.js'` and `'./civitai-menu'` both name `civitai-menu.d.ts`. */
const dtsFor = (file: string): string =>
  file.endsWith('.d.ts') ? file : `${file.replace(/\.js$/, '')}.d.ts`;

const EXPORT_STAR_RE = /export\s+\*\s+from\s*['"]([^'"]+)['"]/g;
/** `export { A, B as C }` and `export type { A }`, with or without a `from`. */
const EXPORT_LIST_RE = /export\s+(?:type\s+)?\{([^}]*)\}/g;
const EXPORT_DECL_RE =
  /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

/** Every name a consumer can import from `entry`, following relative re-exports. */
function exportedNames(entry: string): Set<string> {
  const names = new Set<string>();
  const seen = new Set<string>();
  const queue = [dtsFor(resolve(pkgRoot, entry))];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');

    for (const [, specifier] of source.matchAll(EXPORT_STAR_RE)) {
      if (specifier!.startsWith('.')) queue.push(dtsFor(resolve(dirname(file), specifier!)));
    }
    for (const [, list] of source.matchAll(EXPORT_LIST_RE)) {
      for (const clause of list!.split(',')) {
        // `A as B` is exported as B; a leading `type` is a per-clause modifier.
        const name = clause.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
    for (const [, name] of source.matchAll(EXPORT_DECL_RE)) names.add(name!);
  }
  return names;
}

describe('entry points', () => {
  it('the `.` entry is the presentational barrel and nothing besides', () => {
    const root = [...reachableSpecifiers('dist/index.js')].sort();
    const barrel = [...reachableSpecifiers('dist/elements/index.js')].sort();
    // Set equality both ways: a second implementation re-added to the root
    // shows up as an extra, a barrel export dropped from the root as a gap.
    expect(root).toEqual(barrel);
    expect(root).not.toContain('@civitai/components/register');
  });

  it('the `.` entry reaches no SDK — the viewer-bound elements stay behind their own entry', () => {
    const root = [...reachableSpecifiers('dist/index.js')];
    expect(root.filter((s) => s === '@civitai/sdk' || s.startsWith('@civitai/sdk/'))).toEqual([]);
    for (const { specifier } of elements().filter(usesSdk)) {
      expect(
        root.filter((s) => s.startsWith(`@civitai/components/${specifier}`)),
        `the root must not reach ${specifier}, which pulls @civitai/sdk in`
      ).toEqual([]);
    }
  });

  it('the `./elements` barrel registers every presentational element, and reaches no SDK', () => {
    const external = new Set(reachableSpecifiers('dist/elements/index.js'));
    for (const entry of elements().filter((e) => !usesSdk(e))) {
      expect(external, `the barrel must pull ${entry.specifier}/define`).toContain(
        `@civitai/components/${entry.specifier}/define`
      );
    }
    for (const { specifier } of elements().filter(usesSdk)) {
      expect(
        [...external].filter((s) => s.startsWith(`@civitai/components/${specifier}`)),
        `the barrel must not reach ${specifier}, which pulls @civitai/sdk in`
      ).toEqual([]);
    }
  });

  it('binds the elements that act as the viewer, behind their own entry', () => {
    const sdkBound = elements().filter(usesSdk);
    expect(sdkBound.map((e) => e.tag)).toContain('civitai-sign-in-button');
    for (const { specifier } of sdkBound) {
      expect(reachableSpecifiers(`dist/elements/${specifier}.js`)).toContain(
        `@civitai/components/${specifier}`
      );
    }
  });

  it('a single binding reaches its own element and nothing else', () => {
    // The whole point of per-element modules: importing one button must not
    // drag in thirty-two elements behind it.
    const external = [...reachableSpecifiers('dist/elements/civitai-button.js')]
      .filter((s) => s.startsWith('@civitai/components'))
      .sort();
    expect(external).toEqual([
      '@civitai/components/civitai-button',
      '@civitai/components/civitai-button/define',
    ]);
  });

  /**
   * The event `detail` types must be nameable off this package.
   *
   * These appear in this package's OWN published signatures — `CivitaiMenu`'s
   * `onSelect` is `EventName<CustomEvent<MenuSelectDetail>>` — while, until this
   * guard, being exported by no entry point of it. A consumer typing that
   * handler's argument had to add `@civitai/components` as a second direct
   * dependency purely for a type, and this package's own browser test did
   * exactly that for `TagVoteDetail`.
   *
   * 🔴 READ THE SCOPE. This asserts the NAME is exported from the built `.d.ts`,
   * derived from `EVENTS` via `detailTypes` — the same source of truth the
   * emitter reads, so the two cannot disagree about which types exist. It fails
   * when a detail type is ADDED to `EVENTS` without reaching the surface, which
   * is the rot it exists to catch. It does NOT assert the type is the right
   * shape; `elements.browser.test.tsx` drives a real `onSelect` for that.
   *
   * The SDK arm is stated in the emitter (an SDK-bound binding's detail types
   * stay out of the barrel, like the binding) but is UNEXERCISED today: neither
   * `civitai-sign-in-button` nor `civitai-workflow-button` carries one, so there
   * is nothing here to assert absent.
   */
  it('the root names every presentational `detail` type, so @civitai/components is not needed for one', () => {
    const fromRoot = exportedNames('dist/index.d.ts');

    // POSITIVE CONTROL — the walker really reached through `.` to the bindings,
    // so a missing name below is a gap in the surface and not a parser wired to
    // nothing. A reassuring pass over an empty set is the failure mode here.
    expect(fromRoot).toContain('CivitaiButton');
    expect(fromRoot.size).toBeGreaterThan(40);

    const expected = elements()
      .filter((entry) => !usesSdk(entry))
      .flatMap((entry) => detailTypes(entry.tag));
    // Not vacuous: there ARE detail types to check.
    expect(expected.length).toBeGreaterThan(0);

    for (const name of expected) {
      expect(
        [...fromRoot],
        `@civitai/components-react must export the type \`${name}\` — it is in a public signature`
      ).toContain(name);
    }
  });

  it('a single binding entry names its own `detail` types too', () => {
    // Per-element imports are a documented route (bundle size, and the two
    // SDK-bound bindings have no other), so the type must be reachable there
    // as well — not only off the barrel.
    const withDetails = elements().filter((entry) => detailTypes(entry.tag).length > 0);
    expect(withDetails.length).toBeGreaterThan(0);

    for (const { tag } of withDetails) {
      const names = exportedNames(`dist/elements/${tag}.d.ts`);
      for (const detail of detailTypes(tag)) {
        expect(
          [...names],
          `dist/elements/${tag}.d.ts must export the type \`${detail}\``
        ).toContain(detail);
      }
    }
  });
});
