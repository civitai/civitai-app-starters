import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-pagination';

/** A gap in the run of pages, rendered as an ellipsis rather than a button. */
const GAP = 0;

export class CivitaiPagination extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
      }
      nav {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      button {
        min-width: 32px;
        height: 32px;
        padding: 0 8px;
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius);
        background: var(--civitai-color-surface);
        color: var(--civitai-color-text);
        font-family: var(--civitai-font);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      button:hover:not(:disabled) {
        background: var(--civitai-color-surface-2);
      }
      button:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 2px;
      }
      button[aria-current='page'] {
        background: var(--civitai-color-primary);
        border-color: var(--civitai-color-primary);
        color: var(--civitai-color-primary-fg);
        font-weight: 600;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .gap {
        min-width: 32px;
        text-align: center;
        color: var(--civitai-color-text-dimmed);
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    page: { type: Number, reflect: true },
    total: { type: Number, reflect: true },
    siblings: { type: Number, reflect: true },
    label: { reflect: true },
    previousLabel: { reflect: true, attribute: 'previous-label' },
    nextLabel: { reflect: true, attribute: 'next-label' },
  };

  /** 1-based, as every page number a reader ever sees is. */
  declare page: number;
  declare total: number;
  /** How many pages to keep either side of the current one. */
  declare siblings: number;
  declare label: string;
  declare previousLabel: string;
  declare nextLabel: string;

  constructor() {
    super();
    this.page = 1;
    this.total = 1;
    this.siblings = 1;
    this.label = 'Pagination';
    this.previousLabel = 'Previous';
    this.nextLabel = 'Next';
  }

  get #current(): number {
    return Math.min(Math.max(Math.round(this.page), 1), Math.max(this.total, 1));
  }

  /**
   * First and last always show, so the run stays a fixed width and the buttons
   * do not move under the pointer as you page through.
   */
  get #pages(): number[] {
    const total = Math.max(this.total, 1);
    const current = this.#current;
    const span = Math.max(this.siblings, 0);

    const wanted = new Set<number>([1, total]);
    for (let page = current - span; page <= current + span; page += 1) {
      if (page >= 1 && page <= total) wanted.add(page);
    }

    const run = [...wanted].sort((a, b) => a - b);
    const withGaps: number[] = [];
    for (const [index, page] of run.entries()) {
      const previous = run[index - 1];
      if (previous !== undefined && page - previous > 1) withGaps.push(GAP);
      withGaps.push(page);
    }
    return withGaps;
  }

  #go(next: number): void {
    const clamped = Math.min(Math.max(next, 1), Math.max(this.total, 1));
    if (clamped === this.#current) return;
    this.page = clamped;
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    const current = this.#current;
    const total = Math.max(this.total, 1);

    return html`
      <nav part="nav" aria-label=${this.label}>
        <button
          type="button"
          part="previous"
          ?disabled=${current <= 1}
          aria-label=${this.previousLabel}
          @click=${() => this.#go(current - 1)}
        >
          ‹
        </button>
        ${this.#pages.map((page, index) =>
          page === GAP
            ? html`<span class="gap" part="gap" aria-hidden="true" data-gap=${index}>…</span>`
            : html`<button
                type="button"
                part="page"
                data-page=${page}
                aria-current=${page === current ? 'page' : nothing}
                aria-label=${`Page ${page}`}
                @click=${() => this.#go(page)}
              >
                ${page}
              </button>`
        )}
        <button
          type="button"
          part="next"
          ?disabled=${current >= total}
          aria-label=${this.nextLabel}
          @click=${() => this.#go(current + 1)}
        >
          ›
        </button>
      </nav>
    `;
  }
}

export function defineCivitaiPagination(): void {
  defineElement(TAG, CivitaiPagination);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-pagination': CivitaiPagination;
  }
}
