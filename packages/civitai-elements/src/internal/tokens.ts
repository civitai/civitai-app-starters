import { injectTokens } from '@civitai/theme';

/**
 * Ensure the `--civitai-*` design tokens are present for `el`'s document.
 *
 * DX parity with `@civitai/blocks-react/ui` and `@civitai/components-react`:
 * rendering ANY element is enough to get the themed look, with no CSS import
 * and no setup step. `injectTokens()` is idempotent and a no-op under SSR.
 *
 * COST NOTE (measured, see scripts/measure-bundle.mjs): the token sheet is
 * 5,826 B of the per-app floor and is shared by every component. Apps that
 * already `<link>` `@civitai/theme/styles.css` still pay it in the bundle,
 * because this call is unconditional. A consumer who wants it gone should
 * import from `@civitai/elements/<component>` and tree-shake nothing — there is
 * no way to drop it without losing the zero-setup guarantee, and the operator's
 * measured baseline pays it too, so the comparison is like-for-like.
 */
export function ensureTokens(el: Element): void {
  const node = el.getRootNode();
  const doc =
    node instanceof Document
      ? node
      : (el.ownerDocument ?? (typeof document !== 'undefined' ? document : undefined));
  if (!doc) return;
  injectTokens(doc);
}
