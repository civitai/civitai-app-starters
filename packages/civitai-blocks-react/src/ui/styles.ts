import { useEffect } from 'react';

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
 * Theming (gotcha #60): a block sets `data-theme={theme}` on its OWN root
 * (from `BLOCK_INIT.theme`); the host can't reach across the iframe boundary.
 * These rules theme via an ancestor `[data-theme='dark']` selector. The
 * default (no `data-theme`, i.e. light) matches the palette in
 * `starters/examples/hello-world/src/index.css`.
 */

/** Marker attribute on the injected `<style>` so injection is idempotent. */
const STYLE_MARKER = 'data-civitai-blocks-ui';

/**
 * Design tokens. CSS custom properties under `:root` (light defaults),
 * overridden under `[data-theme='dark']`. Palette mirrors Civitai's Mantine
 * design language (8px radius, blue primary `#228be6`, the dark/light
 * surfaces already used by the hello-world example).
 */
const TOKENS = `
:root {
  --ci-font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --ci-radius: 8px;
  --ci-color-text: #1a1a1a;
  --ci-color-text-dimmed: #6b7280;
  --ci-color-surface: #ffffff;
  --ci-color-surface-2: #f4f4f5;
  --ci-color-border: #e0e0e3;
  --ci-color-primary: #228be6;
  --ci-color-primary-hover: #1c7ed6;
  --ci-color-primary-fg: #ffffff;
  --ci-color-error: #e03131;
  --ci-color-success: #2f9e44;
  --ci-color-warning: #f08c00;
  --ci-color-info: #1971c2;
}

[data-theme='light'] {
  --ci-color-text: #1a1a1a;
  --ci-color-text-dimmed: #6b7280;
  --ci-color-surface: #ffffff;
  --ci-color-surface-2: #f4f4f5;
  --ci-color-border: #e0e0e3;
}

[data-theme='dark'] {
  --ci-color-text: #e6e6e6;
  --ci-color-text-dimmed: #909296;
  --ci-color-surface: #1a1b1e;
  --ci-color-surface-2: #25262b;
  --ci-color-border: #2c2e33;
  --ci-color-primary: #228be6;
  --ci-color-primary-hover: #339af0;
  --ci-color-primary-fg: #ffffff;
  --ci-color-error: #ff6b6b;
  --ci-color-success: #51cf66;
  --ci-color-warning: #ffa94d;
  --ci-color-info: #4dabf7;
}
`;

/**
 * Component CSS. All selectors hang off the `data-civitai-ui="<name>"`
 * attribute each component renders, so the pack never leaks styles onto the
 * author's own markup.
 */
const COMPONENT_CSS = `
[data-civitai-ui] {
  box-sizing: border-box;
  font-family: var(--ci-font);
}
[data-civitai-ui] *,
[data-civitai-ui] *::before,
[data-civitai-ui] *::after {
  box-sizing: border-box;
}

/* ----- Button ----- */
[data-civitai-ui='button'] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: var(--ci-radius);
  font-family: var(--ci-font);
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  text-decoration: none;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
  background: var(--ci-color-primary);
  color: var(--ci-color-primary-fg);
}
[data-civitai-ui='button'][data-size='sm'] { height: 30px; padding: 0 14px; font-size: 13px; }
[data-civitai-ui='button'][data-size='md'] { height: 36px; padding: 0 18px; font-size: 14px; }
[data-civitai-ui='button'][data-size='lg'] { height: 44px; padding: 0 22px; font-size: 16px; }
[data-civitai-ui='button'][data-full-width='true'] { width: 100%; }
[data-civitai-ui='button'][data-variant='filled'] {
  background: var(--ci-color-primary);
  color: var(--ci-color-primary-fg);
  border-color: var(--ci-color-primary);
}
[data-civitai-ui='button'][data-variant='filled']:hover:not(:disabled) {
  background: var(--ci-color-primary-hover);
  border-color: var(--ci-color-primary-hover);
}
[data-civitai-ui='button'][data-variant='light'] {
  background: color-mix(in srgb, var(--ci-color-primary) 12%, transparent);
  color: var(--ci-color-primary);
  border-color: transparent;
}
[data-civitai-ui='button'][data-variant='light']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ci-color-primary) 22%, transparent);
}
[data-civitai-ui='button'][data-variant='outline'] {
  background: transparent;
  color: var(--ci-color-primary);
  border-color: var(--ci-color-primary);
}
[data-civitai-ui='button'][data-variant='outline']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ci-color-primary) 10%, transparent);
}
[data-civitai-ui='button'][data-variant='subtle'] {
  background: transparent;
  color: var(--ci-color-primary);
  border-color: transparent;
}
[data-civitai-ui='button'][data-variant='subtle']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ci-color-primary) 10%, transparent);
}
[data-civitai-ui='button']:disabled,
[data-civitai-ui='button'][aria-busy='true'] {
  opacity: 0.6;
  cursor: not-allowed;
}
[data-civitai-ui='button'] [data-civitai-ui-section] {
  display: inline-flex;
  align-items: center;
}

/* ----- TextInput / Textarea ----- */
[data-civitai-ui='text-input'],
[data-civitai-ui='textarea'] {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
[data-civitai-ui-label] {
  font-size: 14px;
  font-weight: 600;
  color: var(--ci-color-text);
}
[data-civitai-ui-required] {
  color: var(--ci-color-error);
  margin-left: 2px;
}
[data-civitai-ui-description] {
  font-size: 12px;
  color: var(--ci-color-text-dimmed);
}
[data-civitai-ui-error] {
  font-size: 12px;
  color: var(--ci-color-error);
}
[data-civitai-ui-control] {
  width: 100%;
  font-family: var(--ci-font);
  font-size: 14px;
  color: var(--ci-color-text);
  background: var(--ci-color-surface);
  border: 1px solid var(--ci-color-border);
  border-radius: var(--ci-radius);
  padding: 8px 12px;
  transition: border-color 120ms ease;
}
[data-civitai-ui-control]:focus {
  outline: none;
  border-color: var(--ci-color-primary);
}
[data-civitai-ui-control][aria-invalid='true'] {
  border-color: var(--ci-color-error);
}
[data-civitai-ui-control]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
textarea[data-civitai-ui-control] {
  resize: vertical;
  line-height: 1.5;
}

/* ----- Card ----- */
[data-civitai-ui='card'] {
  background: var(--ci-color-surface);
  border-radius: var(--ci-radius);
  color: var(--ci-color-text);
}
[data-civitai-ui='card'][data-with-border='true'] {
  border: 1px solid var(--ci-color-border);
}
[data-civitai-ui='card'][data-padding='sm'] { padding: 10px; }
[data-civitai-ui='card'][data-padding='md'] { padding: 16px; }
[data-civitai-ui='card'][data-padding='lg'] { padding: 24px; }

/* ----- Stack / Group ----- */
[data-civitai-ui='stack'] {
  display: flex;
  flex-direction: column;
}
[data-civitai-ui='group'] {
  display: flex;
  flex-direction: row;
}

/* ----- Alert ----- */
[data-civitai-ui='alert'] {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: var(--ci-radius);
  border: 1px solid transparent;
  font-size: 14px;
  color: var(--ci-color-text);
}
[data-civitai-ui='alert'][data-color='info'] {
  background: color-mix(in srgb, var(--ci-color-info) 12%, transparent);
  border-color: color-mix(in srgb, var(--ci-color-info) 35%, transparent);
}
[data-civitai-ui='alert'][data-color='success'] {
  background: color-mix(in srgb, var(--ci-color-success) 12%, transparent);
  border-color: color-mix(in srgb, var(--ci-color-success) 35%, transparent);
}
[data-civitai-ui='alert'][data-color='warning'] {
  background: color-mix(in srgb, var(--ci-color-warning) 14%, transparent);
  border-color: color-mix(in srgb, var(--ci-color-warning) 35%, transparent);
}
[data-civitai-ui='alert'][data-color='error'] {
  background: color-mix(in srgb, var(--ci-color-error) 12%, transparent);
  border-color: color-mix(in srgb, var(--ci-color-error) 35%, transparent);
}
[data-civitai-ui='alert'] [data-civitai-ui-alert-body] {
  flex: 1;
  min-width: 0;
}
[data-civitai-ui='alert'] [data-civitai-ui-alert-title] {
  font-weight: 600;
  margin-bottom: 2px;
}
[data-civitai-ui='alert'] [data-civitai-ui-alert-close] {
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  padding: 0;
  opacity: 0.7;
}
[data-civitai-ui='alert'] [data-civitai-ui-alert-close]:hover {
  opacity: 1;
}

/* ----- Loader ----- */
[data-civitai-ui='loader'] {
  display: inline-block;
  border-radius: 50%;
  border-style: solid;
  border-color: color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  color: var(--ci-color-primary);
  animation: civitai-ui-spin 0.7s linear infinite;
}
[data-civitai-ui='loader'][data-size='sm'] { width: 16px; height: 16px; border-width: 2px; }
[data-civitai-ui='loader'][data-size='md'] { width: 22px; height: 22px; border-width: 3px; }
[data-civitai-ui='loader'][data-size='lg'] { width: 32px; height: 32px; border-width: 4px; }
@keyframes civitai-ui-spin {
  to { transform: rotate(360deg); }
}
[data-civitai-ui='button'] [data-civitai-ui='loader'] {
  color: currentColor;
}

/* ----- Badge ----- */
[data-civitai-ui='badge'] {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
[data-civitai-ui='badge'][data-size='sm'] { height: 18px; padding: 0 8px; font-size: 10px; }
[data-civitai-ui='badge'][data-size='md'] { height: 22px; padding: 0 10px; font-size: 11px; }
[data-civitai-ui='badge'][data-size='lg'] { height: 26px; padding: 0 12px; font-size: 13px; }
[data-civitai-ui='badge'][data-variant='filled'] {
  background: var(--ci-color-primary);
  color: var(--ci-color-primary-fg);
  border-color: var(--ci-color-primary);
}
[data-civitai-ui='badge'][data-variant='light'] {
  background: color-mix(in srgb, var(--ci-color-primary) 14%, transparent);
  color: var(--ci-color-primary);
}
[data-civitai-ui='badge'][data-variant='outline'] {
  background: transparent;
  color: var(--ci-color-primary);
  border-color: var(--ci-color-primary);
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
  background: var(--ci-color-surface);
  color: var(--ci-color-text);
  border: 1px solid var(--ci-color-border);
  border-radius: var(--ci-radius);
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
  border-bottom: 1px solid var(--ci-color-border);
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
  color: var(--ci-color-text-dimmed);
  font-size: 20px;
  line-height: 1;
  padding: 0;
}
[data-civitai-ui='modal'] [data-civitai-ui-modal-close]:hover {
  color: var(--ci-color-text);
}
[data-civitai-ui='modal'] [data-civitai-ui-modal-body] {
  padding: 18px;
}
`;

/** The full stylesheet shipped by the pack. Exported for SSR/manual use. */
export const BLOCKS_UI_STYLES = `${TOKENS}\n${COMPONENT_CSS}`;

/**
 * Inject the pack's stylesheet into a document's `<head>` exactly once.
 * Idempotent: subsequent calls (including from other components) detect the
 * marker `<style>` and no-op. Safe to call from any component's effect.
 *
 * @param doc Target document. Defaults to the ambient `document`. No-op when
 *   no document is available (e.g. SSR) — callers in the browser get styling,
 *   server renders fall back to the unstyled-but-functional markup.
 */
export function injectBlocksStyles(doc?: Document): void {
  const target =
    doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target) return;
  // Already injected → no-op (idempotent).
  if (target.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = target.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = BLOCKS_UI_STYLES;
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
