import { CivitaiElement, defineElement, hostBaseline } from '@civitai/components/internals';
import '@civitai/components/civitai-badge/define';
import '@civitai/components/civitai-media-card/define';
import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

const TAG = 'civitai-chat-model-card';

/** A Civitai model as a picture and a name, linking to its page; with `action`, a button for it emits `model-use`. */
export class CivitaiChatModelCard extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
        width: var(--cvt-model-card-width, 180px);
        --civitai-media-card-ratio: 3 / 4;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .text {
        display: grid;
        gap: 2px;
        color: #fff;
      }
      .name {
        font-weight: 600;
        font-size: 14px;
        line-height: 1.2;
      }
      .creator {
        font-size: 12px;
        opacity: 0.85;
      }
      .use {
        justify-self: start;
        margin-top: 6px;
        padding: 4px 10px;
        border: none;
        border-radius: 999px;
        background: var(--civitai-color-primary);
        color: var(--civitai-color-primary-fg, #fff);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    name: { reflect: true },
    creator: { reflect: true },
    image: {},
    href: { reflect: true },
    kind: { reflect: true },
    action: {},
  };

  declare name: string;
  declare creator: string;
  declare image: string;
  declare href: string;
  /** A short label such as "LoRA · Illustrious". */
  declare kind: string;
  /** A label such as "Use in panel"; empty for none. */
  declare action: string;

  constructor() {
    super();
    this.name = '';
    this.creator = '';
    this.image = '';
    this.href = '';
    this.kind = '';
    this.action = '';
  }

  override render(): TemplateResult {
    return html`<civitai-media-card .href=${this.href} .label=${this.name}>
      ${this.image ? html`<img slot="media" part="image" src=${this.image} alt="" loading="lazy" />` : nothing}
      ${this.kind ? html`<civitai-badge slot="top-start" size="sm" part="kind">${this.kind}</civitai-badge>` : nothing}
      <div slot="bottom" class="text">
        <span class="name" part="name">${this.name}</span>
        ${this.creator ? html`<span class="creator" part="creator">by ${this.creator}</span>` : nothing}
        ${this.action
          ? html`<button type="button" class="use" part="action" @click=${(event: Event) => {
              event.preventDefault();
              event.stopPropagation();
              this.dispatchEvent(new CustomEvent('model-use', { bubbles: true, composed: true }));
            }}>${this.action}</button>`
          : nothing}
      </div>
    </civitai-media-card>`;
  }
}

export function defineCivitaiChatModelCard(): void {
  defineElement(TAG, CivitaiChatModelCard);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-model-card': CivitaiChatModelCard;
  }
}
