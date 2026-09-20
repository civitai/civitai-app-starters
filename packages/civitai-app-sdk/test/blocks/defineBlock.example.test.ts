/**
 * The `@example` on `defineBlock` must COMPILE and RUN.
 *
 * It did neither before #330: it omitted required fields, set the server-owned
 * `iframe.src`, and lived only inside a comment, so nothing ever executed it.
 * `scripts/typecheck-readme-snippets.mjs` extracts README fences and would not
 * have caught it — JSDoc examples are outside its reach. Rather than teach that
 * 628-line extractor a second syntax, this closes the gap the cheap way: the
 * snippet is stored as a real module (`defineBlock.example.ts`) that `tsc`
 * compiles and `vitest` imports, and the guard below pins the doc comment to
 * that module CHARACTER FOR CHARACTER.
 *
 * WHY BYTE-EXACT, not a keyword check. A guard that looks for "defineBlock" or
 * "iframe" in the docblock passes while the snippet says something wrong — the
 * exact failure mode this file exists to end. Pinning the whole normalised
 * string means a reworded example fails the test; that is the price of a
 * machine-checkable claim, and the fix is to edit both sides.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { manifest } from './defineBlock.example.js';

const SRC = join(__dirname, '../../src/blocks/defineBlock.ts');
const EXAMPLE_MODULE = join(__dirname, 'defineBlock.example.ts');
const EXAMPLE_START_MARKER = '// --- EXAMPLE START ---';
/**
 * The ONE line that legitimately differs: the doc snippet names the published
 * package, the runnable module reaches into `src` so the test exercises the
 * code under test instead of a stale `dist`.
 */
const DOC_IMPORT = "import { defineBlock } from '@civitai/app-sdk/blocks';";
const MODULE_IMPORT = "import { defineBlock } from '../../src/blocks/index.js';";

/** Pull the `@example` body out of the docblock, stripping the ` * ` prefix. */
function readDocExample(): string {
  const source = readFileSync(SRC, 'utf8');
  const start = source.indexOf(' * @example\n');
  if (start === -1) throw new Error('no `@example` tag found in defineBlock.ts');
  const end = source.indexOf(' */', start);
  if (end === -1) throw new Error('unterminated docblock after `@example`');
  return source
    .slice(start + ' * @example\n'.length, end)
    .split('\n')
    .map((line) => (line.startsWith(' * ') ? line.slice(3) : line === ' *' ? '' : line))
    .join('\n')
    .trim();
}

/** Pull the runnable snippet out of the example module. */
function readRunnableExample(): string {
  const source = readFileSync(EXAMPLE_MODULE, 'utf8');
  const start = source.indexOf(EXAMPLE_START_MARKER);
  if (start === -1) throw new Error(`no ${EXAMPLE_START_MARKER} in defineBlock.example.ts`);
  return source.slice(start + EXAMPLE_START_MARKER.length).trim();
}

describe('defineBlock @example', () => {
  it('runs — the snippet is a real module the suite imports and executes', () => {
    // Importing `./defineBlock.example.js` already ran `defineBlock` at module
    // scope; had it thrown, this file would not have loaded at all. Assert on
    // the returned value so the import is not dead weight a bundler could drop.
    expect(manifest.blockId).toBe('my-block');
    expect(manifest.iframe?.minHeight).toBe(200);
    // The whole point of the #330 fix: the example carries no `iframe.src`.
    expect(manifest.iframe).not.toHaveProperty('src');
  });

  it('is byte-identical to the runnable module (modulo the import specifier)', () => {
    const fromDoc = readDocExample();
    const fromModule = readRunnableExample().replace(MODULE_IMPORT, DOC_IMPORT);
    expect(fromDoc).toBe(fromModule);
  });

  it('the extractor is wired to something — both halves are non-trivial', () => {
    // Positive control. A silently-empty extraction would make the equality
    // above pass as '' === '' and assert nothing.
    expect(readDocExample().length).toBeGreaterThan(200);
    expect(readRunnableExample().length).toBeGreaterThan(200);
    expect(readDocExample()).toContain('defineBlock({');
  });
});
