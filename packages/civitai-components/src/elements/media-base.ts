import { css, html, nothing, type CSSResultGroup, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { hostBaseline, spinner } from './shared-styles.js';

export type MediaStatus = 'loading' | 'loaded' | 'error' | 'blocked';

const RESETS = ['src', 'pending', 'blocked'];

/**
 * What `<civitai-image>`, `<civitai-video>` and `<civitai-audio>` share: a file
 * that may still be being made (`pending`), may be withheld (`blocked`), and may
 * fail to load (`fallback`), with the outcome reflected as `status`.
 */
export abstract class CivitaiMediaElement extends CivitaiElement {
  static override styles: CSSResultGroup = [
    hostBaseline,
    spinner,
    css`
      :host {
        position: relative;
        display: block;
        overflow: hidden;
        background: var(--civitai-color-media-placeholder, var(--civitai-color-gray-2));
        border-radius: var(--civitai-radius);
      }
      .fallback {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        color: var(--civitai-color-text-dimmed);
        font-size: 13px;
        text-align: center;
      }
      .placeholder {
        display: grid;
        place-items: center;
        min-height: 96px;
        height: 100%;
        padding: 8px;
        color: var(--civitai-color-text-dimmed);
        font-size: 13px;
        text-align: center;
      }
      .open {
        display: block;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        cursor: zoom-in;
      }
      .open:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: -2px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    src: { reflect: true },
    alt: { reflect: true },
    fallback: { reflect: true },
    pending: { type: Boolean, reflect: true },
    blocked: { type: Boolean, reflect: true },
    // Derived, not a default anyone resets to, so reflecting it is what lets
    // `:host([status='error'])` and a consumer's own CSS see the state.
    status: { reflect: true },
  };

  declare src: string;
  declare alt: string;
  /** Text shown when the file fails to load; the `fallback` slot wins over it. */
  declare fallback: string;
  /** Still being made: a loader shows and nothing is requested. */
  declare pending: boolean;
  /** Withheld from this viewer: the `blocked` slot says why, and the file is never requested. */
  declare blocked: boolean;
  declare status: MediaStatus;

  constructor() {
    super();
    this.src = '';
    this.alt = '';
    this.fallback = '';
    this.pending = false;
    this.blocked = false;
    this.status = 'loading';
  }

  /** The `<img>`, `<video>` or `<audio>`, reporting back through `settleLoaded` and `settleFailed`. */
  protected abstract renderMedia(): TemplateResult;

  protected settleLoaded = (): void => this.#settle('loaded');
  protected settleFailed = (): void => this.#settle('error');

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this.blocked) this.status = 'blocked';
    else if (RESETS.some((key) => changed.has(key))) this.status = 'loading';
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    // After the cycle, not inside it: reading readiness needs the rendered
    // element, and settling during `updated` schedules a second update.
    if (RESETS.some((key) => changed.has(key))) void this.updateComplete.then(() => this.#reconcile());
  }

  /**
   * A cached file can be ready before the listeners attach, so neither `load`
   * nor `error` ever fires.
   */
  #reconcile(): void {
    const media = this.renderRoot.querySelector<HTMLImageElement | HTMLMediaElement>('img, video, audio');
    if (!media) return;
    if (media instanceof HTMLImageElement) {
      if (media.complete && media.currentSrc) this.#settle(media.naturalWidth > 0 ? 'loaded' : 'error');
      return;
    }
    if (media.error) this.#settle('error');
    else if (media.readyState >= HTMLMediaElement.HAVE_METADATA) this.#settle('loaded');
  }

  /* Spelled out rather than computed so the manifest can read the names.
     Neither bubbles, matching the media events they stand in for. */
  #settle(next: 'loaded' | 'error'): void {
    if (this.status === next || this.status === 'blocked') return;
    this.status = next;
    if (next === 'error') this.dispatchEvent(new Event('error'));
    else this.dispatchEvent(new Event('load'));
  }

  override render(): TemplateResult {
    if (this.blocked) {
      return html`<div class="placeholder" part="blocked"><slot name="blocked">Hidden</slot></div>`;
    }
    if (this.pending) {
      return html`<div class="placeholder" part="pending" aria-busy="true">
        <span class="spinner" data-size="sm" role="presentation"></span>
      </div>`;
    }
    return html`${this.renderMedia()}
      ${this.status === 'error'
        ? html`<div class="fallback" part="fallback"><slot name="fallback">${this.fallback || nothing}</slot></div>`
        : nothing}`;
  }
}
