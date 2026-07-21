/**
 * DRIFT GUARD — the mechanism that permanently prevents the `--civitai-*`
 * tokens from silently rotting away from civitai/civitai's real Mantine theme.
 *
 * Reads civitai/civitai's LIVE `src/providers/ThemeProvider.tsx`, extracts the
 * CSS-variable-relevant fields of its `createTheme({...})` override (color
 * palettes + `white`/`black`), and asserts the vendored `theme.source.ts`
 * matches. If civitai changes a palette value, this FAILS with a precise diff.
 *
 * The civitai checkout path is configurable via `CIVITAI_REPO`
 * (default `/home/zach/workspace/civit/civitai`). If it is absent, the test
 * SKIPS with a clear message (so the suite still runs on a machine without the
 * civitai source) rather than failing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { civitaiThemeSource, DRIFT_GUARDED_COLOR_KEYS } from '../src/theme.source.js';

const CIVITAI_REPO = process.env.CIVITAI_REPO ?? '/home/zach/workspace/civit/civitai';
const THEME_PROVIDER = join(CIVITAI_REPO, 'src/providers/ThemeProvider.tsx');
const available = existsSync(THEME_PROVIDER);

/** Slice out the `{...}` object body of `createTheme( ... )`, brace-balanced. */
function extractCreateThemeBody(src: string): string {
  const start = src.indexOf('createTheme(');
  if (start === -1) throw new Error('createTheme( not found in ThemeProvider.tsx');
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error('Unbalanced braces in createTheme(...)');
}

/** Slice the brace-balanced body that follows a `<key>: {` inside `src`. */
function extractObjectBlock(src: string, key: string): string {
  const re = new RegExp(`\\b${key}\\s*:\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`key ${key}: {...} not found`);
  const braceStart = src.indexOf('{', m.index);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error(`Unbalanced braces for ${key}`);
}

/** Parse a `key: [ '#aaa', '#bbb', … ]` tuple into a lowercased hex array. */
function extractTuple(src: string, key: string): string[] {
  const re = new RegExp(`\\b${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`);
  const m = re.exec(src);
  if (!m) throw new Error(`color tuple ${key} not found`);
  return [...m[1]!.matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => (x[1] ?? x[2]!).toLowerCase());
}

function extractStringField(src: string, key: string): string {
  const re = new RegExp(`\\b${key}\\s*:\\s*'([^']+)'`);
  const m = re.exec(src);
  if (!m) throw new Error(`string field ${key} not found`);
  return m[1]!.toLowerCase();
}

const lower = (arr: readonly string[]): string[] => arr.map((s) => s.toLowerCase());

describe('theme drift guard vs civitai/civitai ThemeProvider.tsx', () => {
  it.runIf(available)(
    'every vendored color palette + white/black matches the live civitai theme',
    () => {
      const src = readFileSync(THEME_PROVIDER, 'utf8');
      const themeBody = extractCreateThemeBody(src);
      const colorsBlock = extractObjectBlock(themeBody, 'colors');

      const vendoredColors = civitaiThemeSource.colors as Record<string, readonly string[]>;
      const mismatches: string[] = [];

      for (const key of DRIFT_GUARDED_COLOR_KEYS) {
        const live = extractTuple(colorsBlock, key);
        const vendored = lower(vendoredColors[key] ?? []);
        if (JSON.stringify(live) !== JSON.stringify(vendored)) {
          mismatches.push(
            `  colors.${key}:\n    live     = ${JSON.stringify(live)}\n    vendored = ${JSON.stringify(vendored)}`
          );
        }
      }

      // white / black are top-level fields of the override (outside `colors`).
      // Search the theme body but exclude the colors block to avoid a stray match.
      const themeBodyNoColors = themeBody.replace(colorsBlock, '');
      const liveWhite = extractStringField(themeBodyNoColors, 'white');
      const liveBlack = extractStringField(themeBodyNoColors, 'black');
      if (liveWhite !== String(civitaiThemeSource.white).toLowerCase()) {
        mismatches.push(`  white: live=${liveWhite} vendored=${String(civitaiThemeSource.white)}`);
      }
      if (liveBlack !== String(civitaiThemeSource.black).toLowerCase()) {
        mismatches.push(`  black: live=${liveBlack} vendored=${String(civitaiThemeSource.black)}`);
      }

      if (mismatches.length > 0) {
        throw new Error(
          `theme.source.ts has DRIFTED from civitai/civitai's live theme.\n` +
            `Re-vendor the changed fields into packages/civitai-theme/src/theme.source.ts, ` +
            `then rebuild (\`pnpm --filter @civitai/theme build\`).\nMismatches:\n${mismatches.join('\n')}`
        );
      }
    }
  );

  it('reports SKIP context when the civitai checkout is absent', () => {
    if (!available) {
      // Not a failure — makes the skip visible & actionable in CI logs.
      console.warn(
        `[theme-drift] SKIPPED: civitai source not found at ${THEME_PROVIDER}. ` +
          `Set CIVITAI_REPO to enable the drift guard.`
      );
    }
    expect(true).toBe(true);
  });
});
