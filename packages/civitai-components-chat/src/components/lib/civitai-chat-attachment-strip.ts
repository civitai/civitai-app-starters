import { CivitaiElement, defineElement, hostBaseline } from '@civitai/components/internals';
import '@civitai/components/civitai-progress/define';
import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { media, mediaSizes, type MediaKind } from './media.js';

const TAG = 'civitai-chat-attachment-strip';

export interface StripItem {
  key: string;
  kind: MediaKind;
  src?: string;
  label?: string;
  /** 0..1 while uploading; absent once done. */
  progress?: number;
  error?: string;
  blocked?: boolean;
}

/** A row of file thumbnails, optionally removable, showing upload progress and failures. */
export class CivitaiChatAttachmentStrip extends CivitaiElement {
  static override styles = [
    hostBaseline,
    mediaSizes,
    css`
      :host {
        display: block;
      }
      ul {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        position: relative;
        width: var(--cvt-strip-size, 72px);
      }
      :host([size='sm']) li {
        width: 56px;
      }
      .progress {
        position: absolute;
        inset: auto 4px 4px;
      }
      .error {
        margin-top: 2px;
        font-size: 11px;
        line-height: 1.2;
        color: var(--civitai-color-error);
      }
      .remove {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 50%;
        background: var(--civitai-color-gray-7, #495057);
        color: #fff;
        font-size: 14px;
        line-height: 22px;
        cursor: pointer;
      }
      .remove:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 2px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    items: { attribute: false },
    removable: { type: Boolean, reflect: true },
    size: { reflect: true },
  };

  declare items: StripItem[];
  declare removable: boolean;
  declare size: 'sm' | 'md';

  constructor() {
    super();
    this.items = [];
    this.removable = false;
    this.size = 'md';
  }

  #dispatch(type: 'remove' | 'open', key: string): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: { key } }));
  }

  override render(): TemplateResult {
    return html`<ul part="list">
      ${repeat(
        this.items,
        (item) => item.key,
        (item) => html`<li part="item">
          ${media({
            kind: item.kind,
            mode: 'thumb',
            src: item.src,
            alt: item.label,
            pending: !item.src && !item.error,
            blocked: item.blocked === true,
            onOpen: () => this.#dispatch('open', item.key),
          })}
          ${item.progress !== undefined && item.progress < 1
            ? html`<civitai-progress class="progress" size="sm" .value=${Math.round(item.progress * 100)} label="Uploading"></civitai-progress>`
            : nothing}
          ${item.error ? html`<div class="error" role="alert">${item.error}</div>` : nothing}
          ${this.removable
            ? html`<button class="remove" part="remove" aria-label=${`Remove ${item.label ?? 'file'}`} @click=${() => this.#dispatch('remove', item.key)}>×</button>`
            : nothing}
        </li>`,
      )}
    </ul>`;
  }
}

export function defineCivitaiChatAttachmentStrip(): void {
  defineElement(TAG, CivitaiChatAttachmentStrip);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-attachment-strip': CivitaiChatAttachmentStrip;
  }
}
