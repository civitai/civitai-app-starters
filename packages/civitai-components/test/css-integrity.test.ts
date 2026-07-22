/**
 * @civitai/components CSS integrity:
 *   - generation parity: dist/components.css === src/components.css, and the
 *     JS-injectable string embeds the same CSS byte-for-byte.
 *   - token discipline: the shipped CSS references `--civitai-*` tokens and
 *     NEVER the old `--ci-*` or raw `--mantine-*` names (the drift being fixed).
 *   - layering: every rule is inside `@layer civitai.components`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { componentsCss } from '../src/styles.generated.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcCss = readFileSync(join(pkgRoot, 'src/components.css'), 'utf8');
const distCss = readFileSync(join(pkgRoot, 'dist/components.css'), 'utf8');

describe('components CSS integrity', () => {
  it('dist/components.css matches the source', () => {
    expect(distCss).toBe(srcCss);
  });

  it('the JS-injectable string embeds the source CSS', () => {
    expect(componentsCss).toBe(srcCss);
  });

  it('references --civitai-* tokens', () => {
    expect(srcCss).toMatch(/var\(--civitai-color-primary\)/);
    expect((srcCss.match(/--civitai-/g) ?? []).length).toBeGreaterThan(20);
  });

  it('does NOT reference legacy --ci-* or raw --mantine-* tokens', () => {
    // `--civitai-` contains `--ci`, so assert the standalone `--ci-<word>` form
    // is absent rather than a bare substring.
    expect(srcCss).not.toMatch(/--ci-[a-z]/);
    expect(srcCss).not.toContain('--mantine-');
  });

  it('wraps all rules in @layer civitai.components', () => {
    expect(srcCss).toContain('@layer civitai.components {');
    // No selector rule should sit outside the layer: the only top-level `{`
    // block is the @layer itself. Strip the layer block and assert no stray
    // `[data-civitai-ui` selectors remain at top level.
    const withoutLayer = srcCss.replace(/@layer civitai\.components \{[\s\S]*\}\s*$/, '');
    expect(withoutLayer).not.toContain('[data-civitai-ui');
  });
});
