import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * TWO FLAVOURS OF `WorkflowStatus` EXISTED, AND ONLY THE `/blocks` ONE KEEPS
 * THE NAME.
 *
 *   `src/orchestrator/index.ts` — the orchestrator's own wire statuses
 *     (`'pending' | 'processing' | 'succeeded' | …`), re-exported from the
 *     PACKAGE ROOT via `export * from './orchestrator/index.js'`.
 *   `src/blocks/types.ts`      — the block-side hook status
 *     (`'idle' | 'estimating' | …`), subpath-only, 27 call sites across the
 *     starters and the fleet apps.
 *
 * Same bare name, two unrelated unions, one of them on the default import
 * surface. The orchestrator side is renamed to `OrchestratorWorkflowStatus`;
 * the `/blocks` side is deliberately untouched.
 *
 * 🔴 THIS IS A RELATIONSHIP, NOT A SPELLING, so the root assertion below walks
 * the root's actual re-export graph rather than grepping one file. Adding a
 * bare `WorkflowStatus` to ANY module the root re-exports — `types.ts`,
 * `oauth/`, a new sibling — must fail this, not just re-adding it to
 * `orchestrator/`.
 */

const SRC = new URL('../../src/', import.meta.url);

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, SRC)), 'utf8');
}

/** Modules the package ROOT (`src/index.ts`) re-exports wholesale. */
function rootReexportedModules(): string[] {
  const index = read('index.ts');
  const specifiers = [...index.matchAll(/^export (?:type )?\* from '([^']+)';$/gm)].map(
    (m) => m[1]!,
  );
  // `./oauth/index.js` -> `oauth/index.ts`
  return specifiers.map((s) => s.replace(/^\.\//, '').replace(/\.js$/, '.ts'));
}

/** Exported type/interface names declared in one module's source. */
function exportedTypeNames(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^export (?:type|interface) (\w+)/gm)].map((m) => m[1]!),
  );
}

describe('WorkflowStatus naming', () => {
  it('re-exports at least three modules from the root (control for the walk below)', () => {
    // Without this, a regex that silently matched nothing would make the
    // "no bare WorkflowStatus" assertion vacuously true.
    expect(rootReexportedModules().length).toBeGreaterThanOrEqual(3);
  });

  it('exposes no bare `WorkflowStatus` from the package root', () => {
    const offenders = rootReexportedModules().filter((m) =>
      exportedTypeNames(read(m)).has('WorkflowStatus'),
    );
    expect(
      offenders,
      'the root surface must not carry a bare `WorkflowStatus` — it collides with the /blocks flavour',
    ).toEqual([]);
  });

  it('names the orchestrator status `OrchestratorWorkflowStatus`', () => {
    expect(exportedTypeNames(read('orchestrator/index.ts'))).toContain(
      'OrchestratorWorkflowStatus',
    );
  });

  it('leaves the /blocks flavour named `WorkflowStatus`', () => {
    // A guard against an over-eager codemod: `/blocks` has 27 call sites and is
    // explicitly out of scope for the rename.
    expect(
      exportedTypeNames(read('blocks/types.ts')),
      'the /blocks WorkflowStatus must keep its name',
    ).toContain('WorkflowStatus');
    expect(read('blocks/index.ts')).toContain('WorkflowStatus,');
  });
});
