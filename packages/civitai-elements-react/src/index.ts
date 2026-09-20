/**
 * `@civitai/elements-react` — TYPES ONLY. There is no wrapper component here
 * and there is not meant to be one.
 *
 * Importing this module:
 *   1. registers every `@civitai/elements` custom element (side effect), and
 *   2. brings the generated `JSX.IntrinsicElements` augmentation into scope,
 *      so `<civitai-button variant="outline">` type-checks and autocompletes.
 *
 * ```tsx
 * import '@civitai/elements-react';
 *
 * <civitai-stack gap="lg">
 *   <civitai-select
 *     name="sampler"
 *     options={samplers}
 *     value={sampler}
 *     onChange={(e) => setSampler(e.detail.value)}
 *   />
 *   <civitai-button variant="filled" loading={busy}>Generate</civitai-button>
 * </civitai-stack>
 * ```
 *
 * ── WHY NO WRAPPERS ───────────────────────────────────────────────────────
 * Wrappers exist to work around two React defects. React 19 has neither, and
 * both facts are MEASURED against react-dom 19.2.6 in
 * `test/react19-custom-elements.browser.test.tsx` rather than taken from the
 * Custom Elements Everywhere score:
 *   - a non-primitive or boolean prop is set as a PROPERTY (`options={[…]}`
 *     arrives as an array, not `"[object Object]"`);
 *   - an `on<name>` prop attaches a real listener.
 * A wrapper would add a component layer, a forwarded-ref hop, and a published
 * runtime that must be kept in sync with every element change — for nothing.
 *
 * ── THE ONE SHARP EDGE ────────────────────────────────────────────────────
 * For a CUSTOM event name, React attaches `on<Rest>` verbatim. `onCivitaiFoo`
 * listens for `CivitaiFoo`, not `civitai-foo`. This package only declares
 * handler props that were verified to fire; see `REACT_SYNTHETIC` in
 * `scripts/gen-jsx-types.mjs`.
 */
import '@civitai/elements';
import './generated/jsx.js';

/**
 * The only names this package DEFINES: the JSX prop shapes, which exist
 * nowhere else.
 *
 * 🔴 It deliberately re-exports NOTHING from `@civitai/elements`. An earlier
 * version also re-exported `ButtonVariant`, `ButtonSize`, `ButtonType`,
 * `GapStep`, `SelectOption`, `SelectChangeDetail`, `SliderChangeDetail` and
 * the four element classes as a convenience — which took `ButtonVariant` and
 * `ButtonSize` from TWO definitions across the fleet (`blocks-react/ui` and
 * `components-react`) to THREE. This package exists downstream of issue #328,
 * whose whole subject is 34 duplicated names with drifted contracts; a
 * convenience alias that adds to that count is working against the reason the
 * package was built.
 *
 * Import those from `@civitai/elements` (or `@civitai/elements/button`), which
 * is where they are declared.
 */
export type {
  CivitaiButtonProps,
  CivitaiSelectProps,
  CivitaiSliderProps,
  CivitaiStackProps,
} from './generated/jsx.js';
