import { ReactiveElement } from '@lit/reactive-element';

import { adoptStyles } from './adoptStyles.js';
import { ensureTokens } from './tokens.js';

/**
 * Base class for LAYOUT / WRAPPER primitives — `civitai-button`,
 * `civitai-stack`, `civitai-card`.
 *
 * ── Constraint (a): light DOM has no `<slot>` ──────────────────────────────
 * `<slot>` is a shadow-DOM feature. With `createRenderRoot()` returning `this`
 * there is nowhere to project children, so anything that TEMPLATES its own
 * children will clobber whatever the consumer put inside. For a wrapper whose
 * entire purpose is arbitrary children (`<civitai-button>Generate</...>`,
 * `<civitai-stack><Foo/><Bar/></...>`) that is fatal.
 *
 * The fix is STRUCTURAL, not a convention: this base extends `ReactiveElement`,
 * which has no templating layer at all — no `render()`, no `lit-html` in its
 * module graph. A subclass of this class CANNOT clobber children by accident,
 * because there is no code path that writes them. `scripts/…` + the
 * `enhance-only.test.ts` architecture guard assert that `dist/button.js` and
 * `dist/stack.js` never import `lit-html`, so the property is checked in CI and
 * not merely documented.
 *
 * What a wrapper IS allowed to do: set attributes on itself, set custom
 * properties on its own `style`, wire ARIA, and adopt its own stylesheet.
 * Everything visual that would otherwise need an extra element (a loading
 * spinner, a left/right section divider) is done with CSS pseudo-elements and
 * child-combinator selectors against the consumer's own children.
 *
 * Leaf components that OWN their content (`civitai-select`, `civitai-slider`)
 * take content via properties instead and extend `CivitaiFieldElement`.
 */
export abstract class CivitaiEnhanceElement extends ReactiveElement {
  /** Stable style-adoption key. Subclasses MUST override. */
  static componentId = 'civitai-element';
  /** This component's own rule text. Subclasses MUST override. */
  static componentCss = '';

  /**
   * Render into the light DOM. Returning `this` is what removes `<slot>` from
   * the picture; see the class doc.
   */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const ctor = this.constructor as typeof CivitaiEnhanceElement;
    ensureTokens(this);
    adoptStyles(this, ctor.componentId, ctor.componentCss);
  }
}
