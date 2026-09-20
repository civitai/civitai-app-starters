import { CivitaiEnhanceElement } from '../internal/CivitaiEnhanceElement.js';
import { stackCss } from '../generated/stack.css.js';

/** The named gap steps. Anything else is treated as a raw CSS length. */
export const GAP_STEPS = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const;
export type GapStep = (typeof GAP_STEPS)[number];

const STEPS: ReadonlySet<string> = new Set(GAP_STEPS);

/**
 * `<civitai-stack>` — vertical flex container. ENHANCE-ONLY (constraint (a)):
 * it sets attributes and custom properties on ITSELF and never touches its
 * children, so arbitrary consumer content survives every re-render.
 *
 * `gap` resolves BOTH contracts that drifted apart in the two React packages:
 * a named step (`md`) lands on the `[gap=…]` rules; anything else is a CSS
 * length and lands on `--civitai-stack-gap`. A bare number is read as px, which
 * is what `@civitai/blocks-react/ui` did. There is no input that silently
 * evaporates.
 *
 * @element civitai-stack
 *
 * @attr {none|xs|sm|md|lg|xl|<length>} gap - Spacing between children. Default `md` (12px).
 * @attr {string} align - `align-items`.
 * @attr {string} justify - `justify-content`.
 *
 * @cssprop --civitai-stack-gap - The resolved gap; set directly to override.
 *
 * @slot - NONE. Light DOM has no slots; children are simply left in place.
 */
export class CivitaiStack extends CivitaiEnhanceElement {
  static override componentId = 'civitai-stack';
  static override componentCss = stackCss;

  static override properties = {
    gap: { type: String, reflect: true },
    align: { type: String, reflect: true },
    justify: { type: String, reflect: true },
  };

  declare gap: string | number | null;
  declare align: string | null;
  declare justify: string | null;

  constructor() {
    super();
    this.gap = null;
    this.align = null;
    this.justify = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('data-civitai-ui')) this.setAttribute('data-civitai-ui', 'stack');
  }

  protected override update(changed: Map<PropertyKey, unknown>): void {
    super.update(changed);

    if (changed.has('gap')) {
      const raw = this.gap;
      if (raw == null || raw === '') {
        this.style.removeProperty('--civitai-stack-gap');
      } else if (typeof raw === 'string' && STEPS.has(raw)) {
        // A named step: the stylesheet's [gap='md'] rule owns it. Clear any
        // stale inline value so switching length -> step actually takes.
        this.style.removeProperty('--civitai-stack-gap');
      } else {
        this.style.setProperty('--civitai-stack-gap', toLength(raw));
      }
    }

    if (changed.has('align')) {
      if (this.align) this.style.setProperty('align-items', this.align);
      else this.style.removeProperty('align-items');
    }
    if (changed.has('justify')) {
      if (this.justify) this.style.setProperty('justify-content', this.justify);
      else this.style.removeProperty('justify-content');
    }
  }
}

/** `20` and `'20'` both mean 20px; everything else passes through verbatim. */
function toLength(v: string | number): string {
  if (typeof v === 'number') return `${v}px`;
  return /^-?\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()}px` : v;
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-stack': CivitaiStack;
  }
}
