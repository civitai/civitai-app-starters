/**
 * `@civitai/theme` token GENERATOR.
 *
 * Feeds the vendored civitai `createTheme` override (`theme.source.ts`) through
 * Mantine's PUBLIC theme resolver — the same primitives civitai/civitai uses in
 * `mantine-css-variables.ts`:
 *   `mergeMantineTheme(DEFAULT_THEME, override)` -> `defaultCssVariablesResolver`
 *   (yields the `{ variables, light, dark }` map of `--mantine-*` values).
 * From there this generator does its OWN thing (it does NOT call Mantine's
 * `convertCssVariables`): a hand-rolled transitive `var()` resolver reduces each
 * selected Mantine variable to a concrete literal, which is then re-namespaced
 * and emitted as the `--civitai-*` CSS / typed-JS / DTCG artifacts.
 *
 * The output is a re-namespaced `--civitai-*` token contract. We deliberately
 * do NOT expose `--mantine-*` as the public surface: every `--civitai-*` value
 * is fully resolved down to a concrete literal (hex / rem), so consumers need
 * only this package's tokens, never Mantine's variables.
 *
 * `buildArtifacts()` is PURE (no fs) so both the build writer
 * (`scripts/build-tokens.ts`) and the generation-parity test consume it.
 */
import {
  DEFAULT_THEME,
  defaultCssVariablesResolver,
  mergeMantineTheme,
  type MantineThemeOverride,
} from '@mantine/core';

import { BREAKPOINT_KEYS, civitaiBreakpointsSource } from './breakpoints.source.js';
import { civitaiThemeSource } from './theme.source.js';

/** A single public token, mapped to the Mantine variable it derives from. */
interface TokenSpec {
  /** Public name WITHOUT the `--civitai-` prefix, e.g. `color-primary`. */
  name: string;
  /**
   * Source Mantine variable name (with `--mantine-` prefix). Mutually exclusive
   * with `literal` — exactly one of the two must be set.
   */
  source?: string;
  /**
   * Concrete literal value for a token that deliberately does NOT derive from
   * Mantine. Only the breakpoint scale uses this, and the reason is load-bearing:
   * civitai's px breakpoints are NOT part of its Mantine theme, and Mantine's own
   * stock EM scale disagrees with them on four of five keys (see
   * `breakpoints.source.ts`). Routing them through `mergeMantineTheme` would
   * silently resolve any un-overridden key to the wrong number, so they bypass
   * the Mantine pipeline entirely. Scheme-independent by construction.
   */
  literal?: string;
  /** Typed-syntax category — drives `@property` registration + DTCG `$type`. */
  type: 'color' | 'length' | 'font';
  description: string;
  /**
   * Force this token into the `[data-theme='dark']` block even when its resolved
   * dark value is IDENTICAL to light (the generator otherwise emits a dark
   * override only when it differs). Used for symmetry: the primary group
   * (`color-primary`/`-hover`/`-light`) all shift shade in dark, so the
   * contrast/foreground token belongs alongside them in the dark block even
   * though its value (white) happens to be scheme-independent — keeping the dark
   * block self-contained rather than silently inheriting from `:root`/light.
   */
  alwaysDark?: boolean;
}

/**
 * The curated public token contract. ORDER is significant (drives deterministic
 * CSS/JSON output). Each token derives from a real resolved Mantine variable —
 * change the map here, never hand-edit a value.
 */
