/**
 * Pins the SEAM between `@civitai/app-sdk/vite` and `@civitai/sdk` for a
 * dev-tunnel local preview (civitai/civitai-app-starters#710).
 *
 * The plugin writes the local manifest to a global on the dev server's page; the
 * SDK reads that global when the host marks the frame `storageMode:
 * 'local-preview'`. The two packages share no code, so the name is spelled in
 * each, and each package's own suite passes against its own spelling — neither
 * can see the other drift. A drift would leave every Vite app's preview with
 * `local_preview_no_manifest` while both suites stay green. So this asserts the
 * RELATIONSHIP: exactly one declaration on each side, with the same value.
 *
 * Reads source text (this lane runs before `pnpm install`), and parses the
 * declaration rather than searching for a value, so the assertion is "these two
 * are equal", never "this word appears".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(import.meta.dirname, '..', '..');
const SIDES = {
  writer: 'packages/civitai-app-sdk/src/vite/index.ts',
  reader: 'packages/civitai-sdk/src/doc-store/local-preview.ts',
};
const DECLARATION = /^export const LOCAL_PREVIEW_MANIFEST_GLOBAL = '([^']+)';$/gm;

function declared(source) {
  return [...source.matchAll(DECLARATION)].map((m) => m[1]);
}

test('the parser finds a declaration and sees a difference (controls)', () => {
  assert.deepEqual(declared("export const LOCAL_PREVIEW_MANIFEST_GLOBAL = '__A__';\n"), ['__A__']);
  assert.notDeepEqual(
    declared("export const LOCAL_PREVIEW_MANIFEST_GLOBAL = '__A__';\n"),
    declared("export const LOCAL_PREVIEW_MANIFEST_GLOBAL = '__B__';\n"),
  );
});

test('the plugin writes the global the SDK reads', () => {
  const values = Object.fromEntries(
    Object.entries(SIDES).map(([side, path]) => {
      const found = declared(readFileSync(join(ROOT, path), 'utf8'));
      assert.equal(found.length, 1, `${path}: expected exactly one LOCAL_PREVIEW_MANIFEST_GLOBAL, found ${found.length}`);
      return [side, found[0]];
    }),
  );
  assert.equal(values.writer, values.reader);
});
