/**
 * The gate must actually RUN somewhere. This is the test that says where.
 *
 * #330's fourth limb was that `defineBlock(` appeared only in markdown: no
 * starter, none of the six examples. Every shipped `block.manifest.json` was
 * unvalidated, which is precisely why the validator could drift into rejecting
 * all of them without anyone noticing.
 *
 * The wiring is ONE plugin — `@civitai/app-sdk/vite` — registered in each
 * scaffold's `vite.config.ts`, firing from `configResolved`, the one hook Vite
 * calls on BOTH the dev-server and the build path.
 *
 * NOT SEVEN COPIES ANY MORE. The previous revision duplicated the plugin
 * verbatim into all seven directories, justified as "a scaffold cannot import
 * from the monorepo". That was true of ONE of them and false of six: the
 * examples pin `workspace:^`, which is unresolvable outside the monorepo
 * anyway, and `starters/examples/README.md` tells a `tiged` user to swap to the
 * published packages. The block starter's case was not "the monorepo" either —
 * it was the PUBLISHED pin, which the release sequencing note in the PR body
 * covers. So the copies are gone, and with them the byte-identity ledger that
 * required every future manifest-shipping example to carry one.
 *
 * WHAT EACH ASSERTION IS WORTH:
 *   - the LEDGER is structural: the set of directories shipping a manifest and
 *     the set registering the plugin must be the SAME SET, in either direction,
 *     so a new example cannot ship unwired and a wired one cannot lose it.
 *   - the SPECIFIER assertion pins WHICH plugin, by package subpath. A local
 *     re-copy would satisfy the ledger and fail here.
 *   - the EXPORT-MAP assertion is the seam between this suite (which imports
 *     `src/`) and the scaffolds (which import the published specifier). KNOWN
 *     LIMIT: it checks the map POINTS somewhere real, not that Node resolves
 *     it. Real resolution is `pnpm --filter @civitai/app-sdk test:exports`,
 *     which runs after `build` in CI because it needs `dist/`.
 *   - the last two are BEHAVIOURAL: the plugin is executed against every real
 *     manifest (must pass) and against each one with a deliberate fault (must
 *     fail, on the fault's own field path rather than a neighbour's error).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { blockManifestPlugin } from '../../src/vite/index.js';
import pkg from '../../package.json' with { type: 'json' };
import { REPO_ROOT, manifestFiles, shippedManifests } from './fixtures.js';

const PLUGIN_SPECIFIER = '@civitai/app-sdk/vite';
const manifestDirs = manifestFiles().map(dirname).sort();

// Every temp dir this file creates, removed in afterAll. The previous revision
// leaked seven `mkdtempSync` directories per run, forever.
const tempDirs: string[] = [];
function tempManifest(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'block-manifest-'));
  tempDirs.push(dir);
  const file = join(dir, 'block.manifest.json');
  writeFileSync(file, JSON.stringify(contents));
  return file;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('the manifest gate is wired into every scaffold that ships a manifest', () => {
  it('found scaffolds at all (positive control — a zero makes the ledger vacuous)', () => {
    expect(manifestDirs.length).toBeGreaterThanOrEqual(7);
  });

  it('LEDGER: manifest directories === directories registering the plugin', () => {
    const wired = manifestDirs.filter((dir) => {
      const config = readFileSync(join(dir, 'vite.config.ts'), 'utf8');
      return config.includes('blockManifestPlugin()');
    });
    expect(wired).toEqual(manifestDirs);
  });

  it.each(manifestDirs.map((d) => [d.slice(REPO_ROOT.length + 1), d] as const))(
    '%s imports the plugin from the PACKAGE, not a local copy',
    (_label, dir) => {
      const config = readFileSync(join(dir, 'vite.config.ts'), 'utf8');
      expect(config, `${basename(dir)}/vite.config.ts`).toContain(
        `from '${PLUGIN_SPECIFIER}'`,
      );
      expect(config, 'no local vite-plugin-block-manifest copy').not.toContain(
        './vite-plugin-block-manifest',
      );
    },
  );

  it('the package exports the subpath the scaffolds import', () => {
    const exportsMap = pkg.exports as Record<string, { types: string; import: string }>;
    expect(Object.keys(exportsMap)).toContain('./vite');
    expect(Object.keys(exportsMap)).toContain('./manifest');
    // The dist path must correspond to a real source module; `test:exports`
    // (post-build, in CI) is what proves Node actually resolves it.
    expect(exportsMap['./vite']?.import).toBe('./dist/vite/index.js');
    expect(exportsMap['./manifest']?.import).toBe('./dist/manifest/index.js');
  });

  it('every scaffold declares the ajv optional peer it now needs', () => {
    for (const dir of manifestDirs) {
      const scaffold = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        devDependencies?: Record<string, string>;
      };
      expect(scaffold.devDependencies?.ajv, `${basename(dir)}/package.json`).toBeDefined();
    }
  });
});

describe('BEHAVIOURAL: the plugin runs the gate against each real manifest', () => {
  const shipped = shippedManifests();

  it.each(shipped.map((m) => [m.label, m] as const))('%s is ACCEPTED', (_label, { dir }) => {
    const plugin = blockManifestPlugin({ root: dir });
    expect(plugin.name).toBe('civitai-block-manifest');
    expect(plugin.enforce).toBe('pre');
    expect(() => (plugin.configResolved as () => void)()).not.toThrow();
  });

  it.each(shipped.map((m) => [m.label, m] as const))(
    '%s is REFUSED with one deliberate fault',
    (_label, { manifest }) => {
      // The mutation is the #330 defect inverted: `iframe.src` is the field the
      // old validator REQUIRED and the platform REFUSES. Written to a temp file
      // so the shipped manifest is never touched (sibling agents share this
      // tree), and asserted on its OWN field path so it cannot pass by dying on
      // a neighbouring rule.
      const faulted = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
      (faulted.iframe as Record<string, unknown>).src = 'https://my-block.civit.ai/';
      const file = tempManifest(faulted);

      const plugin = blockManifestPlugin({ root: dirname(file) });
      expect(() => (plugin.configResolved as () => void)()).toThrow(
        /\[iframe\.src\].*SERVER-OWNED/,
      );
    },
  );

  it('an unreadable manifest fails with the path, not a stack trace about JSON', () => {
    const plugin = blockManifestPlugin({ root: join(tmpdir(), 'definitely-not-here-137') });
    expect(() => (plugin.configResolved as () => void)()).toThrow(
      /block\.manifest\.json could not be read or parsed/,
    );
  });

  it('resolves manifestPath against the Vite root reported by configResolved', () => {
    const file = tempManifest({ blockId: 'X', version: '1.0.0', name: 'n', contentRating: 'g', scopes: [] });
    const plugin = blockManifestPlugin();
    // No `root` option: the hook must use the config it is handed.
    expect(() =>
      (plugin.configResolved as (c: { root: string }) => void)({ root: dirname(file) }),
    ).toThrow(/\[blockId\]/);
  });
});
