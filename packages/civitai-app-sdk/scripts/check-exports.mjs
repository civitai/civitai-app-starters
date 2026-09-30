#!/usr/bin/env node
/**
 * POST-BUILD resolution check for the node-only subpaths.
 *
 * The seam this closes: the vitest suite imports `src/`, while every scaffold
 * imports the PUBLISHED specifier (`@civitai/app-sdk/vite`). Those are two
 * different resolutions, and a green suite says nothing about the second — a
 * typo in `exports`, a `dist` path that is never emitted, or a schema file
 * `files` does not ship all leave the tests green and the scaffold build red.
 *
 * This resolves by PACKAGE NAME (Node's self-reference, which goes through the
 * real `exports` map, not through a relative path) after `build`, so it fails
 * on exactly that class. It also calls `defineBlock` once, which is what proves
 * the vendored schema is reachable from `dist/` — the relative URL in
 * `src/manifest/defineBlock.ts` has to be right for BOTH trees.
 *
 * Run: pnpm --filter @civitai/app-sdk test:exports   (CI runs it after `build`)
 */
import assert from 'node:assert/strict';

const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

await check('@civitai/app-sdk/manifest resolves and exports defineBlock', async () => {
  const mod = await import('@civitai/app-sdk/manifest');
  assert.equal(typeof mod.defineBlock, 'function');
  assert.equal(typeof mod.BlockManifestError, 'function');
  assert.ok(Object.keys(mod.SCHEMA_DIVERGENCES).length > 0);
});

await check('@civitai/app-sdk/vite resolves and exports blockManifestPlugin', async () => {
  const mod = await import('@civitai/app-sdk/vite');
  assert.equal(typeof mod.blockManifestPlugin, 'function');
  assert.equal(mod.blockManifestPlugin().name, 'civitai-block-manifest');
});

await check('the vendored schema is reachable from dist/ (defineBlock actually runs)', async () => {
  const { defineBlock } = await import('@civitai/app-sdk/manifest');
  const manifest = {
    blockId: 'exports-probe',
    version: '1.0.0',
    name: 'Exports Probe',
    contentRating: 'g',
    scopes: [],
  };
  assert.equal(defineBlock({ manifest }), manifest);
});

await check('NEGATIVE CONTROL: the built copy can still say no', async () => {
  const { defineBlock, BlockManifestError } = await import('@civitai/app-sdk/manifest');
  assert.throws(
    () =>
      defineBlock({
        manifest: {
          blockId: 'NOT-a-dns-label',
          version: '1.0.0',
          name: 'n',
          contentRating: 'g',
          scopes: [],
        },
      }),
    (err) => err instanceof BlockManifestError && err.field === 'blockId',
  );
});

await check('@civitai/app-sdk/blocks no longer exports defineBlock (it moved)', async () => {
  const mod = await import('@civitai/app-sdk/blocks');
  assert.equal(mod.defineBlock, undefined, 'defineBlock must not be re-exported from ./blocks');
  assert.equal(typeof mod.BlockManifestError, 'function', 'the error type stays');
});

await check('./blocks and ./manifest share ONE BlockManifestError identity', async () => {
  const blocks = await import('@civitai/app-sdk/blocks');
  const manifest = await import('@civitai/app-sdk/manifest');
  assert.equal(blocks.BlockManifestError, manifest.BlockManifestError);
});

if (failures.length > 0) {
  console.error(`\n${failures.length} export check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK: all node-only subpaths resolve against the built package.');
