import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import type { CivitaiNavItem } from './civitai-nav-item.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-nav-list';
const ITEM_TAG = 'civitai-nav-item';

/**
 * Marks the item matching `current` and opens the groups above it, which is
 * the part every sidebar gets wrong: landing on a nested route with the
 * section that contains it still collapsed.
 */
export class CivitaiNavList extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    current: { reflect: true },
    label: { reflect: true },
  };

  /** The `href` of the page being shown. Matching is exact. */
  declare current: string;
  /** Names the landmark. Set it on the ROOT list only; nested ones inherit it. */
  declare label: string;

  constructor() {
    super();
    this.current = '';
    this.label = '';
  }

  get #items(): CivitaiNavItem[] {
    return [...this.querySelectorAll<CivitaiNavItem>(ITEM_TAG)];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    queueMicrotask(() => this.#sync());
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('current')) this.#sync();
  }

  #sync(): void {
    if (this.current === '') return;
    for (const item of this.#items) {
      const matches = item.href === this.current;
      item.current = matches;
      if (!matches) continue;
      for (let node = item.parentElement; node && node !== this; node = node.parentElement) {
        if (node.tagName.toLowerCase() === ITEM_TAG) (node as CivitaiNavItem).expanded = true;
      }
    }
  }

  readonly #onSlotChange = (): void => {
    this.#sync();
  };

  override render(): TemplateResult {
    const list = html`<div class="list" part="list" role="list">
      <slot @slotchange=${this.#onSlotChange}></slot>
    </div>`;

    return this.label !== ''
      ? html`<nav part="nav" aria-label=${ifDefined(this.label)}>${list}</nav>`
      : html`${list}${nothing}`;
  }
}

export function defineCivitaiNavList(): void {
  defineElement(TAG, CivitaiNavList);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-nav-list': CivitaiNavList;
  }
}
