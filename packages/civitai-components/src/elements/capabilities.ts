/**
 * The platform features these elements are built on. A browser missing one does
 * not degrade — the element silently stops working — so the contract suite
 * probes them directly rather than inferring support from a version.
 */
export interface Capability {
  name: string;
  /** What breaks without it, so a red result is actionable. */
  needed: string;
  supported: () => boolean;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'custom-elements',
    needed: 'every element',
    supported: () => typeof customElements?.define === 'function',
  },
  {
    name: 'shadow-dom',
    needed: 'style encapsulation',
    supported: () => typeof Element.prototype.attachShadow === 'function',
  },
  {
    name: 'element-internals',
    needed: 'form association',
    supported: () => typeof HTMLElement.prototype.attachInternals === 'function',
  },
  {
    name: 'form-associated-custom-elements',
    needed: 'FormData, form.reset() and validity on our controls',
    supported: () => {
      const internals = ElementInternals?.prototype;
      return (
        typeof internals?.setFormValue === 'function' &&
        typeof internals?.setValidity === 'function' &&
        'form' in (internals ?? {})
      );
    },
  },
  {
    name: 'constructable-stylesheets',
    needed: "Lit's adoptedStyleSheets path; without it every element clones a <style>",
    supported: () => {
      try {
        return new CSSStyleSheet() instanceof CSSStyleSheet && 'adoptedStyleSheets' in Document.prototype;
      } catch {
        return false;
      }
    },
  },
  {
    name: 'css-part',
    needed: '::part() styling hooks',
    supported: () => CSS.supports('selector(::part(x))'),
  },
  {
    name: 'css-color-mix',
    needed: 'every derived hover/tint colour',
    supported: () => CSS.supports('color', 'color-mix(in srgb, red 50%, transparent)'),
  },
  {
    name: 'css-slotted',
    needed: 'styling slotted section content',
    supported: () => CSS.supports('selector(::slotted(*))'),
  },
  {
    name: 'focus-visible',
    needed: 'the segment focus ring',
    supported: () => CSS.supports('selector(:focus-visible)'),
  },
];

/** Names of the features this browser does not have. */
export function missingCapabilities(): string[] {
  return CAPABILITIES.filter((capability) => {
    try {
      return !capability.supported();
    } catch {
      return true;
    }
  }).map((capability) => capability.name);
}
