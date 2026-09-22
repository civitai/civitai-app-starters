import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

/** The off-site content-rating ladder, as `block.manifest.json` spells it. */
export type ContentRating = 'g' | 'pg' | 'pg13' | 'r' | 'x';

const TAG = 'civitai-rating-badge';

// Spelled out because `PG-13`'s hyphen is what no mechanical transform of
// `pg13` produces, and two spellings of one rating is the bug this prevents.
const LABELS: Record<ContentRating, string> = {
  g: 'G',
  pg: 'PG',
  pg13: 'PG-13',
  r: 'R',
  x: 'X',
};

export class CivitaiRatingBadge extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 8px;
        border: 1px solid var(--civitai-color-border);
        border-radius: 999px;
        background: var(--civitai-color-surface-2);
        color: var(--civitai-color-text);
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      :host([rating='pg13']) {
        background: var(--civitai-color-warning);
        border-color: var(--civitai-color-warning);
        color: var(--civitai-color-primary-fg);
      }
      :host([rating='r']),
      :host([rating='x']) {
        background: var(--civitai-color-error);
        border-color: var(--civitai-color-error);
        color: var(--civitai-color-primary-fg);
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    rating: { reflect: true },
  };

  declare rating: string;

  constructor() {
    super();
    this.rating = '';
  }

  override render(): TemplateResult {
    // An unrecognised value shows verbatim: it is a stored word, and inventing
    // a prettier spelling for it is exactly what this vocabulary prevents.
    return html`${LABELS[this.rating as ContentRating] ?? this.rating}`;
  }
}

export function defineCivitaiRatingBadge(): void {
  defineElement(TAG, CivitaiRatingBadge);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-rating-badge': CivitaiRatingBadge;
  }
}
