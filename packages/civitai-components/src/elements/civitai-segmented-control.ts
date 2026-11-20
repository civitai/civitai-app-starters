import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiField, fieldStyles } from './field-base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type SegmentedControlSize = 'sm' | 'md' | 'lg';

export interface SegmentItem {
  value: string;
  label: string;
  disabled?: boolean;
}

const TAG = 'civitai-segmented-control';
const NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/**
 * A panel-less value switch: `radiogroup` of `radio`s. Tabs are NOT a mode here
 * — a tab's `aria-controls` is an IDREF, and an IDREF cannot reach a panel in
 * the light DOM from inside this shadow root, so tabs need their own element.
 */
export class CivitaiSegmentedControl extends CivitaiField {
  static override styles = [
    hostBaseline,
    fieldStyles,
    css`
      /* Inline so the control shrinks to its segments rather than filling the
         row, and flex-start so a label wider than them does not stretch them. */
      :host {
        display: inline-flex;
        align-items: flex-start;
        max-width: 100%;
      }
      .group {
        display: inline-flex;
        gap: 2px;
        padding: 4px;
        background: var(--civitai-color-segmented-bg, var(--civitai-color-gray-1));
        border-radius: var(--civitai-radius);
        max-width: 100%;
        overflow-x: auto;
      }
      button {
        -webkit-appearance: none;
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        background: transparent;
        color: var(--civitai-color-text-dimmed);
        font-family: var(--civitai-font);
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        border-radius: calc(var(--civitai-radius) - 1px);
        transition: background-color 120ms ease, color 120ms ease;
        height: 30px;
        padding: 0 14px;
        font-size: 13px;
      }
      :host([size='sm']) button {
        height: 26px;
        padding: 0 10px;
        font-size: 12px;
      }
      :host([size='lg']) button {
        height: 38px;
        padding: 0 18px;
        font-size: 15px;
      }
      button:hover:not(:disabled):not([aria-checked='true']) {
        color: var(--civitai-color-text);
      }
      button[aria-checked='true'] {
        background: var(--civitai-color-surface);
        color: var(--civitai-color-text);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
      }
      button:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 2px;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    ...CivitaiField.properties,
    data: { attribute: false },
    size: { reflect: true },
  };

  declare data: SegmentItem[];
  declare size: SegmentedControlSize;

  constructor() {
    super();
    this.data = [];
    this.size = 'md';
  }

  /** Reset falls back to the first enabled segment, as a radio group always has one. */
  override formResetCallback(): void {
    this.value = this.getAttribute('value') ?? this.#enabled[0]?.value ?? '';
  }

  protected override formValue(): string {
    return this.#selected;
  }

  protected override get missing(): boolean {
    return this.#selected === '';
  }

  protected override get missingMessage(): string {
    return 'Please select one of these options.';
  }

  get #enabled(): SegmentItem[] {
    return this.data.filter((item) => !item.disabled);
  }

  /** Falls back to the first enabled segment, as a radio group always has one. */
  get #selected(): string {
    const known = this.data.some((item) => item.value === this.value);
    return known ? this.value : (this.#enabled[0]?.value ?? '');
  }

  #select(next: string, moveFocus: boolean): void {
    if (next !== this.#selected) {
      this.value = next;
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    if (!moveFocus) return;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLButtonElement>(`button[data-value="${next}"]`)?.focus();
    });
  }

  /**
   * WAI-ARIA roving tabindex: arrows wrap across the enabled segments and
   * selection follows focus, so the group is one tab stop rather than N.
   */
  #onKeyDown(event: KeyboardEvent): void {
    const values = this.#enabled.map((item) => item.value);
    if (!NAV_KEYS.includes(event.key) || values.length === 0) return;
    event.preventDefault();

    const current = Math.max(0, values.indexOf(this.#selected));
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (current + 1) % values.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + values.length) % values.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else {
      next = values.length - 1;
    }
    this.#select(values[next]!, true);
  }

  protected override renderControl(): TemplateResult {
    const selected = this.#selected;

    return html`
      <div
        class="group"
        part="group control"
        role="radiogroup"
        aria-label=${ifDefined(this.getAttribute('aria-label') ?? undefined)}
        aria-labelledby=${ifDefined(this.getAttribute('aria-labelledby') ?? undefined)}
        @keydown=${this.#onKeyDown}
      >
        ${this.data.map((item) => {
          const isSelected = item.value === selected;
          return html`
            <button
              type="button"
              part="segment"
              data-value=${item.value}
              role="radio"
              aria-checked=${String(isSelected)}
              tabindex=${isSelected ? 0 : -1}
              ?disabled=${this.disabled || (item.disabled ?? false)}
              @click=${() => this.#select(item.value, false)}
            >
              ${item.label}
            </button>
          `;
        })}
      </div>
    `;
  }
}

export function defineCivitaiSegmentedControl(): void {
  defineElement(TAG, CivitaiSegmentedControl);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-segmented-control': CivitaiSegmentedControl;
  }
}
