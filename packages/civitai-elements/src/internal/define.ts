/**
 * Idempotent `customElements.define`.
 *
 * Every per-component entrypoint is a SIDE-EFFECT module (importing it
 * registers the tag), so an app that imports both `@civitai/elements/button`
 * and `@civitai/elements` must not throw on the second registration. It also
 * keeps HMR and duplicated-copy-in-node_modules situations from being fatal.
 */
export function define(tag: string, ctor: CustomElementConstructor): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, ctor);
}
