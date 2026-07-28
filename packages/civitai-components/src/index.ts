/**
 * `@civitai/components` — framework-agnostic, attribute-driven component styles.
 *
 * Two consumption forms:
 *   1. `<link>` (zero JS): link `@civitai/theme/styles.css` +
 *      `@civitai/components/styles.css`, then author plain HTML with the
 *      `data-civitai-ui="…"` contract (see MARKUP.md).
 *   2. JS inject: call `injectStyles()` once — it injects BOTH the `--civitai-*`
 *      tokens (from @civitai/theme) and the component CSS, idempotently.
 */
import { injectTokens } from '@civitai/theme';

import { componentsCss } from './styles.generated.js';

export { componentsCss };

/** The presentational components this package styles. */
export const COMPONENT_NAMES = [
  'button',
  'text-input',
  'textarea',
  'number-input',
  'select',
  'checkbox',
  'radio',
  'radio-group',
  'card',
  'stack',
  'group',
  'alert',
  'loader',
  'badge',
  'slider',
  'segmented-control',
  'toast-region',
  'toast',
  'tooltip',
  'image',
] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

const STYLE_MARKER = 'data-civitai-components';

/**
 * Inject the component stylesheet (and the `--civitai-*` tokens it depends on)
 * into a document's `<head>` exactly once. Idempotent; no-op under SSR.
 *
 * @param doc Target document (defaults to the ambient `document`).
 */
export function injectStyles(doc?: Document): void {
  const target = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target) return;
  // Tokens first so the component rules always resolve their var() references.
  injectTokens(target);
  if (target.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = target.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = componentsCss;
  const head = target.head ?? target.getElementsByTagName('head')[0];
  if (head) head.appendChild(style);
  else target.documentElement.appendChild(style);
}
