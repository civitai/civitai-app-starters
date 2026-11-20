import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `src/` is the generic runner (civitai's `apps/assistant-runner/src/core/`, published on its own): a
 * deployment reaches it only through the seams in `src/interfaces.ts` and the options of `Runner` and
 * `buildRunApp`. So nothing under it may import a file outside it, nor a package other than the ones
 * listed here, which are exactly what `package.json` declares (the last test pins that).
 */
const CORE = fileURLToPath(new URL('../src', import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url));

/** The packages `src/` may import, by package name (a subpath of one is that package). */
const CORE_PACKAGES = [
  '@civitai/components-chat',
  '@dbos-inc/dbos-sdk',
  'ai',
  'fastify',
  'pg',
  'zod',
] as const;

/**
 * Every module specifier a TypeScript source names: static, type-only, re-export, side-effect,
 * dynamic and `require`, as TypeScript's own pre-processor reads them. Not a regex: SQL text such as
 * `from "${SCHEMA}".streams` inside a template string reads as an import to one.
 */
function specifiers(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
}

function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** Why each import of `file` (a path under `core`) crosses the boundary; empty when none does. */
function coreBoundaryViolations(core: string, file: string, source: string): string[] {
  const where = path.relative(core, file);
  const violations: string[] = [];
  for (const specifier of specifiers(source)) {
    if (specifier.startsWith('.')) {
      const target = path.resolve(path.dirname(file), specifier);
      if (target !== core && !target.startsWith(core + path.sep))
        violations.push(`core-boundary: ${where} imports '${specifier}', outside src/`);
    } else if (!specifier.startsWith('node:')) {
      const name = packageOf(specifier);
      if (!(CORE_PACKAGES as readonly string[]).includes(name))
        violations.push(
          `core-boundary: ${where} imports package '${name}', not one of core's dependencies`
        );
    }
  }
  return violations;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

describe('src/ boundary', () => {
  it('nothing under src/ imports from outside it', () => {
    const files = sources(CORE);
    const names = files.map((file) => path.relative(CORE, file));
    // The scan reads the runner itself, not an empty or wrong directory.
    expect(names).toEqual(
      expect.arrayContaining(['runner.ts', 'interfaces.ts', 'app.ts', 'test-support/fakes.ts'])
    );
    const all = files.flatMap((file) => specifiers(readFileSync(file, 'utf8')));
    // And it parses their imports: relative ones within src, and packages.
    expect(all.filter((specifier) => specifier.startsWith('./')).length).toBeGreaterThan(20);
    expect(all).toContain('@dbos-inc/dbos-sdk');
    const violations = files.flatMap((file) =>
      coreBoundaryViolations(CORE, file, readFileSync(file, 'utf8'))
    );
    expect(violations).toEqual([]);
  });

  it('names every import that leaves src/ (negative controls)', () => {
    const file = path.join(CORE, 'runner.ts');
    const nested = path.join(CORE, 'test-support', 'fakes.ts');
    const crossing = [
      `import type { VerifiedGrant } from '../tokens';`,
      `import {\n  RunGrants,\n} from '../grants';`,
      `export * from '../minter';`,
      `export { x } from "../app-assistant/provider";`,
      `const m = await import('../orchestration');`,
      `const c = require('../config');`,
      `import '../server';`,
      `import { GOLDEN } from '../test/golden/reply-dbos-calls.js';`,
    ];
    for (const source of crossing)
      expect(coreBoundaryViolations(CORE, file, source), source).toHaveLength(1);
    expect(coreBoundaryViolations(CORE, nested, `import x from '../../tokens';`)).toEqual([
      `core-boundary: test-support/fakes.ts imports '../../tokens', outside src/`,
    ]);
    expect(
      coreBoundaryViolations(CORE, file, `import { x } from '@civitai/app-assistant';`)
    ).toEqual([
      `core-boundary: runner.ts imports package '@civitai/app-assistant', not one of core's dependencies`,
    ]);
    expect(coreBoundaryViolations(CORE, file, `import { jwtVerify } from 'jose';`)).toHaveLength(1);
  });

  it('lets src/ import itself, node built-ins and its own packages', () => {
    const file = path.join(CORE, 'test-support', 'fakes.ts');
    const fine = [
      `import type { ToolProvider } from '../interfaces.js';`,
      `import { runIdFor } from '../run-ids.js';`,
      `import { scriptedModel } from './scripted-model.js';`,
      `import { createHash } from 'node:crypto';`,
      `import { MockLanguageModelV3 } from 'ai/test';`,
      `import type { TurnPart } from '@civitai/components-chat/core';`,
      // Not imports: SQL in a template string, and a comment.
      'const q = `select 1 from "${SCHEMA}".streams`;',
      `// moved from '../tokens'`,
    ];
    for (const source of fine)
      expect(coreBoundaryViolations(CORE, file, source), source).toEqual([]);
  });

  it('allows exactly the packages package.json declares (dependencies and peers)', () => {
    // The relationship, not one side of it: a package src/ imports but the published
    // package.json does not declare installs nowhere for a consumer, and a declared one src/
    // no longer imports is weight every consumer carries.
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ].filter((name) => !name.startsWith('@types/'));
    expect([...declared].sort()).toEqual([...CORE_PACKAGES].sort());
    // And what src/ really imports, not only the list above: a package nothing imports any more
    // fails here too.
    const imported = new Set(
      sources(CORE)
        .flatMap((file) => specifiers(readFileSync(file, 'utf8')))
        .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
        .map(packageOf)
    );
    expect([...imported].sort()).toEqual([...declared].sort());
  });
});
