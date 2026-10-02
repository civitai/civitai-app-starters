/**
 * @civitai/components CSS integrity:
 *   - generation parity: dist/components.css === src/components.css, and the
 *     JS-injectable string embeds the same CSS byte-for-byte.
 *   - token discipline: the shipped CSS references `--civitai-*` tokens and
 *     NEVER the old `--ci-*` or raw `--mantine-*` names (the drift being fixed).
 *   - layering: every rule is inside `@layer civitai.components`.
 *   - no OS colour-scheme preference, anywhere this package authors CSS.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { componentsCss } from '../src/styles.generated.js';
import { VERSION } from '../src/version.generated.js';
import pkg from '../package.json' with { type: 'json' };

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcCss = readFileSync(join(pkgRoot, 'src/components.css'), 'utf8');
const distCss = readFileSync(join(pkgRoot, 'dist/components.css'), 'utf8');

describe('components CSS integrity', () => {
  it('dist/components.css matches the source', () => {
    expect(distCss).toBe(srcCss);
  });

  it('the JS-injectable string embeds the source CSS', () => {
    expect(componentsCss).toBe(srcCss);
  });

  /*
   * 🔴 THIS CANNOT SEE A STALE COMMIT, AND IT READS AS IF IT COULD. CI builds
   * this package before testing it (`.github/workflows/ci.yml`, the
   * `design-system` job) and the build rewrites `src/version.generated.ts` from
   * package.json — so what this asserts is that the GENERATOR stamped the right
   * version, never that the version in git is current. `0.8.1` sat committed
   * against a `0.9.0` package.json from #492 onward with this test green
   * throughout.
   *
   * The committed file is checked by `scripts/check-generated-version.mjs`
   * (`pnpm check:generated-version`), which reads it as text and runs BEFORE any
   * build step. Keep both: this one owns the generator, that one owns the
   * commit.
   */
  it('the stamped element version matches package.json (post-BUILD: see the note above)', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('references --civitai-* tokens', () => {
    expect(srcCss).toMatch(/var\(--civitai-color-primary\)/);
    expect((srcCss.match(/--civitai-/g) ?? []).length).toBeGreaterThan(20);
  });

  it('does NOT reference legacy --ci-* or raw --mantine-* tokens', () => {
    // `--civitai-` contains `--ci`, so assert the standalone `--ci-<word>` form
    // is absent rather than a bare substring.
    expect(srcCss).not.toMatch(/--ci-[a-z]/);
    expect(srcCss).not.toContain('--mantine-');
  });

  it('wraps all rules in @layer civitai.components', () => {
    expect(srcCss).toContain('@layer civitai.components {');
    // No selector rule should sit outside the layer: the only top-level `{`
    // block is the @layer itself. Strip the layer block and assert no stray
    // `[data-civitai-ui` selectors remain at top level.
    const withoutLayer = srcCss.replace(/@layer civitai\.components \{[\s\S]*\}\s*$/, '');
    expect(withoutLayer).not.toContain('[data-civitai-ui');
  });
});

/*
 * 🔴 NO OS COLOUR-SCHEME PREFERENCE, ANYWHERE THIS PACKAGE AUTHORS CSS.
 *
 * This replaces the dedicated `prefers-dark` vitest project, retired in the
 * same change. That project launched a SECOND Chromium context under
 * `contextOptions: { colorScheme: 'dark' }` to run five assertions, and after
 * the dark-base flip (`@civitai/theme@0.5.0`) every one of them passed
 * identically with and without the change it was aimed at: a dark-OS context
 * cannot tell "dark base" from "light base plus an OS-dark override", because
 * both answer dark. Its own header said so.
 *
 * What it was left guarding is the one hazard a dark-OS browser could still see
 * and `@civitai/theme`'s guard could not: a `prefers-color-scheme` at-rule
 * authored HERE, in component CSS, rather than in the token sheet. Pinning that
 * at source is strictly stronger — it fails on the at-rule EXISTING, not on one
 * rendered consequence of it, and the absence of an at-rule cannot be observed
 * from a computed value at all — over a far wider surface than one sheet in one
 * engine. The mirror-image claim for the TOKEN sheet is pinned the same way, in
 * `@civitai/theme`'s `test/generation-parity.test.ts`.
 *
 * ⚠️ SCOPE, stated so this is not read wider than it is: it reads authored
 * text. A `prefers-color-scheme` inside a third-party sheet a consumer loads is
 * outside it, and so is a JS `matchMedia` branch — there are none of either in
 * this package today, and neither was in the retired project's reach either.
 */
describe('no OS colour-scheme preference in the component CSS', () => {
  /*
   * Every surface this package authors or ships CSS in: the source sheet, both
   * committed generated sheets, and every element's shadow-DOM `css` template.
   * `dist/` is deliberately absent — it is a copy of `src/components.css`,
   * asserted byte-identical above — which keeps this guard independent of
   * whether a build has run.
   */
  const corpus = [
    'src/components.css',
    'utilities.css',
    'bootstrap-compat.css',
    ...readdirSync(join(pkgRoot, 'src/elements'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `src/elements/${name}`),
  ].map((file) => ({ file, text: readFileSync(join(pkgRoot, file), 'utf8') }));

  const hits = (text: string): number => (text.match(/prefers-color-scheme/g) ?? []).length;

  it('reads a corpus big enough to be the real one', () => {
    // POSITIVE CONTROL on the CORPUS. The verdict below is a zero, and a zero
    // is only evidence if something was read: a glob that resolves to nothing,
    // or to one stub file, reports a perfectly clean sweep. Both floors sit
    // well under the live figures (103 files, ~277 kB when written), so adding
    // or removing components cannot trip them.
    expect(corpus.length).toBeGreaterThan(60);
    expect(corpus.reduce((n, { text }) => n + text.length, 0)).toBeGreaterThan(150_000);
  });

  it('can see the thing it forbids', () => {
    // POSITIVE CONTROL on the MATCHER, which the corpus control cannot give: a
    // mis-typed pattern finds nothing in a clean tree and nothing in a dirty
    // one, and those two are indistinguishable from the result alone.
    expect(hits('@media (prefers-color-scheme: dark) { :root { color: red } }')).toBe(1);
  });

  it('declares none, in either direction, in any of them', () => {
    // An OS-LIGHT block is the same defect mirrored, so the at-rule's NAME is
    // the hazard rather than either value it can carry.
    const offenders = corpus.filter(({ text }) => hits(text) > 0).map(({ file }) => file);
    expect(
      offenders,
      'component CSS must not consult the OS colour scheme — the theme is the page\'s to declare, via data-theme'
    ).toEqual([]);
  });
});
