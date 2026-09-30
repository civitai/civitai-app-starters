import { CivitaiElement, defineElement, hostBaseline } from '@civitai/components/internals';
import '@civitai/components/civitai-modal/define';
import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import { media, mediaSizes, type MediaKind } from './media.js';

const TAG = 'civitai-chat-lightbox';

/** One file at full size, with room for details and actions under it; details alone while there is no file yet. */
export class CivitaiChatLightbox extends CivitaiElement {
  static override styles = [
    hostBaseline,
    mediaSizes,
    css`
      .body {
        display: grid;
        gap: 20px;
      }
      :host([with-details]) [data-mode='full'] {
        --cvt-media-max-height: 60vh;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 12px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    open: { type: Boolean, reflect: true },
    heading: { reflect: true },
    kind: { reflect: true },
    src: {},
    alt: {},
    withDetails: { type: Boolean, reflect: true, attribute: 'with-details' },
  };

  declare open: boolean;
  declare heading: string;
  declare kind: MediaKind;
  declare src: string;
  declare alt: string;
  /** Leaves room under the media for the `details` slot. */
  declare withDetails: boolean;

  constructor() {
    super();
    this.open = false;
    this.heading = '';
    this.kind = 'image';
    this.src = '';
    this.alt = '';
    this.withDetails = false;
  }

  show(): void {
    this.open = true;
  }

  hide(): void {
    this.open = false;
  }

  toggle(): void {
    this.open = !this.open;
  }

  #onClose = (): void => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  };

  override render(): TemplateResult {
    return html`<civitai-modal .open=${this.open} .heading=${this.heading} size="xl" with-close-button @close=${this.#onClose}>
      <div class="body" part="body">
        ${this.src ? media({ kind: this.kind, mode: 'full', src: this.src, alt: this.alt }) : nothing}
        <slot name="details"></slot>
      </div>
      <div class="actions" part="actions"><slot name="actions"></slot></div>
    </civitai-modal>`;
  }
}

export function defineCivitaiChatLightbox(): void {
  defineElement(TAG, CivitaiChatLightbox);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-lightbox': CivitaiChatLightbox;
  }
}
