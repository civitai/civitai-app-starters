import { useEffect } from 'react';

import { componentsCss, injectStyles as injectComponentsStyles } from '@civitai/components';
import { tokensCss } from '@civitai/theme';

/**
 * W6 component pack — runtime style injection.
 *
 * The package builds with `tsc` only — there is no bundler and no CSS
 * pipeline (verified: `dist/` emits no `.css`). To give block authors a
 * zero-setup, auto-themed pack we ship the CSS as a TS string constant and
 * inject it into the block document's `<head>` once, idempotently. Every
 * component calls `useBlocksStyles()` (a `useEffect` that calls
 * `injectBlocksStyles()`), so simply rendering any `/ui` component is enough
 * to get the styling — no CSS import, no setup step.
 *
 * Design-system delegation (0.35.0):
 *   The pack no longer bundles its own tokens or presentational-component CSS.
 *   It delegates to the PUBLISHED design-system packages:
 *     - `@civitai/theme`      — the `--civitai-*` design tokens.
 *     - `@civitai/components` — the attribute-driven CSS for the 10
 *       presentational components (Button, TextInput, Textarea, NumberInput,
 *       Card, Stack, Group, Alert, Loader, Badge), wrapped in
 *       `@layer civitai.components`.
 *   Only the components that live entirely in this package keep their CSS here,
 *   repointed onto the `--civitai-*` tokens: the original interactive-5
 *   (Modal, Select, Slider, Collapse, SegmentedControl) plus ResourceCard,
 *   which has no `@civitai/components` counterpart. This is a VISIBLE repaint —
 *   the design-system tokens differ from the pack's retired `--ci-*` palette
 *   (radius 8px→4px, teal success, dark primary `#1971C2`, etc.).
 *
 * `injectBlocksStyles()` injects THREE `<style>` elements, each with its own
 * idempotency marker so they compose cleanly in the sandbox iframe:
 *   1. `data-civitai-theme`      — the `--civitai-*` tokens (from @civitai/theme)
 *   2. `data-civitai-components` — the presentational-10 CSS (from @civitai/components)
 *   3. `data-civitai-blocks-ui`  — the interactive-5-only CSS (below)
 * (1) and (2) are injected by `@civitai/components`'s `injectStyles()`.
 *
 * Theming (gotcha #60): a block sets `data-theme={theme}` on its OWN root
 * (from `BLOCK_INIT.theme`); the host can't reach across the iframe boundary.
 * The `--civitai-*` tokens theme via an ancestor `[data-theme='dark']`
 * selector; the default (no `data-theme`, i.e. light) matches @civitai/theme's
 * `:root` palette.
 */

/** Marker attribute on the injected interactive-5 `<style>` so injection is idempotent. */
const STYLE_MARKER = 'data-civitai-blocks-ui';

/**
 * Package-local component CSS — the styles that live ONLY in this package
 * (Modal / Select / Slider / Collapse / SegmentedControl, plus ResourceCard).
 * Repointed onto the `--civitai-*` tokens supplied by `@civitai/theme`.
 *
 * (The name `INTERACTIVE_STYLES` and the `interactive-5` label elsewhere are
 * historical: ResourceCard is only sometimes interactive, and joined the block
 * because `@civitai/components` has no counterpart for it, not because it is a
 * sixth control.)
 *
 * These rules are intentionally UNLAYERED (unlike @civitai/components' rules,
 * which live in `@layer civitai.components`). Their selectors are DISJOINT from
 * the presentational-10 selectors, so the two never conflict. The one exception
 * is the shared field primitives (`-control` / `-label` / `-required` /
 * `-description` / `-error`): those are now owned by @civitai/components and are
 * NOT redefined here — Select and Slider reuse them and only add their own
 * field WRAPPER (@civitai/components scopes its wrapper rule to
 * text-input/textarea/number-input) plus a couple of scoped overrides (the
 * slider label row).
 */
