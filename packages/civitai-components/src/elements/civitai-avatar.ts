import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { styleMap } from 'lit/directives/style-map.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const TAG = 'civitai-avatar';

/** First and last initial — "Jane Q Doe" reads as "JD", "Vladaa" as "V". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const head = [...words[0]!][0] ?? '';
  const tail = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return (head + tail).toUpperCase();
}

export class CivitaiAvatar extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: inline-block;
        --size: 40px;
      }
      :host([size='sm']) {
        --size: 26px;
      }
      :host([size='lg']) {
        --size: 56px;
      }
      :host([size='xl']) {
        --size: 84px;
      }
      .frame {
        display: block;
        border-radius: 50%;
        padding: 0;
      }
      :host([frame]) .frame {
        padding: 2px;
      }
      .inner {
        display: grid;
        place-items: center;
        width: var(--size);
        height: var(--size);
        overflow: hidden;
        border-radius: 50%;
        background: var(--civitai-color-media-placeholder);
        color: var(--civitai-color-text-dimmed);
        font-size: calc(var(--size) * 0.4);
        font-weight: 600;
        line-height: 1;
        user-select: none;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    src: { reflect: true },
    name: { reflect: true },
    size: { reflect: true },
    frame: { reflect: true },
    broken: { state: true },
  };

  declare src: string;
  /** Names the person, and supplies both the alt text and the initials. */
  declare name: string;
  declare size: AvatarSize;
  /** Any CSS background — a cosmetic ring reduces to exactly this much. */
  declare frame: string;
  declare broken: boolean;

  constructor() {
    super();
    this.src = '';
    this.name = '';
    this.size = 'md';
    this.frame = '';
    this.broken = false;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('src')) this.broken = false;
  }

  override render(): TemplateResult {
    const initials = initialsOf(this.name);
    const showImage = this.src !== '' && !this.broken;
    return html`<span
      class="frame"
      part="frame"
      style=${styleMap({ background: this.frame || undefined })}
    >
      <span class="inner" part="inner">
        ${showImage
          ? html`<img
              part="image"
              src=${this.src}
              alt=${this.name}
              @error=${() => {
                this.broken = true;
              }}
            />`
          : nothing}
        ${showImage
          ? nothing
          : html`<span part="initials" role="img" aria-label=${ifDefined(this.name || undefined)}
              >${initials}</span
            >`}
      </span>
    </span>`;
  }
}

export function defineCivitaiAvatar(): void {
  defineElement(TAG, CivitaiAvatar);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-avatar': CivitaiAvatar;
  }
}
