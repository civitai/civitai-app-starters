/**
 * Every generated artifact must match what its generator would produce RIGHT
 * NOW from the committed sources.
 *
 * Generated files are committed (so `tsc`-only consumers and a fresh clone
 * work without a codegen step), which means they can silently go stale: edit
 * `button.css`, forget `pnpm generate`, and the element adopts the OLD rules
 * while the `<link>`-able `dist/styles.css` has the new ones. Nothing else in
 * the build notices.
 *
 * Covered here:
 *   - `src/generated/*.css.ts`   vs the sibling `.css` source
 *   - `api-snapshot.json`        vs `custom-elements.json`
 *   - `elements-react/src/generated/jsx.ts` vs `custom-elements.json`
 *   - `custom-elements.json`     vs the reactive properties actually declared
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const src = join(pkgRoot, 'src');

function cssSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'generated') cssSources(full, out);
    } else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

describe('generated CSS modules match their sources', () => {
  const sources = cssSources(src);

  it('finds the CSS sources at all', () => {
    // Without this, an empty list would make the loop below vacuous.
    expect(sources.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of sources) {
    const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.css$/, '');
    it(`${base}.css is in sync with generated/${base}.css.ts`, () => {
      // Read the COMMITTED text rather than importing it: a dynamic import
      // would exercise vite's transform of the file, while what has to match
      // the source is the bytes a fresh clone gets.
      const ident = `${base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}Css`;
      const gen = readFileSync(join(src, 'generated', `${base}.css.ts`), 'utf8');
      const m = new RegExp(`export const ${ident} = (".*");`, 's').exec(gen);
      expect(m, `generated/${base}.css.ts does not export ${ident}`).not.toBeNull();
      expect(JSON.parse((m as RegExpExecArray)[1] as string)).toBe(readFileSync(file, 'utf8'));
    });
  }

  it('dist/styles.css contains every component sheet', () => {
    const dist = join(pkgRoot, 'dist', 'styles.css');
    if (!existsSync(dist)) return; // not built in this job; the build regenerates it
    const all = readFileSync(dist, 'utf8');
    for (const file of sources) expect(all).toContain(readFileSync(file, 'utf8'));
  });
});

describe('the API snapshot matches the manifest', () => {
  it('api:check passes against the committed manifest', () => {
    // Runs the REAL gate, not a reimplementation of it — a second copy of the
    // comparison logic would be the thing that drifts.
    const out = execFileSync(process.execPath, [join(pkgRoot, 'scripts', 'api-snapshot.mjs'), '--check'], {
      cwd: pkgRoot,
      encoding: 'utf8',
    });
    expect(out).toContain('public surface unchanged');
  });
});

describe('the React types match the manifest', () => {
  it('regenerating jsx.ts produces no diff', () => {
    const generated = join(pkgRoot, '..', 'civitai-elements-react', 'src', 'generated', 'jsx.ts');
    const before = readFileSync(generated, 'utf8');
    execFileSync(process.execPath, [join(pkgRoot, 'scripts', 'gen-react-types.mjs')], {
      cwd: pkgRoot,
      encoding: 'utf8',
    });
    expect(readFileSync(generated, 'utf8')).toBe(before);
  });
});

describe('the manifest describes every reactive property', () => {
  it('no declared property is missing from custom-elements.json', async () => {
    const manifest = JSON.parse(
      readFileSync(join(pkgRoot, 'custom-elements.json'), 'utf8')
    ) as { modules: { declarations?: { tagName?: string; members?: { name: string }[] }[] }[] };

    const byTag = new Map<string, Set<string>>();
    for (const mod of manifest.modules) {
      for (const d of mod.declarations ?? []) {
        if (d.tagName) byTag.set(d.tagName, new Set((d.members ?? []).map((m) => m.name)));
      }
    }

    // `static properties` uses `...Base.properties`, a spread the analyzer
    // cannot follow. Read the LIVE constructor instead: that is the set the
    // browser really honours.
    const mods = await Promise.all([
      import('../src/button.js'),
      import('../src/select.js'),
      import('../src/slider.js'),
      import('../src/stack.js'),
    ]);
    const ctors = [
      ['civitai-button', mods[0].CivitaiButton],
      ['civitai-select', mods[1].CivitaiSelect],
      ['civitai-slider', mods[2].CivitaiSlider],
      ['civitai-stack', mods[3].CivitaiStack],
    ] as const;

    expect(byTag.size).toBe(ctors.length);
    for (const [tag, ctor] of ctors) {
      const declared = [
        ...((ctor as unknown as { elementProperties: Map<string, unknown> }).elementProperties?.keys() ??
          []),
      ];
      expect(declared.length, `${tag} declares no reactive properties`).toBeGreaterThan(2);
      const documented = byTag.get(tag) as Set<string>;
      const missing = declared.filter((p) => !documented.has(p));
      expect(missing, `${tag}: reactive properties absent from the manifest`).toEqual([]);
    }
  });
});
