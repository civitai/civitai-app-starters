/**
 * COPY GUARD — `@civitai/sdk`'s block workflow contract types are a generated
 * COPY of `@civitai/app-sdk/blocks`', and this keeps the copy current.
 *
 * WHY THIS EXISTS
 * ===============
 * `@civitai/sdk` exposes `app.workflows`, whose request body (`WorkflowBody`)
 * and replies (`BlockWorkflowSnapshot`, `AppWorkflow`) are defined in
 * `packages/civitai-app-sdk/src/blocks/types.ts`. The two packages do not depend
 * on each other (see `safe-storage-copy-parity.test.mjs` for the same decision
 * about a runtime module), so the sdk carries
 * `packages/civitai-sdk/src/workflows/types.generated.ts`, written by
 * `packages/civitai-sdk/scripts/gen-workflow-types.mjs`.
 *
 * Without a check, a body field added to app-sdk would be missing from the sdk
 * copy and nothing would say so: the host would accept a body the sdk's types
 * refuse to let a builder write. This test regenerates the copy from the source
 * and compares the WHOLE string.
 *
 * It lives here rather than only in the sdk's own CI job because this suite
 * runs on every change, including one that touches app-sdk alone.
 *
 * LIMITS
 *   - It proves the copy matches app-sdk. It cannot prove app-sdk matches the
 *     host; that is app-sdk's own contract with civitai/civitai.
 *   - The generator is a text extractor. The controls below feed it the shapes
 *     it must split correctly and the ones it must refuse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  OUT,
  ROOTS,
  SOURCE,
  renderWorkflowTypes,
  topLevelDeclarations,
  workflowTypeNames,
} from '../../packages/civitai-sdk/scripts/gen-workflow-types.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(REPO_ROOT, path), 'utf8');

const FIXTURE = [
  "import { something } from './elsewhere.js';",
  '',
  '/** A leaf. */',
  "export type Leaf = 'a' | 'b';",
  '',
  '// A section banner that belongs to no declaration.',
  '',
  '/**',
  ' * The root. Mentions {@link Unrelated} in prose only.',
  ' */',
  'export interface Root {',
  '  /** A field. */',
  '  leaf: Leaf;',
  '  nested: { deep: Middle[] };',
  '}',
  '',
  'export type Middle = {',
  '  value: number;',
  '};',
  '',
  '/** Never referenced by code. */',
  'export interface Unrelated {',
  '  x: string;',
  '}',
  '',
  'export const LIMIT = 8;',
  '',
].join('\n');

test('CONTROL — the splitter finds every top-level declaration and its doc', () => {
  const found = topLevelDeclarations(FIXTURE);
  assert.deepEqual(
    found.map((d) => [d.keyword, d.name, d.exported]),
    [
      ['type', 'Leaf', true],
      ['interface', 'Root', true],
      ['type', 'Middle', true],
      ['interface', 'Unrelated', true],
      ['const', 'LIMIT', true],
    ],
  );
  assert.equal(found[0].doc, '/** A leaf. */');
  assert.equal(found[1].code.split('\n').at(-1), '}');
  // A banner separated by a blank line is not anyone's doc.
  assert.equal(found[2].doc, '');
});

test('CONTROL — the closure follows code references, not prose, and keeps source order', () => {
  const out = renderWorkflowTypes(FIXTURE, ['Root']);
  assert.deepEqual(workflowTypeNames(out), ['Leaf', 'Root', 'Middle']);
  assert.ok(out.includes('/** A leaf. */\nexport type Leaf'), 'docs travel with their declaration');
  assert.ok(!out.includes('interface Unrelated'), 'a name only a comment mentions is not copied');
  assert.ok(!out.includes('LIMIT'), 'values are never copied');
});

test('CONTROL — a field added to a source type changes the output', () => {
  const before = renderWorkflowTypes(FIXTURE, ['Root']);
  const after = renderWorkflowTypes(FIXTURE.replace('  value: number;', '  value: number;\n  added?: string;'), ['Root']);
  assert.notEqual(before, after);
  assert.ok(after.includes('added?: string;'));
});

test('CONTROL — the generator refuses what it cannot copy faithfully', () => {
  assert.throws(() => renderWorkflowTypes(FIXTURE, ['Missing']), /Missing is not declared/);
  assert.throws(
    () => renderWorkflowTypes(FIXTURE.replace('leaf: Leaf;', 'leaf: Leaf; max: typeof LIMIT;'), ['Root']),
    /LIMIT is a const/,
  );
  assert.throws(
    () => renderWorkflowTypes(FIXTURE.replace('export type Middle', 'type Middle'), ['Root']),
    /Middle .* is not exported/,
  );
  assert.throws(
    () => renderWorkflowTypes(FIXTURE.replace('  value: number;\n};', '  value: number;'), ['Root']),
    /unbalanced/,
  );
});

test('the committed copy equals what the generator produces from app-sdk today', () => {
  const expected = renderWorkflowTypes(read(SOURCE));
  const committed = read(OUT);

  // Positive controls on the real input: the roots are all present, so an
  // extractor that silently matched nothing cannot produce an "equal" pair.
  const names = workflowTypeNames(expected);
  for (const root of ROOTS) assert.ok(names.includes(root), `${root} missing from the generated copy`);
  assert.ok(names.length >= 30, `only ${names.length} types were extracted from ${SOURCE}`);

  assert.equal(
    committed,
    expected,
    `${OUT} is stale: ${SOURCE} changed and the copy did not.\n\n` +
      'Run `pnpm --filter @civitai/sdk gen:workflow-types`, commit the result, and add any new\n' +
      'type name to the `./workflows/types.generated.js` export list in\n' +
      'packages/civitai-sdk/src/index.ts (its own test names the missing one).',
  );
});
