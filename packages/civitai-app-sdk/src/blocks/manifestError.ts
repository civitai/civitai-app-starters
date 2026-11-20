/**
 * The manifest-validation error type, in its own zero-dependency module.
 *
 * It lives here rather than beside `defineBlock` because `defineBlock` now
 * lives at the node-only `@civitai/app-sdk/manifest` subpath (it reads the
 * vendored canonical schema off disk and compiles it with Ajv). The error class
 * has to stay importable from the browser-safe `./blocks` surface so that
 * `instanceof BlockManifestError` means the same thing on both sides — one
 * class, one module, no duplicate identity.
 */

/** Thrown by `defineBlock` for any manifest violation. */
export class BlockManifestError extends Error {
  override readonly name = 'BlockManifestError';
  constructor(
    message: string,
    /** Dot-path to the offending field, e.g. `iframe.sandbox`. */
    readonly field?: string,
  ) {
    super(message);
  }
}
