import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { abbreviateCount } from './format.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-reaction';

export interface ReactionDetail {
  emoji: string;
  reacted: boolean;
  count: number;
}

export class CivitaiReaction extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: inline-flex;
      }
      button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 26px;
        padding: 0 9px;
        border: 1px solid transparent;
        border-radius: 999px;
        background: color-mix(in srgb, var(--civitai-color-text) 10%, transparent);
        color: var(--civitai-color-text);
        font-family: var(--civitai-font);
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
      }
      button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--civitai-color-text) 18%, transparent);
      }
      button[aria-pressed='true'] {
        background: color-mix(in srgb, var(--civitai-color-primary) 22%, transparent);
        border-color: var(--civitai-color-primary);
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .emoji {
        font-size: 14px;
        line-height: 1;
      }
      .count {
        font-variant-numeric: tabular-nums;
        /* civitai.com abbreviates lowercase and uppercases in CSS. */
        text-transform: uppercase;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    emoji: { reflect: true },
    count: { type: Number, reflect: true },
    reacted: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    label: { reflect: true },
  };

  declare emoji: string;
  declare count: number;
  /** Whether the viewer has already reacted — the pressed state. */
  declare reacted: boolean;
  declare disabled: boolean;
  /** Names the reaction for a screen reader, e.g. "Like". */
  declare label: string;

  constructor() {
    super();
    this.emoji = '';
    this.count = 0;
    this.reacted = false;
    this.disabled = false;
    this.label = '';
  }

  #toggle(): void {
    const reacted = !this.reacted;
    // Optimistic, like the site: the host reverts by setting the property back
    // if the write fails.
    this.reacted = reacted;
    this.count = Math.max(0, this.count + (reacted ? 1 : -1));
    const detail: ReactionDetail = { emoji: this.emoji, reacted, count: this.count };
    this.dispatchEvent(new CustomEvent('react', { detail, bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    return html`<button
      part="button"
      type="button"
      aria-pressed=${this.reacted ? 'true' : 'false'}
      aria-label=${this.label || this.emoji}
      ?disabled=${this.disabled}
      @click=${() => this.#toggle()}
    >
      <span class="emoji" part="emoji" aria-hidden="true">${this.emoji}</span>
      <span class="count" part="count">${abbreviateCount(this.count)}</span>
    </button>`;
  }
}

export function defineCivitaiReaction(): void {
  defineElement(TAG, CivitaiReaction);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-reaction': CivitaiReaction;
  }
}
