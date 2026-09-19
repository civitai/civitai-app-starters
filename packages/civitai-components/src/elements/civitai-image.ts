import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type ImageFit = 'cover' | 'contain';
export type ImageStatus = 'loading' | 'loaded' | 'error';

const TAG = 'civitai-image';

export class CivitaiImage extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        position: relative;
        display: block;
        overflow: hidden;
        background: var(--civitai-color-media-placeholder, var(--civitai-color-gray-2));
        border-radius: var(--civitai-radius);
      }
      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 1;
        transition: opacity 200ms ease;
      }
      img[data-fit='contain'] {
        object-fit: contain;
      }
      :host([status='loading']) img,
      :host([status='error']) img {
        opacity: 0;
      }
      .fallback {
        position: absolute;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 8px;
        color: var(--civitai-color-text-dimmed);
        font-size: 13px;
        text-align: center;
      }
      :host([status='error']) .fallback {
        display: flex;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    src: { reflect: true },
    alt: { reflect: true },
    fit: { reflect: true },
    fallback: { reflect: true },
    // Derived, not a default anyone resets to, so reflecting it is what lets
    // `:host([status='error'])` and a consumer's own CSS see the state.
    status: { reflect: true },
  };

  declare src: string;
  declare alt: string;
  declare fit: ImageFit;
  /** Text shown when the image fails; the `fallback` slot wins over it. */
  declare fallback: string;
  declare status: ImageStatus;

  constructor() {
    super();
    this.src = '';
    this.alt = '';
    this.fit = 'cover';
    this.fallback = '';
    this.status = 'loading';
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    // After the cycle, not inside it: reading `complete` needs the rendered
    // <img>, and settling during `updated` schedules a second update.
    if (changed.has('src')) void this.updateComplete.then(() => this.#reconcile());
  }

  /**
   * A cached image can already be `complete` before the listeners attach, so
   * neither `load` nor `error` ever fires. The failed arm is defensive and
   * mirrors the React binding: every failure observed here settles via the
   * `error` event first, so mutating it does not fail a test.
   */
  #reconcile(): void {
    const img = this.renderRoot.querySelector('img');
    if (!img?.complete || !img.currentSrc) {
      this.status = 'loading';
      return;
    }
    this.#settle(img.naturalWidth > 0 ? 'loaded' : 'error');
  }

  #settle(next: ImageStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.dispatchEvent(new Event(next === 'error' ? 'error' : 'load', { composed: true }));
  }

  override render(): TemplateResult {
    return html`
      <img
        part="image"
        src=${ifDefined(this.src || undefined)}
        alt=${this.alt}
        data-fit=${this.fit}
        @load=${() => this.#settle('loaded')}
        @error=${() => this.#settle('error')}
      />
      ${this.status === 'error'
        ? html`<div class="fallback" part="fallback">
            <slot name="fallback">${this.fallback || nothing}</slot>
          </div>`
        : nothing}
    `;
  }
}

export function defineCivitaiImage(): void {
  defineElement(TAG, CivitaiImage);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-image': CivitaiImage;
  }
}
