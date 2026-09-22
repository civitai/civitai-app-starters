import { css, html, unsafeCSS, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import type { Intent } from './civitai-badge.js';
import { defineElement } from './registry.js';
import { hostBaseline, spinner } from './shared-styles.js';

export type { Intent } from './civitai-badge.js';

export type ButtonVariant = 'filled' | 'light' | 'outline' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const TAG = 'civitai-button';

const intent = (value: Intent) => {
  const name = unsafeCSS(value);
  return css`
  :host([color='${name}']) {
    --civitai-color-primary: var(--civitai-color-${name});
    --civitai-color-primary-hover: color-mix(in srgb, var(--civitai-color-${name}) 82%, black);
    --civitai-color-primary-fg: var(--civitai-color-gray-0);
  }
  `;
};

export class CivitaiButton extends CivitaiElement {
  static formAssociated = true;

  static override styles = [
    hostBaseline,
    spinner,
    intent('info'),
    intent('success'),
    intent('warning'),
    intent('error'),
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
      }
      :host([full-width]) {
        display: flex;
        width: 100%;
      }

      :is(button, a) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        border: 1px solid transparent;
        border-radius: var(--civitai-radius);
        font-family: var(--civitai-font);
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        text-decoration: none;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
        background: var(--civitai-color-primary);
        color: var(--civitai-color-primary-fg);
        border-color: var(--civitai-color-primary);
        height: 36px;
        padding: 0 18px;
        font-size: 14px;
      }
      :is(button, a):hover:not(:disabled):not([aria-disabled='true']) {
        background: var(--civitai-color-primary-hover);
        border-color: var(--civitai-color-primary-hover);
      }

      :host([size='sm']) :is(button, a) {
        height: 30px;
        padding: 0 14px;
        font-size: 13px;
      }
      :host([size='lg']) :is(button, a) {
        height: 44px;
        padding: 0 22px;
        font-size: 16px;
      }

      :host([variant='light']) :is(button, a) {
        background: color-mix(in srgb, var(--civitai-color-primary) 12%, transparent);
        color: var(--civitai-color-primary);
        border-color: transparent;
      }
      :host([variant='light']) :is(button, a):hover:not(:disabled) {
        background: color-mix(in srgb, var(--civitai-color-primary) 22%, transparent);
        border-color: transparent;
      }
      :host([variant='outline']) :is(button, a) {
        background: transparent;
        color: var(--civitai-color-primary);
        border-color: var(--civitai-color-primary);
      }
      :host([variant='outline']) :is(button, a):hover:not(:disabled) {
        background: color-mix(in srgb, var(--civitai-color-primary) 10%, transparent);
        border-color: var(--civitai-color-primary);
      }
      :host([variant='subtle']) :is(button, a) {
        background: transparent;
        color: var(--civitai-color-primary);
        border-color: transparent;
      }
      :host([variant='subtle']) :is(button, a):hover:not(:disabled) {
        background: color-mix(in srgb, var(--civitai-color-primary) 10%, transparent);
        border-color: transparent;
      }

      :is(button, a):disabled,
      a[aria-disabled='true'],
      button[aria-busy='true'] {
        opacity: 0.6;
        cursor: not-allowed;
      }

      slot[name='left']::slotted(*),
      slot[name='right']::slotted(*) {
        display: inline-flex;
        align-items: center;
      }
    `,
  ];

  // Declared as data rather than with decorators so the source needs no
  // transform: Vite 8's oxc cannot lower standard decorators at all.
  static override properties: PropertyDeclarations = {
    variant: { reflect: true },
    color: { reflect: true },
    href: { reflect: true },
    size: { reflect: true },
    loading: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    fullWidth: { type: Boolean, reflect: true, attribute: 'full-width' },
    type: { reflect: true },
  };

  /** Visual style. */
  declare variant: ButtonVariant;
  /** Recolours every variant; absent keeps the primary accent. */
  declare color: Intent | '';
  /** Renders an anchor instead. Navigation is a link, whatever it looks like. */
  declare href: string;
  /** Size preset. */
  declare size: ButtonSize;
  /** Shows a spinner and, like the React binding, disables the control. */
  declare loading: boolean;
  declare disabled: boolean;
  declare fullWidth: boolean;
  /** Matches the native attribute, including its `submit`/`reset` behaviour. */
  declare type: 'button' | 'submit' | 'reset';

  readonly #internals = this.attachInternals();

  constructor() {
    super();
    this.variant = 'filled';
    this.color = '';
    this.href = '';
    this.size = 'md';
    this.loading = false;
    this.disabled = false;
    this.fullWidth = false;
    this.type = 'button';
  }

  /** The form this button would submit, exactly as a native button reports it. */
  get form(): HTMLFormElement | null {
    return this.#internals.form;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // A disabled custom element still receives clicks; the inner control is out
    // of reach of them, so the host has to refuse them itself.
    this.addEventListener('click', this.#gate, { capture: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('click', this.#gate, { capture: true });
  }

  readonly #gate = (event: Event): void => {
    if (!this.disabled && !this.loading) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /**
   * A form does not cross a shadow boundary, so the inner button's implicit
   * submit never reaches the outer form. Form association gives it back.
   */
  #activate(): void {
    const { form } = this.#internals;
    if (!form) return;
    if (this.type === 'submit') form.requestSubmit();
    else if (this.type === 'reset') form.reset();
  }

  #content(): TemplateResult {
    return html`
      ${this.loading ? html`<span class="spinner" data-size="sm" aria-hidden="true"></span>` : ''}
      <slot name="left"></slot>
      <slot></slot>
      <slot name="right"></slot>
    `;
  }

  override render(): TemplateResult {
    const label = this.getAttribute('aria-label') ?? undefined;
    const blocked = this.disabled || this.loading;

    /* A disabled anchor is not a thing, so drop the href and say so — the
       alternative is a link that still navigates while it looks inert. */
    if (this.href !== '') {
      return html`<a
        part="button"
        href=${ifDefined(blocked ? undefined : this.href)}
        aria-disabled=${ifDefined(blocked ? 'true' : undefined)}
        aria-label=${ifDefined(label)}
        >${this.#content()}</a
      >`;
    }

    return html`
      <button
        part="button"
        type="button"
        ?disabled=${blocked}
        aria-busy=${ifDefined(this.loading ? 'true' : undefined)}
        aria-label=${ifDefined(label)}
        @click=${this.#activate}
      >
        ${this.#content()}
      </button>
    `;
  }
}

export function defineCivitaiButton(): void {
  defineElement(TAG, CivitaiButton);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-button': CivitaiButton;
  }
}
