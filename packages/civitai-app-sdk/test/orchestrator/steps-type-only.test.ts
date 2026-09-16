/**
 * `src/orchestrator/steps.ts` must stay TYPE-ONLY.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `@civitai/app-sdk` ships into
 * sandboxed browser iframes and every consuming app inherits its module graph.
 * `@civitai/client` carries a real runtime (`@hey-api/client-fetch`, `rfc6902`,
 * `tslib`). One `import type` losing its `type` keyword — a rename-import
 * refactor, an IDE auto-import, a `const` pulled in "just for a default" — puts
 * a fetch client into every block's bundle, and nothing else in this repo would
 * notice: the package still builds, typechecks and passes its other tests.
 *
 * So this asserts the EMITTED JAVASCRIPT, which is the thing that actually gets
 * bundled, rather than asserting the source spelling. A source-level check
 * ("every line matching /@civitai\/client/ also matches /^import type/") is
 * walkable — `import { type A, B } from '@civitai/client'` satisfies it while
 * emitting a real import. Compiling and reading the output is not.
 *
 * 🔴 WHAT THIS DOES AND DOES NOT CATCH — measured by mutation, not assumed.
 * Deleting the `type` keyword from this module's imports does NOT fail here,
 * and should not: TypeScript elides an import whose bindings are only ever used
 * in type positions, so `pnpm build` emits the same empty module either way
 * (verified — `dist/orchestrator/steps.js` is `export {};` with and without the
 * keyword). The regression that MATTERS is a binding imported and used as a
 * VALUE, which is what puts a real edge into the bundle; that is killed here by
 * both assertions, and the two POSITIVE CONTROLS below prove the check can see
 * it rather than being wired to nothing.
 *
 * The earlier draft of this comment claimed `transpileModule` "must preserve
 * any import it cannot prove is type-only". That is false, and the mutation run
 * is what said so. Left here so nobody re-derives it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const STEPS_SRC = join(HERE, '..', '..', 'src', 'orchestrator', 'steps.ts');

/**
 * The package's own emit settings, plus `removeComments`.
 *
 * `removeComments` is load-bearing, not tidiness: this module's own docblock
 * quotes `@civitai/client` and shows `import …` example lines, and tsc keeps
 * leading trivia in the output. Without it the assertions below match the
 * DOCUMENTATION instead of the code — a false red that would have been "fixed"
 * by weakening exactly the check that matters. Comments carry no bundler edge.
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  isolatedModules: true,
  removeComments: true,
};

function emit(source: string, fileName = 'steps.ts'): string {
  return ts.transpileModule(source, { compilerOptions: COMPILER_OPTIONS, fileName }).outputText;
}

describe('src/orchestrator/steps.ts is type-only', () => {
  const source = readFileSync(STEPS_SRC, 'utf8');

  it('reads a source file that really does reference @civitai/client', () => {
    // Guards against the whole suite passing because it read the wrong path,
    // or an empty file. A zero that is not distinguishable from "wired to
    // nothing" is not evidence.
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain('@civitai/client');
  });

  it('emits no import of @civitai/client', () => {
    const js = emit(source);
    expect(js).not.toContain('@civitai/client');
  });

  it('emits no imports and no runtime exports at all', () => {
    const js = emit(source);
    // `export {}` / `export type {}` may survive as an empty marker; nothing
    // else should. No `import`, no `require`, no named runtime export.
    expect(js).not.toMatch(/\bimport\s*[{*'"(]/);
    expect(js).not.toMatch(/\brequire\s*\(/);
    expect(js.replace(/export\s*\{\s*\}\s*;?/g, '').trim()).toBe('');
  });

  it('POSITIVE CONTROL: the same check catches a value import', () => {
    // If this ever stops failing, the assertions above are inert and prove
    // nothing about the real file.
    const withValueImport = [
      "import { createClient } from '@civitai/client';",
      'export const c = createClient;',
    ].join('\n');
    const js = emit(withValueImport);
    expect(js).toContain('@civitai/client');
    expect(js).toMatch(/\bimport\s*\{/);
  });

  it('POSITIVE CONTROL: catches the mixed inline-type import a source-grep would miss', () => {
    // `import { type A, B }` looks type-ish to a regex over the source but
    // emits a real runtime import, because `B` is a value.
    const mixed = [
      "import { type TextToImageStepTemplate, createClient } from '@civitai/client';",
      'export const c = createClient;',
      'export type T = TextToImageStepTemplate;',
    ].join('\n');
    expect(emit(mixed)).toContain('@civitai/client');
  });
});
