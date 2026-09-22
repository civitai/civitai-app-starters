import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

import { CivitaiElement } from './base.js';
import type { ContentRating } from './civitai-rating-badge.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-tag';

/** `1` up, `-1` down, `0` none — the numbers the site's tag API already uses. */
export type TagVote = 1 | 0 | -1;

export interface TagVoteDetail {
  name: string;
  vote: TagVote;
}

const CHEVRON = (up: boolean): TemplateResult =>
  html`<svg viewBox="0 0 10 6" aria-hidden="true" part=${up ? 'up-icon' : 'down-icon'}>
    <path d=${up ? 'M5 0 10 6 0 6Z' : 'M5 6 0 0 10 0Z'} fill="currentColor" />
  </svg>`;

export class CivitaiTag extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        --civitai-tag-accent: var(--civitai-color-primary);
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 8px;
        border: 1px solid var(--civitai-color-border);
        border-radius: 999px;
        background: var(--civitai-color-surface-2);
        color: var(--civitai-color-text);
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        white-space: nowrap;
        position: relative;
        overflow: hidden;
        isolation: isolate;
      }
      :host([rating='pg13']) {
        --civitai-tag-accent: var(--civitai-color-warning);
        border-color: var(--civitai-tag-accent);
      }
      :host([rating='r']),
      :host([rating='x']) {
        --civitai-tag-accent: var(--civitai-color-error);
        border-color: var(--civitai-tag-accent);
      }

      /* Negative z-index paints over the host background but under the content,
         so the bar needs no wrapper and the content needs no stacking rules. */
      .fill {
        position: absolute;
        inset: 0 auto 0 0;
        z-index: -1;
        background: color-mix(in srgb, var(--civitai-tag-accent) 25%, transparent);
      }

      .votes {
        display: inline-flex;
        align-items: center;
        gap: 1px;
      }
      button {
        display: inline-flex;
        align-items: center;
        padding: 2px;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: var(--civitai-color-text-dimmed);
        cursor: pointer;
      }
      button:hover {
        background: color-mix(in srgb, var(--civitai-color-text) 10%, transparent);
      }
      button:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: -2px;
      }
      button[aria-pressed='true'].up {
        color: var(--civitai-color-success);
      }
      button[aria-pressed='true'].down {
        color: var(--civitai-color-error);
      }
      svg {
        width: 8px;
        height: 5px;
        display: block;
      }
      .score {
        color: var(--civitai-color-text-dimmed);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    name: { reflect: true },
    score: { type: Number, reflect: true },
    confidence: { type: Number, reflect: true },
    vote: { type: Number, reflect: true },
    rating: { reflect: true },
    readOnly: { type: Boolean, reflect: true, attribute: 'readonly' },
    showScore: { type: Boolean, reflect: true, attribute: 'show-score' },
  };

  declare name: string;
  declare score: number;
  /** 0–1 from the tagger. `null` leaves the bar off entirely. */
  declare confidence: number | null;
  declare vote: TagVote;
  declare rating: ContentRating | '';
  /** Drops the vote controls; the pill stays. */
  declare readOnly: boolean;
  declare showScore: boolean;

  constructor() {
    super();
    this.name = '';
    this.score = 0;
    this.confidence = null;
    this.vote = 0;
    this.rating = '';
    this.readOnly = false;
    this.showScore = false;
  }

  // Pressing the side you already chose clears the vote, which is what the
  // site's own tag control does.
  #cast(direction: 1 | -1): void {
    const next: TagVote = this.vote !== direction ? direction : 0;
    this.vote = next;
    const detail: TagVoteDetail = { name: this.name, vote: next };
    this.dispatchEvent(new CustomEvent('vote', { detail, bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    const fill = this.confidence === null ? null : Math.min(Math.max(this.confidence, 0), 1);
    return html`
      ${fill === null
        ? nothing
        : html`<span
            class="fill"
            part="fill"
            style=${styleMap({ width: `${fill * 100}%` })}
          ></span>`}
      ${this.readOnly
        ? nothing
        : html`<span class="votes" part="votes">
            <button
              class="up"
              part="up"
              type="button"
              aria-pressed=${this.vote === 1 ? 'true' : 'false'}
              aria-label=${`Upvote ${this.name}`}
              @click=${() => this.#cast(1)}
            >
              ${CHEVRON(true)}
            </button>
            <button
              class="down"
              part="down"
              type="button"
              aria-pressed=${this.vote === -1 ? 'true' : 'false'}
              aria-label=${`Downvote ${this.name}`}
              @click=${() => this.#cast(-1)}
            >
              ${CHEVRON(false)}
            </button>
          </span>`}
      <span part="label">${this.name}</span>
      ${this.showScore ? html`<span class="score" part="score">${this.score}</span>` : nothing}
      <slot name="menu"></slot>
    `;
  }
}

export function defineCivitaiTag(): void {
  defineElement(TAG, CivitaiTag);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-tag': CivitaiTag;
  }
}
