/**
 * Per-component style adoption for LIGHT-DOM custom elements.
 *
 * Why this exists at all: `ReactiveElement`'s `static styles` only works for a
 * shadow root (it writes `renderRoot.adoptedStyleSheets`, and `adoptedStyleSheets`
 * exists on `Document` and `ShadowRoot` — NOT on an ordinary element). Our
 * elements render into the light DOM (`createRenderRoot() { return this }`), so
 * their CSS has to land on the element's ROOT NODE instead.
 *
 * The bundle-size point of the whole package lives here: each component module
 * carries ONLY its own rule text and adopts it on first upgrade. Importing
 * `@civitai/elements/button` therefore drags Button's CSS and nothing else —
 * as opposed to `@civitai/blocks-react/ui`, where the whole design system's
 * stylesheet is a single `export const` string in the module graph of every
 * component.
 *
 * Idempotency is keyed on (root, id), so:
 *   - N instances of one component adopt one sheet;
 *   - the same component inside a shadow root adopts there too (that root has
 *     its own `adoptedStyleSheets`), which is what makes this safe if a
 *     consumer ever nests our light-DOM elements inside their own shadow tree.
 */

type StyleRoot = Document | ShadowRoot;

/** Constructed sheets are per-ID module singletons: built once, adopted many. */
const sheets = new Map<string, CSSStyleSheet>();

/** Which IDs each root has already taken. */
const adopted = new WeakMap<StyleRoot, Set<string>>();

function supportsConstructedSheets(): boolean {
  try {
    // happy-dom and older Safari lack the constructor and/or a settable
    // `adoptedStyleSheets`; feature-detect rather than sniff.
    return (
      typeof CSSStyleSheet === 'function' &&
      typeof new CSSStyleSheet().replaceSync === 'function'
    );
  } catch {
    return false;
  }
}

let constructible: boolean | undefined;

function seen(root: StyleRoot, id: string): boolean {
  let set = adopted.get(root);
  if (!set) {
    set = new Set();
    adopted.set(root, set);
  }
  if (set.has(id)) return true;
  set.add(id);
  return false;
}

/**
 * Adopt `css` into `el`'s root node exactly once per (root, id).
 *
 * @param el  The upgraded custom element.
 * @param id  Stable component identifier, e.g. `'civitai-button'`.
 * @param css The component's own rule text.
 */
export function adoptStyles(el: Element, id: string, css: string): void {
  const node = el.getRootNode();
  const root: StyleRoot | undefined =
    node instanceof Document || (typeof ShadowRoot !== 'undefined' && node instanceof ShadowRoot)
      ? (node as StyleRoot)
      : typeof document !== 'undefined'
        ? document
        : undefined;
  if (!root) return;
  if (seen(root, id)) return;

  constructible ??= supportsConstructedSheets();

  if (constructible) {
    try {
      let sheet = sheets.get(id);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        sheets.set(id, sheet);
      }
      // Reassign rather than push: `adoptedStyleSheets` is a frozen array in
      // some engines, and the spec's setter is what triggers restyle.
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch {
      // Fall through to the <style> path (e.g. a sheet constructed against a
      // different document than the one adopting it).
      constructible = false;
    }
  }

  const doc: Document =
    root instanceof Document ? root : (root.ownerDocument ?? (document as Document));
  const style = doc.createElement('style');
  style.setAttribute('data-civitai-element', id);
  style.textContent = css;
  const host: ParentNode =
    root instanceof Document ? (root.head ?? root.documentElement) : root;
  host.appendChild(style);
}

/** Test-only: forget every adoption record so a suite can assert re-injection. */
export function __resetAdoptedStyles(): void {
  sheets.clear();
  constructible = undefined;
}
