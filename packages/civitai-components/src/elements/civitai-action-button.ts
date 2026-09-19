import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-action-button';

export class CivitaiActionButton extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: inline-flex;
      }
      button {
        /* 0fr to 1fr is the only way to animate a box to its CONTENT width:
           width auto does not interpolate, and a fixed max-width eases wrong. */
        display: inline-grid;
        grid-template-columns: 0fr auto;
        align-items: center;
        height: var(--civitai-action-button-size, 36px);
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: var(--civitai-action-button-bg, var(--civitai-color-surface));
        color: var(--civitai-action-button-fg, var(--civitai-color-text));
        font-family: var(--civitai-font);
        font-size: 13px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
        cursor: pointer;
        box-shadow: 0 2px 10px rgb(0 0 0 / 0.3);
        transition: grid-template-columns 220ms ease;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      button:hover:not(:disabled),
      button:focus-visible,
      :host([expanded]) button {
        grid-template-columns: 1fr auto;
      }

      .label {
        overflow: hidden;
        min-width: 0;
      }
      .text {
        display: block;
        padding-left: 16px;
      }
      .icon {
        display: inline-grid;
        place-items: center;
        width: var(--civitai-action-button-size, 36px);
        height: var(--civitai-action-button-size, 36px);
      }
      .icon > * {
        grid-area: 1 / 1;
      }
      .icon ::slotted(*) {
        width: 16px;
        height: 16px;
      }
      /* Inverted chip, so the icon still reads once the pill has opened out. */
      :host([data-swaps]) .chip {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        margin-right: 5px;
        border-radius: 50%;
        background: var(--civitai-action-button-fg, var(--civitai-color-text));
        color: var(--civitai-action-button-bg, var(--civitai-color-surface));
        opacity: 0;
        transition: opacity 140ms ease 60ms;
      }
      :host([data-swaps]) .resting {
        transition: opacity 140ms ease;
      }
      :host([data-swaps]) button:hover:not(:disabled) .resting,
      :host([data-swaps]) button:focus-visible .resting,
      :host([data-swaps][expanded]) .resting {
        opacity: 0;
      }
      :host([data-swaps]) button:hover:not(:disabled) .chip,
      :host([data-swaps]) button:focus-visible .chip,
      :host([data-swaps][expanded]) .chip {
        opacity: 1;
      }

      @media (prefers-reduced-motion: reduce) {
        .chip,
        .resting {
          transition: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        button {
          transition: none;
        }
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    label: { reflect: true },
    expanded: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
  };

  /** Hidden until hover or focus, and the button's accessible name throughout. */
  declare label: string;
  /** Holds it open — a touch screen has no hover to reveal it with. */
  declare expanded: boolean;
  declare disabled: boolean;

  constructor() {
    super();
    this.label = '';
    this.expanded = false;
    this.disabled = false;
  }

  // The swap is CSS-driven so it cannot fall out of step with :hover, but the
  // rules only apply when a second icon was actually given.
  readonly #onSwapSlot = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    this.toggleAttribute('data-swaps', slot.assignedElements().length > 0);
  };

  override render(): TemplateResult {
    return html`<button
      part="button"
      type="button"
      ?disabled=${this.disabled}
      aria-label=${ifDefined(this.label || undefined)}
    >
      <span class="label" part="label"><span class="text">${this.label}</span></span>
      <span class="icon" part="icon">
        <span class="resting"><slot name="icon"></slot></span>
        <span class="chip" part="icon-expanded"
          ><slot name="icon-expanded" @slotchange=${this.#onSwapSlot}></slot
        ></span>
      </span>
    </button>`;
  }
}

export function defineCivitaiActionButton(): void {
  defineElement(TAG, CivitaiActionButton);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-action-button': CivitaiActionButton;
  }
}
