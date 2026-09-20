/**
 * `@civitai/elements` — light-DOM custom elements for Civitai apps.
 *
 * Importing THIS module registers every element. For the smallest bundle,
 * import only the components you use:
 *
 *   import '@civitai/elements/button';
 *   import '@civitai/elements/select';
 *
 * ── Why light DOM ─────────────────────────────────────────────────────────
 * Apps built from these starters run on a dedicated page or inside a
 * block iframe, so style encapsulation buys nothing, and shadow DOM costs a
 * great deal: React has no Declarative Shadow DOM support
 * (facebook/react#33698), which makes every shadow-rooted element
 * client-only-with-a-flash under the SSR starters. The trade is that there is
 * no `<slot>`: wrappers must never render (see `CivitaiEnhanceElement`) and
 * leaves take content via properties (see `CivitaiFieldElement`).
 *
 * ── React ─────────────────────────────────────────────────────────────────
 * No wrapper components are needed. React 19 sets non-primitive and boolean
 * props as PROPERTIES on a custom element and attaches `on<event>` props as
 * plain listeners — both MEASURED, in
 * `test/react19-custom-elements.browser.test.tsx`. `@civitai/elements-react`
 * ships the generated JSX types and typed event details, and no runtime.
 */
export * from './button.js';
export * from './stack.js';
export * from './select.js';
export * from './slider.js';

export { adoptStyles } from './internal/adoptStyles.js';
export { CivitaiEnhanceElement } from './internal/CivitaiEnhanceElement.js';
export { CivitaiFieldElement } from './internal/CivitaiFieldElement.js';
