import '@civitai/components/civitai-alert/define';
import '@civitai/components/civitai-badge/define';
import '@civitai/components/civitai-button/define';
import '@civitai/components/civitai-loader/define';
import '@civitai/components/civitai-menu/define';
import '@civitai/components/civitai-menu-item/define';
import '@civitai/components/civitai-number-input/define';
import '@civitai/components/civitai-segmented-control/define';
import '@civitai/components/civitai-select/define';
import '@civitai/components/civitai-slider/define';
import '@civitai/components/civitai-switch/define';
import '@civitai/components/civitai-text-input/define';
import '@civitai/components/civitai-textarea/define';
import { LitElement, css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import type { GenerationJob } from '../orchestration/job.js';
import type { Panel } from '../panels/panel.js';
import type { Attachment } from '../types.js';
import { DEFAULT_ACTIONS, type CardAction } from './lib/civitai-chat-generation-card.js';
import { media, mediaSizes, type MediaKind } from './lib/media.js';
import { emit } from './light.js';
import { ShareState } from './share-button.js';
import { ThumbLoads, panelFields, panelHint, reuseButton, runButton, runStrip, selectedRun } from './panel-fields.js';
import { panelStyles } from './panel.styles.js';

// Button labels that fit the 248px inside the controls column; longer sets become a dropdown.
const STUDIO_SEGMENT_CHARS = 22;

/**
 * A panel as a page of its own, laid out like a studio: controls and Run on the left, the run on
 * show in the middle, every run in a tray below it. Pair it with `<civitai-chat dock-panels>` and
 * set `panel` from its `active-panel-change`. Slot `empty` shows while there is no panel.
 */
export class CivitaiChatStudio extends LitElement {
  static override styles = [
    mediaSizes,
    panelStyles,
    css`
      :host {
        display: block;
        min-height: 0;
        color: var(--civitai-color-text);
        font-family: var(--civitai-font-family, system-ui, sans-serif);
        --cvt-media-max-height: calc(100dvh - 240px);
      }
      .studio {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        height: 100%;
        min-height: 0;
      }
      .controls {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        min-height: 0;
        border-right: 1px solid var(--civitai-color-border);
      }
      .controls-scroll {
        overflow-x: hidden;
        overflow-y: auto;
        padding: 16px;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-content: start;
        gap: 16px;
      }
      .controls header h2 {
        display: inline;
        margin: 0 8px 0 0;
        font-size: 16px;
      }
      .controls header p {
        margin: 6px 0 0;
        font-size: 13px;
        color: var(--civitai-color-text-dimmed);
      }
      .controls footer {
        display: grid;
        gap: 6px;
        padding: 12px 16px 16px;
        border-top: 1px solid var(--civitai-color-border);
      }
      .controls footer civitai-button {
        width: 100%;
      }
      .controls footer civitai-button::part(button) {
        width: 100%;
      }
      .cvt-panel-row > * {
        flex-basis: 100%;
      }
      .stage {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 12px;
        min-height: 0;
        padding: 16px;
      }
      .canvas {
        display: grid;
        place-items: center;
        min-height: 0;
        overflow: auto;
        padding: 16px;
        border-radius: calc(var(--civitai-radius, 8px) * 2);
        background: var(--civitai-color-surface);
      }
      .results {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
        gap: 16px;
        width: 100%;
        align-items: center;
      }
      .results[data-count='1'] {
        grid-template-columns: minmax(0, 1fr);
        justify-items: center;
      }
      .results[data-count='1'] figure {
        width: min(100%, 720px);
      }
      figure {
        position: relative;
        margin: 0;
      }
      .actions {
        position: absolute;
        top: 8px;
        right: 8px;
        opacity: 0;
        transition: opacity 0.15s;
      }
      figure:hover .actions,
      .actions:focus-within,
      .actions:has(civitai-menu[open]) {
        opacity: 1;
      }
      @media (hover: none) {
        .actions {
          opacity: 1;
        }
      }
      figure[data-kind='audio'] {
        width: min(100%, 420px);
      }
      figure[data-kind='audio'] .actions {
        position: static;
        display: flex;
        justify-content: flex-end;
        opacity: 1;
      }
      .more {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: rgb(0 0 0 / 0.55);
        color: #fff;
        font-size: 18px;
        cursor: pointer;
      }
      .more:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 2px;
      }
      .status {
        display: grid;
        justify-items: center;
        gap: 10px;
        color: var(--civitai-color-text-dimmed);
        font-size: 14px;
        text-align: center;
      }
      .tray {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 12px;
      }
      .tray-label {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--civitai-color-text-dimmed);
      }
      .empty {
        display: grid;
        place-items: center;
        height: 100%;
        padding: 24px;
        text-align: center;
        color: var(--civitai-color-text-dimmed);
      }
      @media (max-width: 720px) {
        .studio {
          grid-template-columns: 1fr;
          grid-template-rows: auto auto;
          height: auto;
        }
        .controls {
          border-right: none;
          border-bottom: 1px solid var(--civitai-color-border);
        }
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    panel: { attribute: false },
    files: { attribute: false },
    actions: { attribute: false },
    canShare: { type: Boolean, attribute: 'can-share' },
  };

  declare panel?: Panel;
  /** The conversation's files, for image inputs: pass the chat's `files`. */
  declare files: () => Attachment[];
  /** Each result's menu; a pick emits `media-action` with its id, for the chat's `mediaAction`. */
  declare actions: Record<MediaKind, CardAction[]>;
  /** Shows Share, which emits `panel-share` with the panel; answer it with the chat's `sharePanel` (see `ShareState`). */
  declare canShare: boolean;

  #watched?: Panel;
  #rerender = (): void => this.requestUpdate();
  #thumbs = new ThumbLoads(this.#rerender);
  #share = new ShareState(this.#rerender);

  constructor() {
    super();
    this.files = () => [];
    this.actions = DEFAULT_ACTIONS;
    this.canShare = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watch(this.panel);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#watch(undefined);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('panel')) this.#watch(this.panel);
  }

  #watch(panel: Panel | undefined): void {
    if (panel === this.#watched) return;
    this.#watched?.removeEventListener('change', this.#rerender);
    this.#watched = panel;
    panel?.addEventListener('change', this.#rerender);
    if (panel && panel.price === null && !panel.quoting) panel.requestQuote();
  }

  #canvas(job: GenerationJob | undefined): TemplateResult {
    if (!job) {
      return html`<div class="status">${this.panel?.asks ? `Press ${this.panel.spec.button ?? 'Run'} to ask the assistant; its answer appears in the chat.` : 'Press Run to make the first one.'}</div>`;
    }
    switch (job.state) {
      case 'pricing':
      case 'submitting':
      case 'running': {
        const progress = job.progress !== null ? ` ${Math.round(job.progress * 100)}%` : '';
        const queued = job.queued ? ` · ${job.queued} ahead` : '';
        return html`<div class="status" role="status"><civitai-loader></civitai-loader>${job.label}…${progress}${queued}</div>`;
      }
      case 'failed':
      case 'expired':
        return html`<civitai-alert color="error">${job.error?.message ?? 'That run did not work.'}</civitai-alert>`;
      case 'rejected':
        return html`<div class="status">You don't have enough Buzz for this.</div>`;
      case 'awaiting_confirmation':
      case 'canceled':
      case 'declined':
        return html`<div class="status">This run was stopped.</div>`;
      case 'succeeded':
        if (job.results.length === 0) return html`<div class="status">Finished, but nothing came back.</div>`;
        return html`<div class="results" data-count=${job.results.length}>
          ${job.results.map((result, index) => this.#result(result, index, job.results.length))}
        </div>`;
    }
  }

  #result(result: GenerationJob['results'][number], index: number, count: number): TemplateResult {
    const name = count > 1 ? `result ${index + 1}` : 'this result';
    const actions = this.actions[result.kind] ?? [];
    return html`<figure data-kind=${result.kind}>
      ${media({
        kind: result.kind,
        mode: 'inline',
        src: result.url,
        pending: !result.url && !result.blocked,
        blocked: result.blocked === true,
        width: result.width,
        height: result.height,
        onOpen: () => emit(this, 'media-action', { id: result.id, action: 'info' }),
      })}
      ${result.url && actions.length
        ? html`<div class="actions">
            <civitai-menu placement="bottom-end" label=${`Actions for ${name}`} @select=${(e: CustomEvent<{ value: string }>) => emit(this, 'media-action', { id: result.id, action: e.detail.value })}>
              <button slot="trigger" type="button" class="more" aria-label=${`More for ${name}`}>⋯</button>
              ${actions.map((action) => html`<civitai-menu-item value=${action.id}>${action.label}</civitai-menu-item>`)}
            </civitai-menu>
          </div>`
        : nothing}
    </figure>`;
  }

  override render(): TemplateResult {
    const panel = this.panel;
    if (!panel) return html`<div class="empty"><slot name="empty">Ask the assistant for something to make; its controls show up here.</slot></div>`;
    const { spec } = panel;
    const selected = selectedRun(panel);
    return html`<div class="studio">
      <aside class="controls" aria-label=${`${spec.title} settings`}>
        <div class="controls-scroll">
          <header>
            <h2>${spec.title}</h2>
            ${panel.version > 1 ? html`<civitai-badge size="sm" variant="light">v${panel.version}</civitai-badge>` : nothing}
            ${spec.description ? html`<p>${spec.description}</p>` : nothing}
          </header>
          ${panelFields(panel, this.files, { segmentChars: STUDIO_SEGMENT_CHARS })}
        </div>
        <footer>
          ${runButton(panel)} ${panelHint(panel)}
          ${this.canShare ? this.#share.button(this, panel) : nothing}
        </footer>
      </aside>
      <section class="stage">
        <div class="canvas">${this.#canvas(selected)}</div>
        ${selected
          ? html`<div class="tray">
              <span class="tray-label">Runs · ${panel.jobs.length}</span>
              ${runStrip(panel, selected, this.#thumbs)} ${reuseButton(panel, selected)}
            </div>`
          : nothing}
      </section>
    </div>`;
  }
}

export function defineCivitaiChatStudio(): void {
  if (!customElements.get('civitai-chat-studio')) customElements.define('civitai-chat-studio', CivitaiChatStudio);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-studio': CivitaiChatStudio;
  }
}
