/**
 * The gate must actually RUN somewhere. This is the test that says where.
 *
 * #330's fourth limb was that `defineBlock(` appeared in four markdown files
 * and nowhere else: no starter, none of the seven examples. Every shipped
 * `block.manifest.json` was unvalidated, which is precisely why the validator
 * could drift into rejecting all of them without anyone noticing.
 *
 * The wiring is a Vite plugin (`vite-plugin-block-manifest.ts`) registered in
 * each scaffold's `vite.config.ts`, firing from `configResolved` — the one hook
 * Vite calls on BOTH the dev-server and the build path, so `pnpm dev`,
 * `pnpm dev:harness` and `pnpm build` all pass through it.
 *
 * WHAT EACH ASSERTION BELOW IS WORTH, stated so nobody reads more into it:
 *   - the LEDGER is structural. It fails when the set of manifest directories
 *     and the set of wired directories stop being the same set — in EITHER
 *     direction, so a new example cannot ship unwired and a wired one cannot
 *     quietly lose its plugin.
 *   - BYTE-IDENTITY is structural. Seven copies exist because each scaffold is
 *     copied out on its own (`civitai app init`, `npx tiged`) and cannot import
 *     a monorepo helper; identity is what keeps a fix landing in all seven.
 *     On its own it proves nothing about behaviour — seven identically gutted
 *     copies pass it.
 *   - the last two are BEHAVIOURAL, and they are what identity leans on: every
 *     copy is loaded and executed against its own real manifest (must pass) and
 *     against that manifest with one deliberate fault (must fail, on the fault's
 *     own field path rather than a neighbour's error).
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const STARTERS_DIR = join(REPO_ROOT, 'starters');
const PLUGIN_FILENAME = 'vite-plugin-block-manifest.ts';
const MANIFEST_FILENAME = 'block.manifest.json';

function findByName(dir: string, name: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findByName(full, name, out);
    else if (entry.name === name) out.push(full);
  }
  return out;
}

const manifestDirs = findByName(STARTERS_DIR, MANIFEST_FILENAME).map(dirname).sort();
const pluginFiles = findByName(STARTERS_DIR, PLUGIN_FILENAME).sort();

interface VitePlugin {
  name: string;
  enforce?: string;
  configResolved: () => void;
}
type PluginFactory = (options?: { manifestPath?: string }) => VitePlugin;

async function loadPlugin(file: string): Promise<PluginFactory> {
  const mod = (await import(/* @vite-ignore */ file)) as { blockManifestPlugin: PluginFactory };
  return mod.blockManifestPlugin;
}

describe('the manifest gate is wired into every scaffold that ships a manifest', () => {
  it('found scaffolds at all (positive control — a zero here would make the ledger vacuous)', () => {
    expect(manifestDirs.length).toBeGreaterThanOrEqual(7);
  });

  it('LEDGER: manifest directories === wired directories (fails if either set grows or shrinks)', () => {
    expect(pluginFiles.map(dirname).sort()).toEqual(manifestDirs);
  });

  it('LEDGER: every wired directory registers the plugin in its vite.config.ts', () => {
    for (const dir of manifestDirs) {
      const config = readFileSync(join(dir, 'vite.config.ts'), 'utf8');
      expect(config, `${basename(dir)}/vite.config.ts imports the plugin`).toContain(
        "from './vite-plugin-block-manifest'",
      );
      expect(config, `${basename(dir)}/vite.config.ts registers the plugin`).toContain(
        'blockManifestPlugin()',
      );
    }
  });

  it('every copy of the plugin is byte-identical', () => {
    const contents = pluginFiles.map((f) => readFileSync(f, 'utf8'));
    const distinct = new Set(contents);
    expect(distinct.size, `copies drifted: ${pluginFiles.join(', ')}`).toBe(1);
    // Non-triviality: an empty or stubbed file would also be "identical".
    expect([...distinct][0]).toContain('defineBlock({ manifest })');
  });

  it.each(pluginFiles.map((f) => [f.slice(REPO_ROOT.length + 1), f] as const))(
    '%s accepts its own real manifest',
    async (_label, file) => {
      const plugin = (await loadPlugin(file))();
      expect(plugin.name).toBe('civitai-block-manifest');
      expect(() => plugin.configResolved()).not.toThrow();
    },
  );

  it.each(pluginFiles.map((f) => [f.slice(REPO_ROOT.length + 1), f] as const))(
    '%s REFUSES that manifest with one deliberate fault',
    async (_label, file) => {
      // The mutation is the #330 defect inverted: `iframe.src` is the field the
      // old validator REQUIRED and the platform REFUSES. Written to a temp file
      // so the shipped manifest is never touched (a sibling agent shares this
      // tree), and asserted on its OWN field path so it cannot pass by dying on
      // some neighbouring rule.
      const manifest = JSON.parse(
        readFileSync(join(dirname(file), MANIFEST_FILENAME), 'utf8'),
      ) as Record<string, unknown>;
      (manifest.iframe as Record<string, unknown>).src = 'https://my-block.civit.ai/';
      const tmp = join(mkdtempSync(join(tmpdir(), 'lbi-')), MANIFEST_FILENAME);
      writeFileSync(tmp, JSON.stringify(manifest));

      const plugin = (await loadPlugin(file))({ manifestPath: tmp });
      expect(() => plugin.configResolved()).toThrow(/\[iframe\.src\].*SERVER-OWNED/);
    },
  );
});
