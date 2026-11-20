import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-nav-item';

let sequence = 0;

/**
 * A link, or a group of them. `href` decides which: a group is a disclosure
 * button over its own children, never an anchor that also toggles.
 */
export class CivitaiNavItem extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        box-sizing: border-box;
        /* Depth is set by the item itself, so nesting indents without the
           consumer counting levels in their markup. */
        padding: 6px 10px 6px calc(10px + var(--civitai-nav-depth, 0) * 14px);
        border: 0;
        border-radius: var(--civitai-radius);
        background: transparent;
        color: var(--civitai-color-text-dimmed);
        font: inherit;
        font-size: 14px;
        text-align: start;
        text-decoration: none;
        cursor: pointer;
      }
      .row:hover {
        background: color-mix(in srgb, var(--civitai-color-text) 8%, transparent);
        color: var(--civitai-color-text);
      }
      .row:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: -2px;
      }
      .row[aria-current='page'] {
        background: var(--civitai-color-primary-light);
        color: var(--civitai-color-primary);
        font-weight: 600;
      }
      :host([disabled]) .row {
        opacity: 0.5;
        pointer-events: none;
      }
      .label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chevron {
        flex: none;
        transition: rotate 140ms ease;
      }
      :host([expanded]) .chevron {
        rotate: 90deg;
      }
      slot[name='icon']::slotted(*) {
        flex: none;
        width: 16px;
        height: 16px;
      }
      /* 0fr to 1fr is what animates a box to its CONTENT height; height auto
         does not interpolate. */
      .children {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 160ms ease;
      }
      :host([expanded]) .children {
        grid-template-rows: 1fr;
      }
      .children > div {
        overflow: hidden;
      }
      @media (prefers-reduced-motion: reduce) {
        .children,
        .chevron {
          transition: none;
        }
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    href: { reflect: true },
    label: { reflect: true },
    current: { type: Boolean, reflect: true },
    expanded: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    group: { type: Boolean, reflect: true, state: true },
  };

  declare href: string;
  /** Used when the item has no text of its own to read. */
  declare label: string;
  declare current: boolean;
  declare expanded: boolean;
  declare disabled: boolean;
  /** Set by the element once it sees nested items. */
  declare group: boolean;

  readonly #id = `ci-nav-${(sequence += 1)}`;

  constructor() {
    super();
    this.href = '';
    this.label = '';
    this.current = false;
    this.expanded = false;
    this.disabled = false;
    this.group = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    let depth = 0;
    for (let node = this.parentElement; node; node = node.parentElement) {
      if (node.tagName.toLowerCase() === TAG) depth += 1;
    }
    this.style.setProperty('--civitai-nav-depth', String(depth));
  }

  toggle(): void {
    if (this.group) this.expanded = !this.expanded;
  }

  readonly #onSlotChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    this.group = slot.assignedElements().some((el) => el.tagName.toLowerCase() === TAG);
  };

  override render(): TemplateResult {
    const body = html`<slot name="icon"></slot>
      <span class="label" part="label">${this.label || html`<slot name="label"></slot>`}</span>`;

    return html`
      ${this.href !== '' && !this.group
        ? html`<a
            class="row"
            part="link"
            href=${this.href}
            aria-current=${this.current ? 'page' : nothing}
            aria-disabled=${ifDefined(this.disabled ? 'true' : undefined)}
            >${body}</a
          >`
        : html`<button
            class="row"
            part="button"
            type="button"
            aria-expanded=${this.expanded ? 'true' : 'false'}
            aria-controls="${this.#id}-children"
            ?disabled=${this.disabled}
            @click=${() => this.toggle()}
          >
            ${body}
            <span class="chevron" part="chevron" aria-hidden="true">›</span>
          </button>`}
      <div class="children" part="children" id="${this.#id}-children">
        <div><slot @slotchange=${this.#onSlotChange}></slot></div>
      </div>
    `;
  }
}

export function defineCivitaiNavItem(): void {
  defineElement(TAG, CivitaiNavItem);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-nav-item': CivitaiNavItem;
  }
}
