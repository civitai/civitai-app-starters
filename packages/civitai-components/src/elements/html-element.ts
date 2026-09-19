/**
 * A bare `extends HTMLElement` is evaluated at IMPORT and that global is absent
 * in Node, so it takes down any server-side import of the package. `LitElement`
 * shims this itself; a hand-written light-DOM element has to.
 */
export const HTMLElementBase = (
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown)
) as typeof HTMLElement;