const TOKEN_SPEC: readonly TokenSpec[] = [
  // --- Typography / shape (color-scheme independent) ---
  {
    name: 'font',
    source: '--mantine-font-family',
    type: 'font',
    description: 'Base UI font stack (Mantine default system stack).',
  },
  {
    name: 'font-mono',
    source: '--mantine-font-family-monospace',
    type: 'font',
    description: 'Monospace font stack.',
  },
  {
    name: 'radius',
    source: '--mantine-radius-default',
    type: 'length',
    description: "Default corner radius (civitai leaves Mantine's `sm` default).",
  },
  // --- Semantic surfaces / text (color-scheme dependent) ---
  {
    name: 'color-text',
    source: '--mantine-color-text',
    type: 'color',
    description: 'Primary body text color.',
  },
  {
    name: 'color-text-dimmed',
    source: '--mantine-color-dimmed',
    type: 'color',
    description: 'Secondary / muted text color.',
  },
  {
    name: 'color-body',
    source: '--mantine-color-body',
    type: 'color',
    description:
      'Page / document background (derived from Mantine\'s `--mantine-color-body`). Use for `body { background }` in plain-HTML apps.',
  },
  {
    name: 'color-surface',
    source: '--mantine-color-body',
    type: 'color',
    description: 'Primary surface / page background.',
  },
  {
    name: 'color-surface-2',
    source: '--mantine-color-default',
    type: 'color',
    description: 'Secondary surface (inputs, insets).',
  },
  {
    name: 'color-border',
    source: '--mantine-color-default-border',
    type: 'color',
    description: 'Default border / divider color.',
  },
  // --- Primary accent (blue @ civitai primaryShade {light:6,dark:8}) ---
  {
    name: 'color-primary',
    source: '--mantine-primary-color-filled',
    type: 'color',
    description: 'Primary accent (filled) color.',
  },
  {
    name: 'color-primary-hover',
    source: '--mantine-primary-color-filled-hover',
    type: 'color',
    description: 'Primary accent hover color.',
  },
  {
    name: 'color-primary-fg',
    source: '--mantine-primary-color-contrast',
    type: 'color',
    description: 'Foreground/text color on a filled primary surface.',
    // Emit in the dark block too (value is white in both schemes) so the dark
    // primary group is symmetric with light. See TokenSpec.alwaysDark.
    alwaysDark: true,
  },
  {
    name: 'color-primary-light',
    source: '--mantine-primary-color-light',
    type: 'color',
    description: 'Translucent primary tint (light variant background).',
  },
  // --- Semantic status colors ---
  {
    name: 'color-error',
    source: '--mantine-color-error',
    type: 'color',
    description: 'Error / destructive color.',
  },
  {
    name: 'color-success',
    source: '--mantine-color-success-filled',
    type: 'color',
    description: "Success color (civitai's custom `success` palette).",
  },
  {
    name: 'color-warning',
    source: '--mantine-color-orange-filled',
    type: 'color',
    description: 'Warning color (derived from the orange palette).',
  },
  {
    name: 'color-info',
    source: '--mantine-color-blue-filled',
    type: 'color',
    description: 'Informational color (derived from the blue palette).',
  },
  // --- Neutral ramp (issue #181 F7) ---
  // The full 10-step Mantine `gray` ramp, exposed as --civitai-color-gray-0…-9
  // so consumers mapping a 10-step neutral scale (e.g. a Tailwind gray/neutral
  // ramp) onto the design system don't collapse it onto the ~4 semantic
  // neutrals. Each step derives from the resolved `--mantine-color-gray-N`
  // (the vendored, drift-guarded civitai `gray` tuple) — GENERATED, never
  // hand-authored. The ramp is a raw palette (scheme-independent), so the
  // generator emits no dark override (light == dark) — correct and intentional.
  ...Array.from({ length: 10 }, (_v, i): TokenSpec => ({
    name: `color-gray-${i}`,
    source: `--mantine-color-gray-${i}`,
    type: 'color',
    description: `Neutral ramp step ${i} (Mantine gray[${i}]); 0 = lightest … 9 = darkest.`,
  })),
  // --- Responsive breakpoint scale (issue #279 R2) ---
  // 🔴 THE PX SCALE (civitai `src/utils/breakpoints.json`), NOT Mantine's stock em
  // scale. The two agree only on `sm` (768). These are `literal` specs precisely so
  // they cannot pick up an em value from the Mantine resolver — see TokenSpec.literal
  // and the header of `breakpoints.source.ts`. Appended LAST so the pre-existing
  // token order (and therefore every existing artifact byte) is unchanged.
  ...BREAKPOINT_KEYS.map(
    (key): TokenSpec => ({
      name: `bp-${key}`,
      literal: civitaiBreakpointsSource[key],
      type: 'length',
      description:
        `Responsive breakpoint \`${key}\` from civitai's px scale ` +
        `(src/utils/breakpoints.json) — NOT Mantine's em scale.`,
    })
  ),
] as const;

type VarDict = Record<string, string>;

const VAR_RE = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)/;

/**
 * Resolve a raw CSS value to a concrete literal by transitively substituting
 * every `var(--mantine-*)` reference from `dict`. Uses the declared fallback
 * when a referenced variable is absent; throws on a genuinely unresolvable
 * reference (a real bug, not something to paper over).
 */
