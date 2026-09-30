import { CivitaiElement, defineElement, hostBaseline } from '@civitai/components/internals';
import '@civitai/components/civitai-badge/define';
import '@civitai/components/civitai-media-card/define';
import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

const TAG = 'civitai-chat-model-card';

/** A Civitai model as a picture and a name, linking to its page. */
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
    `,
  ];

  static override properties: PropertyDeclarations = {
    name: { reflect: true },
    creator: { reflect: true },
    image: {},
    href: { reflect: true },
    kind: { reflect: true },
  };

  declare name: string;
  declare creator: string;
  declare image: string;
  declare href: string;
  /** A short label such as "LoRA · Illustrious". */
  declare kind: string;

  constructor() {
    super();
    this.name = '';
    this.creator = '';
    this.image = '';
    this.href = '';
    this.kind = '';
  }

  override render(): TemplateResult {
    return html`<civitai-media-card .href=${this.href} .label=${this.name}>
      ${this.image ? html`<img slot="media" part="image" src=${this.image} alt="" loading="lazy" />` : nothing}
      ${this.kind ? html`<civitai-badge slot="top-start" size="sm" part="kind">${this.kind}</civitai-badge>` : nothing}
      <div slot="bottom" class="text">
        <span class="name" part="name">${this.name}</span>
        ${this.creator ? html`<span class="creator" part="creator">by ${this.creator}</span>` : nothing}
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
