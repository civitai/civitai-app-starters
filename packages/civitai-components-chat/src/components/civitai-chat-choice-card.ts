import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import type { Attachment, ChoiceOption } from '../types.js';
import { LightElement, emit } from './light.js';

export class CivitaiChatChoiceCard extends LightElement {
  static override properties: PropertyDeclarations = {
    question: {},
    options: { attribute: false },
    disabled: { type: Boolean, reflect: true },
    resolve: { attribute: false },
  };

  declare question: string;
  declare options: ChoiceOption[];
  declare disabled: boolean;
  declare resolve: (id: string) => Attachment | undefined;

  constructor() {
    super();
    this.question = '';
    this.options = [];
    this.disabled = false;
    this.resolve = () => undefined;
  }

  override render(): TemplateResult {
    return html`<fieldset class="cvt-choice" ?disabled=${this.disabled}>
      <legend>${this.question}</legend>
      <div class="cvt-choice-options">
        ${this.options.map((option) => {
          const image = option.image ? this.resolve(option.image) : undefined;
          return html`<button class="cvt-choice-option" type="button" @click=${() => emit(this, 'cvt-choice', { label: option.label })}>
            ${image?.url ? html`<img src=${image.url} alt="" loading="lazy" />` : nothing}
            <span class="cvt-choice-label">${option.label}</span>
            ${option.description ? html`<span class="cvt-choice-description">${option.description}</span>` : nothing}
          </button>`;
        })}
      </div>
    </fieldset>`;
  }
}