function resolveValue(raw: string, dict: VarDict, trail: string[] = []): string {
  let value = raw.trim();
  let guard = 0;
  while (VAR_RE.test(value)) {
    if (guard++ > 50) {
      throw new Error(`Cyclic/overlong var() resolution for "${raw}" (trail: ${trail.join(' -> ')})`);
    }
    value = value.replace(VAR_RE, (_m, name: string, fallback?: string) => {
      if (Object.prototype.hasOwnProperty.call(dict, name)) {
        if (trail.includes(name)) {
          throw new Error(`Cyclic var() reference at ${name} (trail: ${trail.join(' -> ')})`);
        }
        return resolveValue(dict[name]!, dict, [...trail, name]);
      }
      if (fallback != null) return fallback.trim();
      throw new Error(`Unresolved CSS variable ${name} while resolving "${raw}"`);
    });
  }
  // Collapse Mantine's trivial scale wrapper `calc(<x> * 1)` / `calc(1 * <x>)`
  // (scale defaults to 1) to the bare value — exact, and keeps radius a clean
  // dimension token rather than a calc() expression.
  value = value
    .trim()
    .replace(/^calc\(\s*([^*()]+?)\s*\*\s*1\s*\)$/, '$1')
    .replace(/^calc\(\s*1\s*\*\s*([^*()]+?)\s*\)$/, '$1');
  return value.trim();
}

export interface ResolvedTokens {
  /** Base + light-scheme value keyed by the FULL `--civitai-*` var name. */
  root: Record<string, string>;
  /** Dark-scheme overrides (only tokens whose value differs from light). */
  dark: Record<string, string>;
  /** Per-token metadata in spec order. */
  meta: { varName: string; camel: string; type: TokenSpec['type']; description: string }[];
}

const camel = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/** Resolve the token spec against the vendored theme into concrete values. */
export function resolveTokens(themeOverride: MantineThemeOverride = civitaiThemeSource): ResolvedTokens {
  const theme = mergeMantineTheme(DEFAULT_THEME, themeOverride);
  const resolved = defaultCssVariablesResolver(theme);

  const lightDict: VarDict = { ...resolved.variables, ...resolved.light };
  const darkDict: VarDict = { ...resolved.variables, ...resolved.dark };

  const root: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const meta: ResolvedTokens['meta'] = [];

  for (const spec of TOKEN_SPEC) {
    const varName = `--civitai-${spec.name}`;
    if ((spec.source == null) === (spec.literal == null)) {
      throw new Error(
        `Token ${varName}: exactly one of \`source\` (Mantine-derived) or \`literal\` must be set.`
      );
    }
    // A `literal` spec is scheme-independent by construction and NEVER touches the
    // Mantine dicts — that bypass is the whole point for the breakpoint scale.
    const lightVal =
      spec.literal ?? resolveValue(`var(${spec.source})`, lightDict);
    const darkVal = spec.literal ?? resolveValue(`var(${spec.source})`, darkDict);
    root[varName] = lightVal;
    if (darkVal !== lightVal || spec.alwaysDark) dark[varName] = darkVal;
    meta.push({ varName, camel: camel(spec.name), type: spec.type, description: spec.description });
  }

  return { root, dark, meta };
}

/** Parse `"0.25rem"` / `"4px"` into a DTCG 2025.10 dimension object. */
function toDtcgDimension(value: string): { value: number; unit: string } | string {
  const m = /^(-?[\d.]+)(px|rem|em)$/.exec(value.trim());
  if (!m) return value;
  return { value: Number(m[1]), unit: m[2]! };
}

export interface Artifacts {
  'tokens.css': string;
  'tokens.dtcg.json': string;
  /** Generated TS module (compiled by tsc into dist/tokens.generated.js/.d.ts). */
  'tokens.generated.ts': string;
}

const AUTOGEN_BANNER =
  '/* AUTOGENERATED by @civitai/theme (scripts/build-tokens.ts). DO NOT EDIT.\n' +
  '   Regenerate: pnpm --filter @civitai/theme build. Guarded by generation-parity test. */';

