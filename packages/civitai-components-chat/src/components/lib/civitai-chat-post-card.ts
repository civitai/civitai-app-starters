import { CivitaiElement, defineElement, hostBaseline } from '@civitai/components/internals';
import '@civitai/components/civitai-alert/define';
import '@civitai/components/civitai-button/define';
import '@civitai/components/civitai-loader/define';
import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { media, mediaSizes, type MediaKind } from './media.js';

const TAG = 'civitai-chat-post-card';

export type PostCardState = 'ready' | 'posting' | 'posted' | 'failed' | 'dismissed';

/** What the card needs from a post; it re-renders on the post's `change` events. */
export interface CardPost extends EventTarget {
  readonly items: { id: string; kind: MediaKind; url?: string; blocked?: boolean }[];
  readonly title: string;
  readonly state: PostCardState;
  readonly url?: string;
  readonly error?: { message: string; detail?: string };
  submit(): Promise<void>;
  dismiss(): void;
}

/** A suggested post; Civitai's own dialog confirms it, so nothing is posted from here. */
export class CivitaiChatPostCard extends CivitaiElement {
  static override styles = [
    hostBaseline,
    mediaSizes,
    css`
      :host {
        display: block;
        max-width: 640px;
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius, 8px);
        background: var(--civitai-color-surface);
        padding: 12px 14px;
      }
      :host([bare]) {
        border: 0;
        padding: 0;
        background: none;
      }
      h3 {
        margin: 0 0 10px;
        font-size: 14px;
        font-weight: 600;
      }
      :host([bare]) h3 {
        display: none;
      }
      .previews {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 8px;
        margin-bottom: 12px;
      }
      .title {
        font-size: 14px;
        font-weight: 600;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
      }
      .hint {
        margin-top: 8px;
        font-size: 12px;
        color: var(--civitai-color-text-dimmed);
      }
      a {
        color: var(--civitai-color-anchor, var(--civitai-color-primary));
        font-weight: 600;
      }
      summary {
        cursor: pointer;
        margin-top: 8px;
        font-size: 12px;
        color: var(--civitai-color-text-dimmed);
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    post: { attribute: false },
    bare: { type: Boolean, reflect: true },
  };

  declare post?: CardPost;
  /** Drops the frame and heading, for use inside a dialog that has its own. */
  declare bare: boolean;

  #watched?: CardPost;
  #onChange = (): void => this.requestUpdate();

  constructor() {
    super();
    this.bare = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watch(this.post);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#watch(undefined);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('post')) this.#watch(this.post);
  }

  #watch(post: CardPost | undefined): void {
    if (this.#watched === post) return;
    this.#watched?.removeEventListener('change', this.#onChange);
    this.#watched = post;
    post?.addEventListener('change', this.#onChange);
  }

  #offer(post: CardPost): TemplateResult {
    return html`${post.title ? html`<div class="title" part="title">${post.title}</div>` : nothing}
      ${post.error
        ? html`<civitai-alert color="error" part="error" style="margin-top: 12px">
            ${post.error.message}
            ${post.error.detail ? html`<details><summary>Details</summary>${post.error.detail}</details>` : nothing}
          </civitai-alert>`
        : nothing}
      <div class="row">
        <civitai-button part="publish" size="sm" @click=${() => void post.submit()}>Post on Civitai</civitai-button>
        <civitai-button part="dismiss" size="sm" variant="subtle" @click=${() => post.dismiss()}>Not now</civitai-button>
      </div>
      <div class="hint">Civitai shows the post before it goes public on your profile.</div>`;
  }

  #outcome(post: CardPost): TemplateResult {
    switch (post.state) {
      case 'posting':
        return html`<div class="status" role="status"><civitai-loader size="sm"></civitai-loader>Confirm the post on Civitai…</div>`;
      case 'posted':
        return html`<div class="status" role="status">
          Posted on Civitai. ${post.url ? html`<a part="link" href=${post.url} target="_blank" rel="noopener">View post</a>` : nothing}
        </div>`;
      case 'dismissed':
        return html`<div class="status">Not posted.</div>`;
      default:
        return this.#offer(post);
    }
  }

  override render(): TemplateResult {
    const post = this.post;
    if (!post) return html``;
    return html`<h3 part="heading">Post to Civitai</h3>
      <div class="previews" part="previews">
        ${post.items.map(
          (item) => media({ kind: item.kind, mode: 'thumb', src: item.url, pending: !item.url && !item.blocked, blocked: item.blocked === true }),
        )}
      </div>
      ${this.#outcome(post)}`;
  }
}

export function defineCivitaiChatPostCard(): void {
  defineElement(TAG, CivitaiChatPostCard);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-post-card': CivitaiChatPostCard;
  }
}
