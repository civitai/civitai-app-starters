/**
 * The sheets are generated; what generation cannot check is that the spec
 * itself is coherent — one alias claimed twice is a silent override.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UTILITIES, SPACE } from '../src/utilities.spec.js';
import { civitaiSheet, compatSheet, pkgRoot } from '../scripts/utilities.js';
import { utilitiesCss } from '../src/utilities.generated.js';

const read = (path: string): string => readFileSync(join(pkgRoot, path), 'utf8');

describe('the utility sheets', () => {
  it.each([
    ['dist/utilities.css', () => civitaiSheet()],
    ['utilities.css', () => civitaiSheet()],
    ['dist/bootstrap-compat.css', () => compatSheet()],
    ['bootstrap-compat.css', () => compatSheet()],
  ])('%s matches a fresh generation', (path, build) => {
    expect(read(path), `${path} is stale — run \`pnpm --filter @civitai/components generate\``).toBe(
      build()
    );
  });

  it('embeds the same bytes it writes, so the injectable form cannot drift', () => {
    expect(utilitiesCss).toBe(civitaiSheet());
  });
});

describe('the utility spec', () => {
  it('names every utility once', () => {
    const names = UTILITIES.map((u) => u.name);
    expect(new Set(names).size, `duplicates: ${names.filter((n, i) => names.indexOf(n) !== i)}`).toBe(
      names.length
    );
  });

  it('claims every bootstrap alias once, so none silently overrides another', () => {
    const aliases = UTILITIES.flatMap((u) => u.bootstrap ?? []);
    const seen = aliases.filter((a, i) => aliases.indexOf(a) !== i);
    expect(seen, `claimed twice: ${seen}`).toEqual([]);
  });

  it('spends the spacing scale rather than hard-coding lengths', () => {
    const spacing = UTILITIES.filter((u) => /^[mp][tbsexy]?-\d$/.test(u.name));
    expect(spacing.length).toBe(2 * 7 * SPACE.length);
    for (const utility of spacing) {
      for (const decl of utility.decls) expect(decl).toMatch(/var\(--civitai-space-\d\)/);
    }
  });

  it('gives every responsive utility a breakpoint slot in its alias', () => {
    for (const utility of UTILITIES.filter((u) => u.responsive)) {
      for (const alias of utility.bootstrap ?? []) {
        expect(alias, `${utility.name} -> ${alias}`).toContain('{bp}');
      }
    }
  });
});
