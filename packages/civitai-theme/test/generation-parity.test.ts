/**
 * GENERATION-PARITY GUARD — the committed artifacts must byte-match a fresh
 * generation. A stale hand-edit of `dist/tokens.css`, `dist/tokens.dtcg.json`
 * or `src/tokens.generated.ts` (bypassing the generator) FAILS here, so the
 * committed output can never diverge from `buildArtifacts()`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildArtifacts } from '../src/generate.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = buildArtifacts();

const CASES: { file: string; key: keyof typeof artifacts }[] = [
  { file: 'dist/tokens.css', key: 'tokens.css' },
  { file: 'dist/tokens.dtcg.json', key: 'tokens.dtcg.json' },
  { file: 'src/tokens.generated.ts', key: 'tokens.generated.ts' },
];

describe('generation parity', () => {
  for (const { file, key } of CASES) {
    it(`${file} matches a fresh generation`, () => {
      const committed = readFileSync(join(pkgRoot, file), 'utf8');
      expect(committed, `${file} is stale — run \`pnpm --filter @civitai/theme build\` and commit`).toBe(
        artifacts[key]
      );
    });
  }

  it('DTCG export is valid JSON with $value/$type on every leaf', () => {
    const dtcg = JSON.parse(artifacts['tokens.dtcg.json']) as Record<string, Record<string, unknown>>;
    for (const group of Object.values(dtcg)) {
      for (const token of Object.values(group)) {
        const t = token as Record<string, unknown>;
        expect(t.$value, 'token missing $value').toBeDefined();
        expect(t.$type, 'token missing $type').toBeDefined();
      }
    }
  });
});
