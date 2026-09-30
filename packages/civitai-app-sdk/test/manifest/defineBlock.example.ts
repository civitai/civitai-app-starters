// THE `@example` BLOCK OF `defineBlock`, VERBATIM.
//
// Everything below the marker is compared byte-for-byte (after stripping the
// JSDoc ` * ` prefix) against the `@example` in `src/manifest/defineBlock.ts` by
// `defineBlock.example.test.ts`, which also IMPORTS this module — so the
// snippet in the docs is type-checked by `tsc` and executed by `vitest`.
// Before #330 the `@example` omitted required fields and set `iframe.src`: it
// neither compiled nor ran. `scripts/typecheck-readme-snippets.mjs` gates
// README fences only and could not have caught it.
//
// EDIT BOTH SIDES OR THE GUARD FAILS. The import specifier is the one place
// they differ: the doc snippet names the published package, this file reaches
// into src so the test exercises the code under test rather than `dist`.
//
// --- EXAMPLE START ---
import { defineBlock } from '../../src/manifest/index.js';

export const manifest = defineBlock({
  manifest: {
    $schema: 'https://civitai.com/schemas/app-block/v1.json',
    blockId: 'my-block',
    version: '0.1.0',
    name: 'My Block',
    type: 'block',
    targets: [{ slotId: 'model.sidebar_top', priority: 100 }],
    scopes: ['models:read:self'],
    // NOTE: no `iframe.src` — the platform stamps it at build/approve time.
    iframe: {
      minHeight: 200,
      maxHeight: 600,
      resizable: true,
      sandbox: 'allow-scripts allow-forms',
    },
    contentRating: 'pg',
    minApiVersion: '1.0',
  },
});
