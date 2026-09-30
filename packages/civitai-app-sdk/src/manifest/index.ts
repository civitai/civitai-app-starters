/**
 * `@civitai/app-sdk/manifest` — NODE-ONLY build-time manifest validation.
 *
 * Separate from `./blocks` on purpose. `./blocks` is the browser contract and
 * carries ZERO runtime dependencies (it ships into sandboxed iframes and every
 * app inherits its install graph). This subpath reads the vendored canonical
 * schema off disk with `node:fs` and compiles it with Ajv, which is an OPTIONAL
 * PEER — install it where you use this:
 *
 *   pnpm add -D ajv
 *
 * Most callers want `@civitai/app-sdk/vite` instead, which wraps `defineBlock`
 * in a Vite plugin that runs on every dev-server boot and every build.
 */
export { defineBlock, SCHEMA_DIVERGENCES, KNOWN_GAPS, loadCanonicalSchema } from './defineBlock.js';
export type { DefineBlockConfig } from './defineBlock.js';
export { BlockManifestError } from '../blocks/manifestError.js';
export type { BlockManifest, BlockManifestV1 } from '../blocks/types.js';
