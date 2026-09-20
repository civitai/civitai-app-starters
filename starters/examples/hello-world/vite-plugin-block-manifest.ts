/**
 * Vite plugin: validate `block.manifest.json` on every dev-server boot and
 * every build.
 *
 * WHY IT LIVES HERE AND NOT IN A DOC. `defineBlock` shipped for months with
 * zero callers outside markdown (#330), so the seven manifests this repo ships
 * were never validated by anything, and the validator was free to drift into
 * rejecting all of them. A gate that only runs where someone remembers to run
 * it is the defect, not the fix. This is the cheapest place that runs
 * unavoidably: `pnpm dev`, `pnpm dev:harness` and `pnpm build` all pass through
 * `configResolved`.
 *
 * `configResolved` rather than `buildStart` on purpose — it is the one hook
 * Vite calls in BOTH the dev-server and build paths, so there is no mode in
 * which the check silently does not run.
 *
 * This file is duplicated verbatim into every starter and example that ships a
 * manifest. That is deliberate: each of those directories is a SCAFFOLD, copied
 * out on its own by `civitai app init` / `npx tiged`, so it cannot import a
 * shared helper from the monorepo. `packages/civitai-app-sdk/test/blocks/starter-wiring.test.ts`
 * asserts the copies stay byte-identical and that each one actually rejects a
 * bad manifest.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BlockManifestError, defineBlock } from '@civitai/app-sdk/blocks';
import type { BlockManifest } from '@civitai/app-sdk/blocks';
import type { Plugin } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface BlockManifestPluginOptions {
  /** Defaults to `./block.manifest.json`, resolved next to this file. */
  manifestPath?: string;
}

export function blockManifestPlugin(options: BlockManifestPluginOptions = {}): Plugin {
  const manifestPath = resolve(HERE, options.manifestPath ?? './block.manifest.json');
  return {
    name: 'civitai-block-manifest',
    // `enforce: 'pre'` so the manifest error is the FIRST thing reported rather
    // than being buried under whatever else a slow plugin logs.
    enforce: 'pre',
    configResolved() {
      let manifest: BlockManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BlockManifest;
      } catch (err) {
        throw new Error(
          `block.manifest.json could not be read or parsed (${manifestPath}): ${(err as Error).message}`,
        );
      }
      try {
        defineBlock({ manifest });
      } catch (err) {
        // Re-thrown with the field path up front: Vite prints the message, not
        // the error's own properties, so `.field` would otherwise be invisible.
        const field = err instanceof BlockManifestError && err.field ? ` [${err.field}]` : '';
        throw new Error(`block.manifest.json is invalid${field}: ${(err as Error).message}`);
      }
    },
  };
}
