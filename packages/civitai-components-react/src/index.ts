/**
 * `@civitai/components-react` — React bindings for the `<civitai-*>` custom
 * elements published by [`@civitai/components`](../civitai-components).
 *
 * The custom elements ARE the design system. This package is strictly
 * DOWNSTREAM of them: every export here is an `@lit/react` wrapper generated
 * from an element class, so the props, their types and the events all come
 * from the element itself. There is no second implementation to drift against.
 *
 * ```tsx
 * import { CivitaiButton, CivitaiCard } from '@civitai/components-react';
 *
 * <CivitaiCard>
 *   <CivitaiButton variant="filled" onClick={onGenerate}>Generate</CivitaiButton>
 * </CivitaiCard>
 * ```
 *
 * Zero setup: the elements are self-styling (shadow DOM, `:host` rules reading
 * `--civitai-*`) and `CivitaiElement.connectedCallback()` injects the
 * `@civitai/theme` tokens into the document on first mount. There is no
 * stylesheet to import and no provider to mount.
 *
 * This barrel re-exports the PRESENTATIONAL bindings, and importing it
 * registers all of them. Two further bindings act as the viewer through
 * `@civitai/sdk` and so stay out of the barrel, to keep that dependency out of
 * the graph. Import those — and any single binding, when bundle size matters —
 * by path:
 *
 * ```tsx
 * import { CivitaiSignInButton } from '@civitai/components-react/elements/civitai-sign-in-button';
 * ```
 *
 * Handlers receive the **DOM event**, not an extracted value —
 * `onChange={(e) => e.target.value}`, `onVote={(e) => e.detail}`.
 *
 * ⚠️ **Server rendering is best-effort.** `@lit/react` assigns props as
 * properties from effects, which do not run on the server, so a wrapper emits
 * a bare tag that fills in after hydration. Where server output matters, write
 * the `<civitai-*>` tag directly in JSX — attributes survive server-side and
 * the elements reflect them.
 *
 * NOT a replacement for `@civitai/blocks-react`, which stays the home of the
 * transport hooks and block-authoring components.
 */
export * from './elements/index.js';
