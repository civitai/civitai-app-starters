import { CivitaiElement, defineElement, hostBaseline } from '@civitai/components/internals';
import '@civitai/components/civitai-alert/define';
import '@civitai/components/civitai-badge/define';
import '@civitai/components/civitai-button/define';
import type { CivitaiConfirmDialog } from '@civitai/components/civitai-confirm-dialog';
import '@civitai/components/civitai-confirm-dialog/define';
import '@civitai/components/civitai-loader/define';
import '@civitai/components/civitai-progress/define';
import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { media, mediaSizes, type MediaKind } from './media.js';

const TAG = 'civitai-chat-generation-card';

export type CardState =
  | 'pricing'
  | 'awaiting_confirmation'
  | 'submitting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'rejected'
  | 'declined';

export interface CardResult {
  id: string;
  kind: MediaKind;
  url?: string;
  blocked?: boolean;
}

/** What the card needs from a generation; it re-renders on the job's `change` events. */
export interface CardJob extends EventTarget {
  readonly label: string;
  /** What it makes, named before it starts (e.g. "Your picture"); `label` says what it is doing once it runs. */
  readonly subject?: string;
  readonly state: CardState;
  readonly price: { total: number; variable: boolean } | null;
  readonly progress: number | null;
  readonly queued: number | null;
  readonly error?: { message: string; detail?: string };
  readonly results: CardResult[];
  readonly cancelable: boolean;
  readonly workflowId?: string;
  confirm(): Promise<void>;
  decline(): void;
  cancel(): Promise<void>;
  retry(): Promise<void>;
}

export interface CardAction {
  id: string;
  label: string;
}

const NOT_STARTED = new Set<CardState>(['pricing', 'awaiting_confirmation', 'declined', 'rejected']);

export const DEFAULT_ACTIONS: Record<MediaKind, CardAction[]> = {
  image: [
    { id: 'reference', label: 'Use in chat' },
    { id: 'animate', label: 'Animate' },
    { id: 'upscale', label: 'Sharpen' },
    { id: 'info', label: 'Info' },
    { id: 'download', label: 'Download' },
  ],
  video: [
    { id: 'reference', label: 'Use in chat' },
    { id: 'upscale', label: 'Sharpen' },
    { id: 'info', label: 'Info' },
    { id: 'download', label: 'Download' },
  ],
  audio: [
    { id: 'info', label: 'Info' },
    { id: 'download', label: 'Download' },
  ],
};

