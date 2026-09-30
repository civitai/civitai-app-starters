/**
 * `@civitai/app-sdk/vite` — NODE-ONLY Vite plugin that validates
 * `block.manifest.json` on every dev-server boot and every build.
 *
 * WHY THIS EXISTS. `defineBlock` shipped for months with zero callers outside
 * markdown (#330), so the manifests this repo ships were never validated by
 * anything and the validator was free to drift into rejecting all of them. A
 * gate that only runs where someone remembers to run it is the defect, not the
 * fix. This is the cheapest place that runs unavoidably: `pnpm dev`,
 * `pnpm dev:harness` and `pnpm build` all pass through `configResolved`.
 *
 * `configResolved` rather than `buildStart` on purpose — it is the one hook
 * Vite calls in BOTH the dev-server and build paths, so there is no mode in
 * which the check silently does not run. It is kept SYNCHRONOUS so the throw
 * cannot depend on whether Vite awaits the hook.
 *
 * This is NOT a substitute for `civitai app validate` (the Go CLI's own local
 * pre-check against the same canonical). It exists so a manifest mistake
 * surfaces in the dev loop rather than at submit time.
 *
 * PEERS: `ajv` (used at runtime by `@civitai/app-sdk/manifest`) and `vite`
 * (types only). Both are optional peers of `@civitai/app-sdk`; a scaffold using
 * this plugin needs both in its devDependencies.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Plugin } from 'vite';

import { BlockManifestError, defineBlock } from '../manifest/index.js';
import type { BlockManifest } from '../blocks/types.js';

export interface BlockManifestPluginOptions {
  /**
   * Path to the manifest. Relative paths resolve against `root`, which defaults
   * to the Vite project root reported by `configResolved`. Defaults to
   * `./block.manifest.json`.
   */
  manifestPath?: string;
  /** Overrides the Vite project root used to resolve a relative `manifestPath`. */
  root?: string;
}

export function blockManifestPlugin(options: BlockManifestPluginOptions = {}): Plugin {
  return {
    name: 'civitai-block-manifest',
    // `enforce: 'pre'` so the manifest error is the FIRST thing reported rather
    // than being buried under whatever else a slow plugin logs.
    enforce: 'pre',
    configResolved(config) {
      // Resolve against the Vite root (or an explicit override) rather than
      // this module's own location — this file now lives inside the installed
      // package, not next to the consumer's manifest.
      const root = options.root ?? config?.root ?? process.cwd();
      const manifestPath = resolve(root, options.manifestPath ?? './block.manifest.json');

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

// Re-exported so a consumer can catch the typed error without a second import.
export { BlockManifestError } from '../blocks/manifestError.js';