const INTERACTIVE_STYLES = `
/* ----- Select / Slider field wrappers -----
   The shared -control/-label/-required/-description/-error primitives come from
   @civitai/components (layered). Only the select/slider WRAPPERS live here — the
   design-system package scopes its field-wrapper rule to the presentational
   inputs (text-input/textarea/number-input). */
[data-civitai-ui='select'],
[data-civitai-ui='slider'] {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ----- Modal ----- */
[data-civitai-ui='modal-overlay'] {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 32px 16px;
  overflow-y: auto;
  z-index: 1000;
}
[data-civitai-ui='modal'] {
  background: var(--civitai-color-surface);
  color: var(--civitai-color-text);
  border: 1px solid var(--civitai-color-border);
  border-radius: var(--civitai-radius);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 440px;
  outline: none;
}
[data-civitai-ui='modal'][data-size='sm'] { max-width: 340px; }
[data-civitai-ui='modal'][data-size='md'] { max-width: 440px; }
[data-civitai-ui='modal'][data-size='lg'] { max-width: 620px; }
[data-civitai-ui='modal'] [data-civitai-ui-modal-header] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--civitai-color-border);
}
[data-civitai-ui='modal'] [data-civitai-ui-modal-title] {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
[data-civitai-ui='modal'] [data-civitai-ui-modal-close] {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--civitai-color-text-dimmed);
  font-size: 20px;
  line-height: 1;
  padding: 0;
}
[data-civitai-ui='modal'] [data-civitai-ui-modal-close]:hover {
  color: var(--civitai-color-text);
}
[data-civitai-ui='modal'] [data-civitai-ui-modal-body] {
  padding: 18px;
}

/* ----- Slider ----- */
[data-civitai-ui='slider'] [data-civitai-ui-label] {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
[data-civitai-ui-slider-value] {
  font-weight: 500;
  color: var(--civitai-color-text-dimmed);
  font-variant-numeric: tabular-nums;
}
[data-civitai-ui-range] {
  width: 100%;
  margin: 0;
  accent-color: var(--civitai-color-primary);
  cursor: pointer;
}
[data-civitai-ui-range]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
[data-civitai-ui-range]:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 2px;
}

/* ----- Collapse ----- */
[data-civitai-ui='collapse'] [data-civitai-ui-collapse-trigger] {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 0;
  background: transparent;
  border: none;
  font-family: var(--civitai-font);
  font-size: 14px;
  font-weight: 600;
  color: var(--civitai-color-text);
  text-align: left;
  cursor: pointer;
}
[data-civitai-ui='collapse'] [data-civitai-ui-collapse-trigger]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
[data-civitai-ui='collapse'] [data-civitai-ui-collapse-chevron] {
  display: inline-block;
  width: 1em;
  color: var(--civitai-color-text-dimmed);
}
[data-civitai-ui='collapse'] [data-civitai-ui-collapse-region] {
  padding-top: 4px;
}

/* ----- ResourceCard -----
   Two variants off ONE box. data-variant='card' stacks (grid tile),
   data-variant='row' runs inline (compact list line). Every selector is
   double-qualified with [data-civitai-ui='resource-card'] on purpose:
   data-variant is also emitted by Button and Badge, so a bare
   [data-variant='card'] would reach across the whole pack.
   NOTE: this block lives inside a JS TEMPLATE LITERAL. No backticks, and no
   dollar-brace, or the string ends here and the file stops parsing as
   TypeScript (backticks in this comment did exactly that once). */
[data-civitai-ui='resource-card'] {
  display: flex;
  box-sizing: border-box;
  font-family: var(--civitai-font);
  color: var(--civitai-color-text);
  background: var(--civitai-color-surface);
  border: 1px solid var(--civitai-color-border);
  border-radius: var(--civitai-radius);
  overflow: hidden;
}
[data-civitai-ui='resource-card'][data-variant='card'] {
  flex-direction: column;
  align-items: stretch;
}
[data-civitai-ui='resource-card'][data-variant='row'] {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}
[data-civitai-ui='resource-card'][data-selected='true'] {
  border-color: var(--civitai-color-primary);
}
[data-civitai-ui='resource-card'][data-disabled='true'] {
  opacity: 0.6;
}
/* The hit area. A <button> when interactive, a <div> when not — both are reset
   to the same box so the two variants lay out identically either way. */
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-hit] {
  display: flex;
  /* 🔴 A flex ITEM defaults to min-width:auto, which refuses to shrink below its
     content — so without this the name's nowrap+ellipsis never engages and a
     long model name blows the card out of its grid cell instead of truncating. */
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
[data-civitai-ui='resource-card'][data-variant='card'] [data-civitai-ui-resource-hit] {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 6px;
}
[data-civitai-ui='resource-card'][data-variant='row'] [data-civitai-ui-resource-hit] {
  flex: 1 1 auto;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 0;
}
[data-civitai-ui='resource-card'] button[data-civitai-ui-resource-hit] {
  cursor: pointer;
}
[data-civitai-ui='resource-card'] button[data-civitai-ui-resource-hit]:disabled {
  cursor: not-allowed;
}
[data-civitai-ui='resource-card'] button[data-civitai-ui-resource-hit]:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: -2px;
}
/* The thumbnail frame. Rendered whether or not there is an image — see the
   component's thumbnailUrl doc: BlockResourceInfo has no image field, so "no
   image" is the COMMON case and the frame must keep its box regardless. */
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-thumb] {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  overflow: hidden;
  background: var(--civitai-color-surface-2);
  border-radius: calc(var(--civitai-radius) - 1px);
  color: var(--civitai-color-text-dimmed);
}
[data-civitai-ui='resource-card'][data-variant='card'] [data-civitai-ui-resource-thumb] {
  /* 🔴 aspect-ratio, not a fixed height: the tile is grid-sized by the caller,
     and this is the line that stops a thumbnail-less card collapsing to a
     text-height sliver. */
  width: 100%;
  aspect-ratio: 1 / 1;
  font-size: 11px;
}
[data-civitai-ui='resource-card'][data-variant='row'] [data-civitai-ui-resource-thumb] {
  width: 36px;
  height: 36px;
  font-size: 9px;
}
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-thumb] img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-placeholder] {
  padding: 0 4px;
  text-align: center;
  line-height: 1.2;
}
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-text] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-name] {
  display: block;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-meta] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-width: 0;
  font-size: 11px;
  color: var(--civitai-color-text-dimmed);
}
[data-civitai-ui='resource-card'] [data-civitai-ui-resource-actions] {
  display: flex;
  align-items: center;
  flex: none;
  gap: 6px;
}
[data-civitai-ui='resource-card'][data-variant='card'] [data-civitai-ui-resource-actions] {
  padding: 0 6px 6px;
}

/* ----- SegmentedControl ----- */
[data-civitai-ui='segmented-control'] {
  display: inline-flex;
  flex-direction: row;
  gap: 2px;
  padding: 3px;
  background: var(--civitai-color-surface-2);
  border: 1px solid var(--civitai-color-border);
  border-radius: var(--civitai-radius);
  vertical-align: middle;
}
[data-civitai-ui='segmented-control'][data-full-width='true'] {
  display: flex;
  width: 100%;
}
[data-civitai-ui='segmented-control'] [data-civitai-ui-segment] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: calc(var(--civitai-radius) - 3px);
  background: transparent;
  color: var(--civitai-color-text-dimmed);
  font-family: var(--civitai-font);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
[data-civitai-ui='segmented-control'][data-full-width='true'] [data-civitai-ui-segment] {
  flex: 1 1 0;
}
[data-civitai-ui='segmented-control'][data-size='sm'] [data-civitai-ui-segment] { height: 24px; padding: 0 12px; font-size: 13px; }
[data-civitai-ui='segmented-control'][data-size='md'] [data-civitai-ui-segment] { height: 30px; padding: 0 16px; font-size: 14px; }
[data-civitai-ui='segmented-control'][data-size='lg'] [data-civitai-ui-segment] { height: 38px; padding: 0 20px; font-size: 16px; }
[data-civitai-ui='segmented-control'] [data-civitai-ui-segment]:hover:not(:disabled):not([data-active]) {
  color: var(--civitai-color-text);
  background: color-mix(in srgb, var(--civitai-color-text) 6%, transparent);
}
[data-civitai-ui='segmented-control'] [data-civitai-ui-segment][data-active] {
  background: var(--civitai-color-surface);
  color: var(--civitai-color-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
[data-civitai-ui='segmented-control'] [data-civitai-ui-segment]:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 1px;
}
[data-civitai-ui='segmented-control'] [data-civitai-ui-segment]:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
[data-civitai-ui='segmented-control'][data-disabled='true'] {
  opacity: 0.7;
}
`;

