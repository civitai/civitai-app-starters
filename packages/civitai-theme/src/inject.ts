import { tokensCss } from './tokens.generated.js';

/** Marker attribute on the injected `<style>` so injection is idempotent. */
const STYLE_MARKER = 'data-civitai-theme';

/**
 * Inject the `--civitai-*` token stylesheet into a document's `<head>` exactly
 * once. Idempotent (marker `<style>` detected -> no-op). No-op with no document
 * (SSR). Mirrors `@civitai/blocks-react`'s inject approach so the two packages
 * behave identically for JS consumers that can't use a `<link>`.
 */
export function injectTokens(doc?: Document): void {
  const target = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target) return;
  if (target.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = target.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = tokensCss;
  const head = target.head ?? target.getElementsByTagName('head')[0];
  if (head) head.appendChild(style);
  else target.documentElement.appendChild(style);
}
