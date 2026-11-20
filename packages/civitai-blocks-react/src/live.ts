/**
 * `@civitai/blocks-react/live` — THE REAL BACKEND. THIS SPENDS REAL BUZZ.
 *
 * `createLiveHost` forwards the App-Block postMessage protocol to the REAL
 * Civitai backend over a pasted short-lived dev block token,
 * `blocks.submitWorkflow` included. A successful generation DEBITS THE TOKEN
 * HOLDER'S OWN BUZZ. There is no dry-run mode and no confirmation. It exists for
 * one caller: a `pnpm dev:live` harness. The free one is `createMockHost`, on
 * `@civitai/blocks-react/testing`.
 *
 * WHY ITS OWN SUBPATH (#334): a client that spends the caller's money should not
 * be reachable through an import path named `testing`. The import line is the
 * one piece of context that travels with every call site, so it is where the
 * warning belongs. It does NOT make the package smaller — `files` is
 * `["dist", "README.md"]` and `tsconfig` compiles the whole source tree, so the
 * code ships either way.
 *
 * Surface, rationale and stability are documented in exactly one place — README
 * § "The `/live` subexport". Do not restate them here; a second copy is what
 * went stale and became #334. `test/subpathSurfaces.test.ts` pins this module's
 * runtime export set.
 */

export { createLiveHost, type LiveHostOptions } from './internal/liveHost.js';
