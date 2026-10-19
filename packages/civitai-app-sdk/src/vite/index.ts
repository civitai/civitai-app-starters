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
 * DEV SERVER ONLY, it also hands the manifest's `scopes` and `storage` to
 * `@civitai/sdk`, for a dev-tunnel preview. A preview has no server-side storage,
 * so when the host marks the frame `storageMode: 'local-preview'` the SDK serves
 * `app.storage.collection(name)` from an in-memory store that enforces THESE
 * declarations — the ones of the code being previewed, which the server has
 * never seen. See {@link LOCAL_PREVIEW_MANIFEST_GLOBAL} for why it is a global.
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

/**
 * The global the dev server's HTML sets for `@civitai/sdk` to read. Spelled again
 * in `packages/civitai-sdk/src/doc-store/local-preview.ts` (the two packages share
 * no code); `tests/guards/local-preview-manifest-global.test.mjs` pins the two equal.
 *
 * WHY A GLOBAL, set by a `<script>` the plugin adds to `index.html`, rather than
 * the alternatives:
 * - a VIRTUAL MODULE needs `@civitai/sdk` to import it, which fails to resolve in
 *   every bundle not built by this plugin — production included;
 * - a `define` substitution has to reach `@civitai/sdk` inside `node_modules`,
 *   where it depends on how the dependency optimizer pre-bundles it, and it would
 *   rewrite production builds too;
 * - an `initialize()` option needs every app to import its manifest and pass it,
 *   and would be public API with no caller outside tests: both real preview
 *   paths run this plugin on the Vite dev server.
 * The `<script>` is added on the DEV SERVER only (`vite build` never emits it),
 * needs no change in any app, and the SDK reads it only when the host marks the
 * frame a local preview. It is the ONLY way the manifest reaches the SDK: an app
 * without this plugin gets the SDK's `local_preview_no_manifest` error.
 */
export const LOCAL_PREVIEW_MANIFEST_GLOBAL = '__CIVITAI_LOCAL_PREVIEW_MANIFEST__';

/** Reads and validates the manifest, throwing the message Vite should print. */
function loadManifest(manifestPath: string): BlockManifest {
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
  return manifest;
}

/**
 * The classic `<script>` body: only `scopes` and `storage`, as JSON with `<`
 * escaped so no value can close the element.
 */
export function localPreviewManifestScript(manifest: Pick<BlockManifest, 'scopes' | 'storage'>): string {
  const exposed = JSON.stringify({ scopes: manifest.scopes, storage: manifest.storage }).replace(/</g, '\\u003c');
  return `globalThis[${JSON.stringify(LOCAL_PREVIEW_MANIFEST_GLOBAL)}] = ${exposed};`;
}

export function blockManifestPlugin(options: BlockManifestPluginOptions = {}): Plugin {
  let manifestPath = '';
  let serving = false;
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
      manifestPath = resolve(root, options.manifestPath ?? './block.manifest.json');
      serving = config?.command === 'serve';
      loadManifest(manifestPath);
    },
    transformIndexHtml() {
      // Dev server only: a build never carries the manifest into the page.
      if (!serving) return undefined;
      // Re-read per page load, so an edited manifest takes effect on reload.
      const manifest = loadManifest(manifestPath);
      return [
        {
          tag: 'script',
          // First in <head>: a classic script runs before any module script.
          injectTo: 'head-prepend',
          children: localPreviewManifestScript(manifest),
        },
      ];
    },
  };
}

// Re-exported so a consumer can catch the typed error without a second import.
export { BlockManifestError } from '../blocks/manifestError.js';
