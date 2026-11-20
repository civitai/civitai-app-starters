import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiMediaElement } from './media-base.js';
import { defineElement } from './registry.js';

export type VideoFit = 'cover' | 'contain';

const TAG = 'civitai-video';

export class CivitaiVideo extends CivitaiMediaElement {
  static override styles = [
    CivitaiMediaElement.styles,
    css`
      video {
        display: block;
        width: 100%;
        height: 100%;
        max-height: var(--civitai-media-max-height, none);
        object-fit: cover;
        transition: opacity 200ms ease;
      }
      video[data-fit='contain'] {
        object-fit: contain;
      }
      :host([status='error']) video {
        opacity: 0;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    poster: { reflect: true },
    fit: { reflect: true },
    loop: { type: Boolean, reflect: true },
    preview: { type: Boolean, reflect: true },
    openable: { type: Boolean, reflect: true },
    label: { reflect: true },
  };

  declare poster: string;
  declare fit: VideoFit;
  declare loop: boolean;
  /** Plays muted and looping, without controls, only while hovered or focused: a thumbnail that moves. */
  declare preview: boolean;
  /** A `preview` becomes a button that emits `open`; a full video keeps its controls instead. */
  declare openable: boolean;
  /** Names the open button when it should say more than `alt`. */
  declare label: string;

  constructor() {
    super();
    this.poster = '';
    this.fit = 'cover';
    this.loop = false;
    this.preview = false;
    this.openable = false;
    this.label = '';
  }

  #open(): void {
    this.dispatchEvent(new Event('open', { bubbles: true, composed: true }));
  }

  #play(event: Event): void {
    void (event.currentTarget as HTMLElement).querySelector('video')?.play().catch(() => undefined);
  }

  #pause(event: Event): void {
    (event.currentTarget as HTMLElement).querySelector('video')?.pause();
  }

  protected override renderMedia(): TemplateResult {
    const video = html`<video
      part="video"
      src=${ifDefined(this.src || undefined)}
      poster=${ifDefined(this.poster || undefined)}
      aria-label=${this.alt || nothing}
      data-fit=${this.fit}
      preload="metadata"
      playsinline
      .muted=${this.preview}
      ?controls=${!this.preview}
      ?loop=${this.loop || this.preview}
      @loadedmetadata=${this.settleLoaded}
      @error=${this.settleFailed}
    ></video>`;
    if (!this.preview) return video;
    if (!this.openable) {
      return html`<div @pointerenter=${this.#play} @pointerleave=${this.#pause}>${video}</div>`;
    }
    return html`<button
      class="open"
      part="open"
      type="button"
      aria-label=${this.label || this.alt || 'Open video'}
      @click=${this.#open}
      @pointerenter=${this.#play}
      @pointerleave=${this.#pause}
      @focus=${this.#play}
      @blur=${this.#pause}
    >
      ${video}
    </button>`;
  }
}

export function defineCivitaiVideo(): void {
  defineElement(TAG, CivitaiVideo);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-video': CivitaiVideo;
  }
}
