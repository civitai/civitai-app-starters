/**
 * VENDORED civitai theme override — the GENERATOR INPUT for `@civitai/theme`.
 *
 * This is a byte-faithful copy of the CSS-variable-relevant fields of the
 * `createTheme({...})` override in civitai/civitai's
 * `src/providers/ThemeProvider.tsx`. civitai/civitai is NOT published as a
 * package, so we vendor the override here and feed it through Mantine's public
 * theme -> CSS-variable pipeline (see `generate.ts`) to derive the `--civitai-*`
 * token contract.
 *
 * ONLY the fields that influence Mantine's resolved CSS variables are vendored:
 *   - `colors`  (palette tuples — incl. civitai's custom `success`/`accent`/… )
 *   - `white` / `black`
 *   - `primaryColor` / `primaryShade` / `defaultRadius` / `fontFamily`
 *     (civitai does NOT override these, so they are ABSENT here and the
 *      Mantine defaults apply — that is intentional and faithful).
 *
 * The override's `components: {...}` block (Modal.extend, defaultProps, …) is
 * deliberately NOT vendored: component styles/defaultProps do not participate
 * in `defaultCssVariablesResolver`, so they cannot affect the token output.
 *
 * A drift-guard test (`test/theme-drift.test.ts`) reads civitai/civitai's live
 * `ThemeProvider.tsx` and FAILS if any vendored value below diverges from it —
 * so this copy can never silently rot.
 */
import type { MantineThemeOverride } from '@mantine/core';

export const civitaiThemeSource: MantineThemeOverride = {
  colors: {
    dark: [
      '#C1C2C5',
      '#A6A7AB',
      '#8c8fa3',
      '#5C5F66',
      '#373A40',
      '#2C2E33',
      '#25262B',
      '#1A1B1E',
      '#141517',
      '#101113',
    ],
    gray: [
      '#f8f9fa',
      '#f1f3f5',
      '#e9ecef',
      '#dee2e6',
      '#ced4da',
      '#adb5bd',
      '#868e96',
      '#495057',
      '#343a40',
      '#212529',
    ],
    yellow: [
      '#FFF9DB',
      '#FFF3BF',
      '#FFEC99',
      '#FFE066',
      '#FFD43B',
      '#FCC419',
      '#FAB005',
      '#F59F00',
      '#F08C00',
      '#E67700',
    ],
    green: [
      '#EBFBEE',
      '#D3F9D8',
      '#B2F2BB',
      '#8CE99A',
      '#69DB7C',
      '#51CF66',
      '#40C057',
      '#37B24D',
      '#2F9E44',
      '#2B8A3E',
    ],
    blue: [
      '#E7F5FF',
      '#D0EBFF',
      '#A5D8FF',
      '#74C0FC',
      '#4DABF7',
      '#339AF0',
      '#228BE6',
      '#1C7ED6',
      '#1971C2',
      '#1864AB',
    ],
    red: [
      '#fff5f5',
      '#ffe3e3',
      '#ffc9c9',
      '#ffa8a8',
      '#ff8787',
      '#ff6b6b',
      '#fa5252',
      '#f03e3e',
      '#e03131',
      '#c92a2a',
    ],
    orange: [
      '#fff4e6',
      '#ffe8cc',
      '#ffd8a8',
      '#ffc078',
      '#ffa94d',
      '#ff922b',
      '#fd7e14',
      '#f76707',
      '#e8590c',
      '#d9480f',
    ],
    lime: [
      '#f4fce3',
      '#e9fac8',
      '#d8f5a2',
      '#c0eb75',
      '#a9e34b',
      '#94d82d',
      '#82c91e',
      '#74b816',
      '#66a80f',
      '#5c940d',
    ],
    gold: [
      '#F6EDDF',
      '#F2E4CF',
      '#EDDBBF',
      '#E9D2AF',
      '#E5C99F',
      '#E0C08F',
      '#DCB77F',
      '#D8AE6F',
      '#D3A55F',
      '#CD9848',
    ],
    accent: [
      '#F4F0EA',
      '#E8DBCA',
      '#E2C8A9',
      '#E3B785',
      '#EBA95C',
      '#FC9C2D',
      '#E48C27',
      '#C37E2D',
      '#A27036',
      '#88643B',
    ],
    success: [
      '#9EC3B8',
      '#84BCAC',
      '#69BAA2',
      '#4CBD9C',
      '#32BE95',
      '#1EBD8E',
      '#299C7A',
      '#2F826A',
      '#326D5C',
      '#325D51',
    ],
  },
  white: '#fefefe',
  black: '#222',
  respectReducedMotion: true,
};

/**
 * The subset of theme fields the drift-guard compares against civitai/civitai's
 * live source. Kept in one place so the guard and the vendored object cannot
 * disagree about scope.
 */
export const DRIFT_GUARDED_COLOR_KEYS = [
  'dark',
  'gray',
  'yellow',
  'green',
  'blue',
  'red',
  'orange',
  'lime',
  'gold',
  'accent',
  'success',
] as const;

/**
 * Theme fields civitai deliberately does NOT override today, so the derived
 * `--civitai-*` tokens fall back to the Mantine defaults (blue primary,
 * primaryShade {light:6,dark:8}, `sm` radius, the system font stack). This
 * vendored source omits them on purpose. The drift guard asserts civitai's live
 * `ThemeProvider.tsx` STILL omits them — if civitai adds an override the
 * vendored source doesn't mirror, CI fails so we notice and re-vendor.
 */
export const DRIFT_GUARDED_ABSENT_KEYS = [
  'primaryColor',
  'primaryShade',
  'defaultRadius',
  'fontFamily',
] as const;