/**
 * The full stylesheet shipped by the pack, composed as a single string for
 * SSR / manual (non-JS-inject) consumers: the `--civitai-*` tokens, the
 * `@civitai/components` presentational CSS, then this package's interactive-5
 * CSS. (At RUNTIME, `injectBlocksStyles()` injects these as three separately
 * marked `<style>` elements instead — see below.)
 */
export const BLOCKS_UI_STYLES = `${tokensCss}\n${componentsCss}\n${INTERACTIVE_STYLES}`;

/**
 * Inject the pack's stylesheets into a document's `<head>`, idempotently.
 *
 * Injects THREE separately-marked `<style>` elements so they coexist cleanly in
 * the block's sandbox iframe (and with any other consumer of the design-system
 * packages in the same document):
 *   1. `@civitai/theme` tokens      (`data-civitai-theme`)
 *   2. `@civitai/components` CSS     (`data-civitai-components`)
 *   3. this package's interactive-5  (`data-civitai-blocks-ui`)
 * (1) and (2) are handled by `@civitai/components`'s `injectStyles()` (which
 * injects the tokens first so the component rules always resolve their vars).
 * Each has its own marker, so subsequent calls (including from other components,
 * or from a block that also imports `@civitai/components` directly) no-op.
 *
 * @param doc Target document. Defaults to the ambient `document`. No-op when
 *   no document is available (e.g. SSR) — callers in the browser get styling,
 *   server renders fall back to the unstyled-but-functional markup.
 */
export function injectBlocksStyles(doc?: Document): void {
  const target =
    doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target) return;
  // Tokens (@civitai/theme) + presentational-10 (@civitai/components). Idempotent
  // via their own markers; injects tokens first so var() refs always resolve.
  injectComponentsStyles(target);
  // Interactive-5-only CSS. Already injected → no-op (idempotent).
  if (target.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = target.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = INTERACTIVE_STYLES;
  const head = target.head ?? target.getElementsByTagName('head')[0];
  if (head) {
    head.appendChild(style);
  } else {
    // Degenerate document with no <head>; fall back to documentElement.
    target.documentElement.appendChild(style);
  }
}

/**
 * Hook that injects the pack's styles once on mount. Every `/ui` component
 * calls this so rendering any of them is enough to get the styling — the
 * author never imports CSS or runs a setup step.
 */
export function useBlocksStyles(): void {
  useEffect(() => {
    injectBlocksStyles();
  }, []);
}
