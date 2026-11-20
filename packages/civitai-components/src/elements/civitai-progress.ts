import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-progress';

export type ProgressColor = 'primary' | 'success' | 'warning' | 'error';

export class CivitaiProgress extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        --civitai-progress-accent: var(--civitai-color-primary);
        display: block;
      }
      :host([color='success']) { --civitai-progress-accent: var(--civitai-color-success); }
      :host([color='warning']) { --civitai-progress-accent: var(--civitai-color-warning); }
      :host([color='error']) { --civitai-progress-accent: var(--civitai-color-error); }

      .track {
        position: relative;
        overflow: hidden;
        height: 8px;
        border-radius: 999px;
        background: var(--civitai-color-track, var(--civitai-color-gray-2));
      }
      :host([size='sm']) .track { height: 4px; }
      :host([size='lg']) .track { height: 14px; }

      .bar {
        height: 100%;
        border-radius: inherit;
        background: var(--civitai-progress-accent);
        transition: width 200ms ease;
      }

      /* An indeterminate bar owns no width, so it sweeps instead of filling. */
      :host([indeterminate]) .bar {
        width: 40%;
        animation: sweep 1.1s ease-in-out infinite;
      }
      @keyframes sweep {
        from { margin-inline-start: -40%; }
        to { margin-inline-start: 100%; }
      }
      @media (prefers-reduced-motion: reduce) {
        :host([indeterminate]) .bar { animation-duration: 3s; }
        .bar { transition: none; }
      }

      .readout {
        margin-block-end: 4px;
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        color: var(--civitai-color-text-dimmed);
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    value: { type: Number, reflect: true },
    max: { type: Number, reflect: true },
    label: { reflect: true },
    color: { reflect: true },
    size: { reflect: true },
    indeterminate: { type: Boolean, reflect: true },
    showValue: { type: Boolean, reflect: true, attribute: 'show-value' },
  };

  declare value: number;
  declare max: number;
  /** Names the bar for a screen reader, and shows above it when given. */
  declare label: string;
  declare color: ProgressColor | '';
  declare size: 'sm' | 'md' | 'lg';
  /** Work is running but its extent is unknown. */
  declare indeterminate: boolean;
  declare showValue: boolean;

  constructor() {
    super();
    this.value = 0;
    this.max = 100;
    this.label = '';
    this.color = '';
    this.size = 'md';
    this.indeterminate = false;
    this.showValue = false;
  }

  get #fraction(): number {
    if (this.max <= 0) return 0;
    return Math.min(Math.max(this.value / this.max, 0), 1);
  }

  override render(): TemplateResult {
    const percent = Math.round(this.#fraction * 100);
    return html`
      ${this.label !== '' || this.showValue
        ? html`<div class="readout" part="readout">
            <span part="label">${this.label}</span>
            ${this.showValue && !this.indeterminate
              ? html`<span part="value">${percent}%</span>`
              : nothing}
          </div>`
        : nothing}
      <div
        class="track"
        part="track"
        role="progressbar"
        aria-label=${ifDefined(this.label || (this.getAttribute('aria-label') ?? undefined))}
        aria-valuemin="0"
        aria-valuemax=${ifDefined(this.indeterminate ? undefined : this.max)}
        aria-valuenow=${ifDefined(this.indeterminate ? undefined : this.value)}
      >
        <div
          class="bar"
          part="bar"
          style=${styleMap(this.indeterminate ? {} : { width: `${percent}%` })}
        ></div>
      </div>
    `;
  }
}

export function defineCivitaiProgress(): void {
  defineElement(TAG, CivitaiProgress);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-progress': CivitaiProgress;
  }
}
