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
 * `scripts/gen-react-types.mjs`.
 */
import '@civitai/elements';
import './generated/jsx.js';

export type {
  CivitaiButtonProps,
  CivitaiSelectProps,
  CivitaiSliderProps,
  CivitaiStackProps,
} from './generated/jsx.js';

export type {
  CivitaiButton,
  CivitaiSelect,
  CivitaiSlider,
  CivitaiStack,
  SelectOption,
  SelectChangeDetail,
  SliderChangeDetail,
  ButtonVariant,
  ButtonSize,
  ButtonType,
  GapStep,
} from '@civitai/elements';
