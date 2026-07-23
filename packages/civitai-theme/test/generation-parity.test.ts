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

import { buildArtifacts, resolveTokens } from '../src/generate.js';
import { civitaiThemeSource } from '../src/theme.source.js';

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

  // --- issue #181 F8: the dark theme block must carry --civitai-color-primary-fg
  // for symmetry with light (it was previously omitted because its resolved dark
  // value equals light and the generator skips equal-value dark overrides). It is
  // now force-emitted via TokenSpec.alwaysDark — GENERATED, not hand-authored.
  describe('dark --civitai-color-primary-fg symmetry (#181 F8)', () => {
    const PRIMARY_FG = '--civitai-color-primary-fg';
    const { root, dark } = resolveTokens();

    it('is emitted into the dark map, derived (white), matching the light contrast color', () => {
      expect(dark, `${PRIMARY_FG} must be present in the dark block`).toHaveProperty(PRIMARY_FG);
      // Derived from Mantine's --mantine-primary-color-contrast in the dark
      // scheme; the contrast on both primary shades is white.
      expect(dark[PRIMARY_FG]).toBe('#fefefe');
      // Same value as light (symmetry, not a different color).
      expect(dark[PRIMARY_FG]).toBe(root[PRIMARY_FG]);
    });

    it("appears in the generated [data-theme='dark'] CSS block", () => {
      const css = artifacts['tokens.css'];
      const darkBlock = /\[data-theme='dark'\] \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
      expect(darkBlock, "dark block must declare --civitai-color-primary-fg").toContain(
        `${PRIMARY_FG}: #fefefe;`
      );
    });

    it('leaves the light/:root value unchanged (#fefefe)', () => {
      expect(root[PRIMARY_FG]).toBe('#fefefe');
    });
  });

  // --- issue #181 F7: the full 10-step Mantine gray ramp is exposed as
  // --civitai-color-gray-0…-9, GENERATED from the vendored (drift-guarded) gray
  // tuple via the token pipeline — never hand-authored. These assertions pin
  // presence, count, provenance (each step == Mantine gray[N]), and that the
  // ramp is additive (the pre-existing semantic neutrals are untouched).
  describe('neutral gray ramp (#181 F7)', () => {
    const { root, dark } = resolveTokens();
    const grayTuple = (civitaiThemeSource.colors as Record<string, readonly string[]>).gray!;

    it('emits all 10 --civitai-color-gray-N tokens into :root', () => {
      for (let i = 0; i < 10; i++) {
        expect(root, `--civitai-color-gray-${i} must be present`).toHaveProperty(
          `--civitai-color-gray-${i}`
        );
      }
      const grayVars = Object.keys(root).filter((k) => /^--civitai-color-gray-\d$/.test(k));
      expect(grayVars, 'exactly 10 gray ramp steps').toHaveLength(10);
    });

    it('each step is GENERATED from the vendored Mantine gray[N] tuple', () => {
      for (let i = 0; i < 10; i++) {
        expect(
          root[`--civitai-color-gray-${i}`]!.toLowerCase(),
          `gray-${i} must derive from Mantine gray[${i}]`
        ).toBe(grayTuple[i]!.toLowerCase());
      }
    });

    it('is a raw palette — scheme-independent (no dark overrides emitted)', () => {
      for (let i = 0; i < 10; i++) {
        expect(dark, `gray-${i} must NOT be in the dark block (light == dark)`).not.toHaveProperty(
          `--civitai-color-gray-${i}`
        );
      }
    });

    it('appears in the generated tokens.css :root + typed JS export, only as --civitai-*', () => {
      const css = artifacts['tokens.css'];
      for (let i = 0; i < 10; i++) {
        expect(css).toContain(`--civitai-color-gray-${i}: ${grayTuple[i]};`);
      }
      // css-integrity: the resolved stylesheet references no raw --mantine-* names.
      expect(css).not.toContain('--mantine-');
      const ts = artifacts['tokens.generated.ts'];
      for (let i = 0; i < 10; i++) expect(ts).toContain(`"colorGray${i}"`);
    });

    it('is ADDITIVE — the pre-existing semantic neutrals are unchanged', () => {
      expect(root['--civitai-color-border']).toBe('#ced4da');
      expect(root['--civitai-color-surface']).toBe('#fefefe');
      expect(root['--civitai-color-text-dimmed']).toBe('#868e96');
    });
  });

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