/** Build every artifact string. PURE — no fs. */
export function buildArtifacts(themeOverride: MantineThemeOverride = civitaiThemeSource): Artifacts {
  const { root, dark, meta } = resolveTokens(themeOverride);

  // ---- tokens.css ----
  // Register only `<color>` tokens with @property: their hex/rgba values are
  // computationally-independent (valid `initial-value`). Length tokens (radius)
  // resolve to rem, which is font-relative and therefore NOT a valid
  // @property initial-value, so registering them would make the browser drop
  // the whole rule — we skip them and rely on the plain custom-property
  // declaration (which applies identically). `font` is untyped.
  const propertyRules = meta
    .filter((m) => m.type === 'color')
    .map((m) => {
      const initial = root[m.varName]!;
      return `@property ${m.varName} {\n  syntax: '<color>';\n  inherits: true;\n  initial-value: ${initial};\n}`;
    })
    .join('\n');

  const rootBlock = meta.map((m) => `  ${m.varName}: ${root[m.varName]};`).join('\n');
  // Explicit light block mirrors the :root defaults so `[data-theme='light']`
  // (used by @civitai/components) always wins over an ambient dark ancestor.
  const lightBlock = meta.map((m) => `  ${m.varName}: ${root[m.varName]};`).join('\n');
  const darkBlock = meta
    .filter((m) => m.varName in dark)
    .map((m) => `  ${m.varName}: ${dark[m.varName]};`)
    .join('\n');

  const tokensCss =
    `${AUTOGEN_BANNER}\n` +
    `${propertyRules}\n\n` +
    `:root {\n${rootBlock}\n}\n\n` +
    `[data-theme='light'] {\n${lightBlock}\n}\n\n` +
    `[data-theme='dark'] {\n${darkBlock}\n}\n`;

  // ---- tokens.dtcg.json (W3C DTCG 2025.10) ----
  const dtcg: Record<string, Record<string, unknown>> = {};
  for (const m of meta) {
    const [group, ...restParts] = m.camel.replace(/([A-Z])/g, ' $1').trim().split(' ');
    // Group by leading segment of the token name (color / font / radius).
    const segParts = m.varName.replace('--civitai-', '').split('-');
    const groupKey = segParts[0]!;
    const leafKey = camel(segParts.slice(1).join('-')) || groupKey;
    void group;
    void restParts;
    const $type = m.type === 'color' ? 'color' : m.type === 'length' ? 'dimension' : 'fontFamily';
    const lightVal = root[m.varName]!;
    const token: Record<string, unknown> = {
      $type,
      $value: $type === 'dimension' ? toDtcgDimension(lightVal) : lightVal,
      $description: m.description,
    };
    if (m.varName in dark) {
      token.$extensions = {
        'com.civitai.theme': {
          dark: $type === 'dimension' ? toDtcgDimension(dark[m.varName]!) : dark[m.varName],
        },
      };
    }
    (dtcg[groupKey] ??= {})[leafKey] = token;
  }
  const tokensDtcgJson = JSON.stringify(dtcg, null, 2) + '\n';

  // ---- tokens.generated.ts (typed JS export) ----
  const tokensObj = Object.fromEntries(meta.map((m) => [m.camel, root[m.varName]!]));
  const darkObj = Object.fromEntries(
    meta.filter((m) => m.varName in dark).map((m) => [m.camel, dark[m.varName]!])
  );
  const varsObj = Object.fromEntries(meta.map((m) => [m.camel, `var(${m.varName})`]));

  const tokensGeneratedTs =
    `${AUTOGEN_BANNER}\n\n` +
    `/** Resolved light/base token values, keyed by camelCase name. */\n` +
    `export const tokens = ${JSON.stringify(tokensObj, null, 2)} as const;\n\n` +
    `/** Dark-scheme overrides (only tokens that differ from light). */\n` +
    `export const darkTokens = ${JSON.stringify(darkObj, null, 2)} as const;\n\n` +
    `/** \`var(--civitai-*)\` reference strings for inline JS styling. */\n` +
    `export const tokenVars = ${JSON.stringify(varsObj, null, 2)} as const;\n\n` +
    `/** The full \`--civitai-*\` stylesheet (\`:root\` + light/dark). Also emitted to dist/tokens.css. */\n` +
    `export const tokensCss = ${JSON.stringify(tokensCss)};\n\n` +
    `export type TokenName = keyof typeof tokens;\n`;

  return {
    'tokens.css': tokensCss,
    'tokens.dtcg.json': tokensDtcgJson,
    'tokens.generated.ts': tokensGeneratedTs,
  };
}