/** One generation in plain words: its price, the wait, the result, and what can be done next. */
export class CivitaiChatGenerationCard extends CivitaiElement {
  static override styles = [
    hostBaseline,
    mediaSizes,
    css`
      :host {
        position: relative;
        display: block;
        max-width: 640px;
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius, 8px);
        background: var(--civitai-color-surface);
        padding: 12px 14px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
      }
      h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        font-size: 14px;
        color: var(--civitai-color-text-dimmed);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
      }
      civitai-progress {
        margin-top: 10px;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
        gap: 10px;
        margin-top: 10px;
      }
      :host([single]) .gallery {
        grid-template-columns: 1fr;
      }
      figure {
        margin: 0;
        display: grid;
        gap: 6px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      civitai-alert {
        margin-top: 10px;
      }
      .buy {
        display: inline-block;
        padding: 6px 14px;
        border-radius: var(--civitai-radius, 8px);
        background: var(--civitai-color-primary);
        color: var(--civitai-color-primary-fg, #fff);
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
      }
      .buy:hover {
        background: var(--civitai-color-primary-hover, var(--civitai-color-primary));
      }
      details {
        margin-top: 10px;
        font-size: 12px;
        color: var(--civitai-color-text-dimmed);
      }
      summary {
        cursor: pointer;
      }
      code {
        font-family: var(--civitai-font-mono, ui-monospace, monospace);
        overflow-wrap: anywhere;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    job: { attribute: false },
    buyBuzzUrl: { attribute: 'buy-buzz-url' },
    actions: { attribute: false },
    single: { type: Boolean, reflect: true },
  };

  declare job?: CardJob;
  declare buyBuzzUrl: string;
  /** Which actions each result offers; each emits `media-action` with its id. */
  declare actions: Record<MediaKind, CardAction[]>;
  declare single: boolean;

  #watched?: CardJob;
  #retried = new Set<string>();
  #onChange = (): void => this.requestUpdate();

  constructor() {
    super();
    this.buyBuzzUrl = 'https://civitai.com/purchase/buzz';
    this.actions = DEFAULT_ACTIONS;
    this.single = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#watch(undefined);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watch(this.job);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('job')) this.#watch(this.job);
    this.single = (this.job?.results.length ?? 0) <= 1;
  }

  #watch(job: CardJob | undefined): void {
    if (this.#watched === job) return;
    this.#watched?.removeEventListener('change', this.#onChange);
    this.#watched = job;
    job?.addEventListener('change', this.#onChange);
  }

  // Signed URLs expire; the owner gets one chance per result to hand over a fresh one.
  #retry(id: string): void {
    if (this.#retried.has(id)) return;
    this.#retried.add(id);
    this.#emit('media-retry', { id });
  }

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }

  async #cancel(): Promise<void> {
    const dialog = this.renderRoot.querySelector<CivitaiConfirmDialog>('civitai-confirm-dialog');
    if (dialog && !(await dialog.ask())) return;
    await this.job?.cancel();
  }

  #price(): TemplateResult | typeof nothing {
    const price = this.job?.price;
    if (!price || price.total === 0) return nothing;
    return html`<civitai-badge part="price" size="sm" variant="light">${price.variable ? 'up to ' : ''}${price.total} Buzz</civitai-badge>`;
  }

  #body(job: CardJob): TemplateResult {
    switch (job.state) {
      case 'pricing':
        return html`<div class="status" role="status"><civitai-loader size="sm"></civitai-loader>Checking the price…</div>`;
      case 'awaiting_confirmation':
        return html`<div class="status" role="status">
            <span>${job.price ? html`Costs about <strong>${job.price.total} Buzz</strong>. Make it?` : 'Make it?'}</span>
          </div>
          <div class="row">
            <civitai-button part="confirm" size="sm" @click=${() => void job.confirm()}>Go ahead</civitai-button>
            <civitai-button part="decline" size="sm" variant="subtle" @click=${() => job.decline()}>Not now</civitai-button>
            ${this.#info()}
          </div>`;
      case 'submitting':
        return html`<div class="status" role="status"><civitai-loader size="sm"></civitai-loader>Starting…</div>`;
      case 'running':
        return this.#running(job);
      case 'succeeded':
        return this.#gallery(job);
      case 'rejected':
        return html`<civitai-alert color="warning" part="error">
          You don't have enough Buzz for this${job.price ? html` (about ${job.price.total})` : nothing}.
          <div class="row"><a class="buy" part="buy" href=${this.buyBuzzUrl} target="_blank" rel="noopener">Get Buzz</a></div>
        </civitai-alert>`;
      case 'declined':
        return html`<div class="status">Not started.</div>
          <div class="row"><civitai-button size="sm" variant="light" @click=${() => void job.confirm()}>Run it</civitai-button></div>`;
      case 'canceled':
        return html`<div class="status">Stopped. Only work already done is billed.</div>`;
      case 'failed':
      case 'expired':
        return html`<civitai-alert color="error" part="error">
          ${job.state === 'expired' ? 'This one did not finish.' : (job.error?.message ?? 'Something went wrong.')}
          <div class="row"><civitai-button size="sm" variant="light" @click=${() => void job.retry()}>Try again</civitai-button></div>
        </civitai-alert>`;
    }
  }

  /** Asks the page to show what this job is making, before there is anything to open. */
  #info(): TemplateResult {
    return html`<civitai-button part="info" size="sm" variant="subtle" @click=${() => this.#emit('job-info', {})}>Info</civitai-button>`;
  }

  #running(job: CardJob): TemplateResult {
    const text =
      job.queued !== null && job.queued > 0
        ? `Waiting in line… ${job.queued} ahead`
        : job.queued === 0
          ? 'Waiting in line… next up'
          : job.progress !== null
            ? `${job.label}… ${Math.round(job.progress * 100)}%`
            : `${job.label}…`;
    return html`<civitai-progress
        part="progress"
        size="sm"
        .label=${text}
        ?indeterminate=${job.progress === null}
        .value=${Math.round((job.progress ?? 0) * 100)}
      ></civitai-progress>
      <div class="visually-hidden" role="status">${text}</div>
      <div class="row">
        ${this.#info()}
        ${job.cancelable
          ? html`<civitai-button part="cancel" size="sm" variant="subtle" @click=${() => void this.#cancel()}>Stop</civitai-button>`
          : nothing}
      </div>`;
  }

  #gallery(job: CardJob): TemplateResult {
    if (job.results.length === 0) return html`<div class="status">Finished, but nothing came back.</div>`;
    return html`<div class="gallery" part="gallery">
      ${job.results.map(
        (result) => html`<figure>
          ${media({
            kind: result.kind,
            mode: 'inline',
            src: result.url,
            pending: !result.url && !result.blocked,
            blocked: result.blocked === true,
            onOpen: () => this.#emit('open', { id: result.id }),
            onError: () => this.#retry(result.id),
          })}
          ${result.url
            ? html`<div class="actions" part="actions">
                ${(this.actions[result.kind] ?? []).map(
                  (action) => html`<civitai-button size="sm" variant="subtle" @click=${() => this.#emit('media-action', { id: result.id, action: action.id })}
                    >${action.label}</civitai-button
                  >`,
                )}
              </div>`
            : nothing}
        </figure>`,
      )}
    </div>`;
  }

  override render(): TemplateResult {
    const job = this.job;
    if (!job) return html``;
    return html`<header>
        <h3 part="label">${NOT_STARTED.has(job.state) ? (job.subject ?? job.label) : job.label}</h3>
        ${this.#price()}
      </header>
      ${this.#body(job)}
      ${job.workflowId || job.error?.detail
        ? html`<details part="details">
            <summary>Details</summary>
            ${job.workflowId ? html`<div>Reference: <code>${job.workflowId}</code></div>` : nothing}
            ${job.error?.detail ? html`<div>Service said: ${job.error.detail}</div>` : nothing}
          </details>`
        : nothing}
      <civitai-confirm-dialog
        heading="Stop this?"
        message="Work already done may still be billed."
        confirm-label="Stop it"
        cancel-label="Keep going"
        destructive
      ></civitai-confirm-dialog>`;
  }
}

export function defineCivitaiChatGenerationCard(): void {
  defineElement(TAG, CivitaiChatGenerationCard);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-generation-card': CivitaiChatGenerationCard;
  }
}
