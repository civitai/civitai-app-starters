/**
 * DRIFT GUARD — the mechanism that permanently prevents the `--civitai-*`
 * tokens from silently rotting away from civitai/civitai's real Mantine theme.
 *
 * Reads civitai/civitai's LIVE `src/providers/ThemeProvider.tsx`, extracts the
 * CSS-variable-relevant fields of its `createTheme({...})` override, and asserts
 * the vendored `theme.source.ts` matches:
 *   - color palettes + `white`/`black` are byte-equal, AND
 *   - civitai STILL does not override `primaryColor`/`primaryShade`/
 *     `defaultRadius`/`fontFamily` (the fields `theme.source.ts` omits so the
 *     Mantine defaults apply).
 *
 * Availability + strictness:
 *   - `CIVITAI_REPO` (default `/home/zach/workspace/civit/civitai`) points at the
 *     civitai checkout.
 *   - `REQUIRE_DRIFT_GUARD=1` makes an absent/unreadable civitai source a test
 *     FAILURE (set in CI, which sparse-checks-out civitai/civitai). Without it,
 *     absence SKIPS gracefully with a clear message for local dev.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  civitaiThemeSource,
  DRIFT_GUARDED_ABSENT_KEYS,
  DRIFT_GUARDED_COLOR_KEYS,
} from '../src/theme.source.js';

const CIVITAI_REPO = process.env.CIVITAI_REPO ?? '/home/zach/workspace/civit/civitai';
const THEME_PROVIDER = join(CIVITAI_REPO, 'src/providers/ThemeProvider.tsx');
const REQUIRED = process.env.REQUIRE_DRIFT_GUARD === '1';
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

/**
 * Collapse nested `{...}`/`[...]` groups so only the object's TOP-LEVEL keys
 * remain visible. Lets us assert a key is absent at the theme-override top level
 * without matching the same word buried in a nested component-style block.
 */
function flattenTopLevel(body: string): string {
  let s = body;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\{[^{}]*\}/g, '{}').replace(/\[[^[\]]*\]/g, '[]');
  } while (s !== prev);
  return s;
}

const lower = (arr: readonly string[]): string[] => arr.map((s) => s.toLowerCase());

describe('theme drift guard vs civitai/civitai ThemeProvider.tsx', () => {
  it('civitai source is present (required in CI via REQUIRE_DRIFT_GUARD=1)', () => {
    if (!available) {
      if (REQUIRED) {
        throw new Error(
          `REQUIRE_DRIFT_GUARD=1 but civitai source is not readable at ${THEME_PROVIDER}. ` +
            `In CI, check out civitai/civitai (sparse: src/providers) and set CIVITAI_REPO to it.`
        );
      }
      console.warn(
        `[theme-drift] SKIPPING drift assertions: civitai source not found at ${THEME_PROVIDER}. ` +
          `Set CIVITAI_REPO to enable it locally, or REQUIRE_DRIFT_GUARD=1 to make absence a failure.`
      );
    }
    expect(true).toBe(true);
  });

  it.runIf(available)('color palettes + white/black match the live civitai theme', () => {
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
  });

  it.runIf(available)(
    'civitai still does NOT override primaryColor/primaryShade/defaultRadius/fontFamily',
    () => {
      const src = readFileSync(THEME_PROVIDER, 'utf8');
      const flat = flattenTopLevel(extractCreateThemeBody(src));
      const nowOverridden = DRIFT_GUARDED_ABSENT_KEYS.filter((key) =>
        new RegExp(`\\b${key}\\s*:`).test(flat)
      );
      if (nowOverridden.length > 0) {
        throw new Error(
          `civitai/civitai's theme now overrides ${nowOverridden.join(', ')} at the top level, but ` +
            `theme.source.ts omits ${nowOverridden.length > 1 ? 'them' : 'it'} (relying on the Mantine ` +
            `default). Vendor the new value(s) into theme.source.ts + the token spec so the derived ` +
            `--civitai-* tokens stay faithful.`
        );
      }
    }
  );
});
