import { CivitaiEnhanceElement } from '../internal/CivitaiEnhanceElement.js';
import { buttonCss } from '../generated/button.css.js';

export type ButtonVariant = 'filled' | 'light' | 'outline' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonType = 'button' | 'submit' | 'reset';

const SEMANTIC_COLORS = new Set(['error', 'success', 'warning', 'info']);

/**
 * `<civitai-button>` — themed button.
 *
 * ENHANCE-ONLY (constraint (a)): the element never writes a child node. Its
 * label, icons and left/right sections are the consumer's own light-DOM
 * children, which survive every re-render because there is no render path.
 * The loading spinner is a `::before` pseudo-element, not a `<civitai-loader>`.
 *
 * @element civitai-button
 *
 * @attr {filled|light|outline|subtle} variant - Visual style. Default `filled`.
 * @attr {sm|md|lg} size - Size preset. Default `md`.
 * @attr {string} color - `primary` (default), a semantic token name
 *   (`error`/`success`/`warning`/`info`), or any CSS color. Overrides the
 *   `--civitai-color-primary` the variant styling reads.
 * @attr {boolean} loading - Spinner + blocks activation, sets `aria-busy`.
 * @attr {boolean} full-width - Stretch to the container width.
 * @attr {boolean} disabled - Blocks activation and leaves the tab order.
 * @attr {button|submit|reset} type - Default `button`, matching
 *   `@civitai/blocks-react/ui`: a button dropped into a form should not submit
 *   by accident.
 *
 * @cssprop --civitai-color-primary - Accent, overridden by `color`.
 * @cssprop --civitai-radius - Corner radius.
 *
 * @slot - NONE. Light DOM has no slots; children are simply left in place.
 */
export class CivitaiButton extends CivitaiEnhanceElement {
  static override componentId = 'civitai-button';
  static override componentCss = buttonCss;

  /**
   * Form association exists only so `type="submit"`/`"reset"` can reach the
   * owning form (including via the `form="<id>"` attribute, which
   * `closest('form')` cannot see) and so `<fieldset disabled>` propagates.
   * The button NEVER calls `setFormValue()`, so it contributes nothing to
   * `FormData` — pinned by test/form-participation.test.ts.
   */
  static formAssociated = true;

  static override properties = {
    variant: { type: String, reflect: true },
    size: { type: String, reflect: true },
    color: { type: String },
    loading: { type: Boolean, reflect: true },
    fullWidth: { type: Boolean, reflect: true, attribute: 'full-width' },
    disabled: { type: Boolean, reflect: true },
    type: { type: String, reflect: true },
  };

  declare variant: ButtonVariant;
  declare size: ButtonSize;
  declare color: string;
  declare loading: boolean;
  declare fullWidth: boolean;
  declare disabled: boolean;
  declare type: ButtonType;

  private internals: ElementInternals | null = null;

  constructor() {
    super();
    this.variant = 'filled';
    this.size = 'md';
    this.color = 'primary';
    this.loading = false;
    this.fullWidth = false;
    this.disabled = false;
    this.type = 'button';
    try {
      this.internals = this.attachInternals();
    } catch {
      // Environments without ElementInternals (older happy-dom) fall back to
      // closest('form') in `ownerForm`.
      this.internals = null;
    }
    this.addEventListener('click', this.#onClick);
    this.addEventListener('keydown', this.#onKeydown);
    this.addEventListener('keyup', this.#onKeyup);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Back-compat hook for @civitai/components' sheet and any consumer CSS
    // already selecting on the attribute contract.
    if (!this.hasAttribute('data-civitai-ui')) this.setAttribute('data-civitai-ui', 'button');
    if (!this.hasAttribute('role')) this.setAttribute('role', 'button');
  }

  private get inactive(): boolean {
    return this.disabled || this.loading;
  }

  private get ownerForm(): HTMLFormElement | null {
    return this.internals?.form ?? this.closest('form');
  }

  protected override update(changed: Map<PropertyKey, unknown>): void {
    super.update(changed);

    if (changed.has('disabled') || changed.has('loading')) {
      // A custom element has no native `disabled`, so the tab order and the
      // accessibility tree have to be driven explicitly.
      this.setAttribute('tabindex', this.inactive ? '-1' : '0');
      if (this.inactive) this.setAttribute('aria-disabled', 'true');
      else this.removeAttribute('aria-disabled');
      if (this.loading) this.setAttribute('aria-busy', 'true');
      else this.removeAttribute('aria-busy');
    } else if (!this.hasAttribute('tabindex')) {
      this.setAttribute('tabindex', '0');
    }

    if (changed.has('color')) {
      const accent = this.#resolveAccent();
      if (accent) {
        this.style.setProperty('--civitai-color-primary', accent);
        this.style.setProperty('--civitai-color-primary-hover', accent);
      } else {
        this.style.removeProperty('--civitai-color-primary');
        this.style.removeProperty('--civitai-color-primary-hover');
      }
    }
  }

  #resolveAccent(): string | undefined {
    const c = this.color;
    if (!c || c === 'primary') return undefined;
    if (SEMANTIC_COLORS.has(c)) return `var(--civitai-color-${c})`;
    return c;
  }

  #onClick = (e: Event): void => {
    if (this.inactive) {
      e.preventDefault();
      // stopImmediatePropagation, not stopPropagation: a consumer's own
      // listener is registered on THIS element too, so only the "immediate"
      // form keeps a disabled button from firing it.
      e.stopImmediatePropagation();
      return;
    }
    if (e.defaultPrevented) return;
    const form = this.ownerForm;
    if (!form) return;
    if (this.type === 'submit') form.requestSubmit();
    else if (this.type === 'reset') form.reset();
  };

  // Native <button> activates on Enter keydown and on Space keyUP. Matching
  // that exactly is what keeps a keyboard user's muscle memory intact.
  #onKeydown = (e: KeyboardEvent): void => {
    if (this.inactive) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.click();
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      // Suppress the page scroll; activation happens on keyup.
      e.preventDefault();
    }
  };

  #onKeyup = (e: KeyboardEvent): void => {
    if (this.inactive) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this.click();
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-button': CivitaiButton;
  }
}
