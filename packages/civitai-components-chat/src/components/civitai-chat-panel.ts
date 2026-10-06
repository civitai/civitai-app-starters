import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import type { Panel } from '../panels/panel.js';
import type { Attachment } from '../types.js';
import type { CardAction } from './lib/civitai-chat-generation-card.js';
import { DEFAULT_ACTIONS } from './lib/civitai-chat-generation-card.js';
import type { MediaKind } from './lib/media.js';
import { LightElement } from './light.js';
import { ShareState } from './share-button.js';
import { ThumbLoads, panelFields, panelHint, reuseButton, runButton, runStrip, selectedRun } from './panel-fields.js';

/** A panel the assistant built: its controls, a Run button with the price, and what each run made. */
export class CivitaiChatPanel extends LightElement {
  static override properties: PropertyDeclarations = {
    panel: { attribute: false },
    files: { attribute: false },
    actions: { attribute: false },
    canShare: { type: Boolean, attribute: 'can-share' },
  };

  declare panel?: Panel;
  /** The conversation's files, for image inputs. */
  declare files: () => Attachment[];
  declare actions: Record<MediaKind, CardAction[]>;
  /** Shows Share, which emits `panel-share` with the panel; the chat turns it into a link. */
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

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#watch(undefined);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watch(this.panel);
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

  #runs(panel: Panel): TemplateResult | typeof nothing {
    const selected = selectedRun(panel);
    if (!selected) return nothing;
    return html`<div class="cvt-panel-runs">
      ${panel.jobs.length > 1 ? runStrip(panel, selected, this.#thumbs) : nothing}
      <civitai-chat-generation-card single .job=${selected} .actions=${this.actions}></civitai-chat-generation-card>
      ${reuseButton(panel, selected)}
    </div>`;
  }

  override render(): TemplateResult | typeof nothing {
    const panel = this.panel;
    if (!panel) return nothing;
    const { spec } = panel;
    return html`<section class="cvt-panel" aria-label=${spec.title}>
      <header class="cvt-panel-head">
        <h3>${spec.title}</h3>
        ${panel.version > 1 ? html`<civitai-badge size="sm" variant="light">v${panel.version}</civitai-badge>` : nothing}
        ${this.canShare ? this.#share.button(this, panel, 'cvt-panel-share') : nothing}
        ${spec.description ? html`<p>${spec.description}</p>` : nothing}
      </header>
      ${panelFields(panel, this.files)}
      <div class="cvt-panel-foot">${runButton(panel)} ${panelHint(panel)}</div>
      ${this.#runs(panel)}
    </section>`;
  }
}
