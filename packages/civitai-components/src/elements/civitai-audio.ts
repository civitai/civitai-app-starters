import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiMediaElement } from './media-base.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-audio';

export class CivitaiAudio extends CivitaiMediaElement {
  static override styles = [
    CivitaiMediaElement.styles,
    css`
      :host {
        background: none;
      }
      audio {
        display: block;
        width: 100%;
      }
      :host([status='error']) audio {
        opacity: 0;
      }
      .placeholder {
        min-height: 54px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    loop: { type: Boolean, reflect: true },
  };

  declare loop: boolean;

  constructor() {
    super();
    this.loop = false;
  }

  protected override renderMedia(): TemplateResult {
    return html`<audio
      part="audio"
      src=${ifDefined(this.src || undefined)}
      aria-label=${this.alt || nothing}
      controls
      preload="metadata"
      ?loop=${this.loop}
      @loadedmetadata=${this.settleLoaded}
      @error=${this.settleFailed}
    ></audio>`;
  }
}

export function defineCivitaiAudio(): void {
  defineElement(TAG, CivitaiAudio);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-audio': CivitaiAudio;
  }
}
