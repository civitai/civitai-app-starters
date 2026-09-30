import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { until } from 'lit/directives/until.js';

import { SITE_URL } from '../config.js';
import type { GenerationDetails, UsedResource } from '../orchestration/details.js';
import type { ModelDirectory } from '../store/models.js';
import { LightElement } from './light.js';

/** How a result was made: shown beside it in the viewer, the one place settings and models are named. */
export class CivitaiChatGenerationDetails extends LightElement {
  static override properties: PropertyDeclarations = {
    details: { attribute: false },
    models: { attribute: false },
    copied: { state: true },
  };

  declare details: GenerationDetails | null;
  declare models?: ModelDirectory;
  /** The label of the text just copied, for a moment. */
  declare copied: string;

  constructor() {
    super();
    this.details = null;
    this.copied = '';
  }

  async #copy(label: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied = label;
      setTimeout(() => (this.copied = ''), 1500);
    } catch {
      // A sandboxed frame may refuse the clipboard; the prompt stays selectable.
    }
  }

  #resource(resource: UsedResource): TemplateResult {
    const href = `${SITE_URL}/models/${resource.modelId}?modelVersionId=${resource.versionId}`;
    const fallback = resource.kind === 'lora' ? 'A LoRA' : 'A Civitai model';
    const name = this.models
      ? until(
          this.models.get(resource.modelId).then((model) => {
            const version = model.versions?.find((v) => v.id === resource.versionId)?.name;
            return [model.name ?? fallback, version].filter(Boolean).join(' · ');
          }),
          fallback,
        )
      : fallback;
    return html`<li>
      <a href=${href} target="_blank" rel="noopener">${name}</a>
      <span class="cvt-details-kind">${resource.kind === 'lora' ? `LoRA${resource.strength !== undefined ? ` × ${resource.strength}` : ''}` : 'Model'}</span>
    </li>`;
  }

  override render(): TemplateResult | typeof nothing {
    const d = this.details;
    if (!d) return nothing;
    const meta = [d.cost !== undefined ? `${d.cost} Buzz` : '', d.seconds !== undefined ? `${d.seconds} s` : ''].filter(Boolean).join(' · ');
    return html`<section class="cvt-details" aria-label="How this was made">
      ${d.texts.map(
        ({ label, text }) => html`<div class="cvt-details-block cvt-details-text">
          <div class="cvt-details-head">
            <h3>${label}</h3>
            <button type="button" class="cvt-details-copy" @click=${() => void this.#copy(label, text)}>${this.copied === label ? 'Copied' : 'Copy'}</button>
          </div>
          <p class="cvt-details-prompt">${text}</p>
        </div>`,
      )}
      <div class="cvt-details-block">
        <h3>Made with</h3>
        ${d.resources.length ? html`<ul class="cvt-details-resources">${d.resources.map((r) => this.#resource(r))}</ul>` : nothing}
        ${d.service ? html`<p class="cvt-details-service">${d.service}</p>` : nothing}
      </div>
      ${d.settings.length
        ? html`<dl class="cvt-details-settings">
            ${d.settings.map((s) => html`<dt>${s.label}</dt><dd>${s.value}</dd>`)}
          </dl>`
        : nothing}
      ${meta || d.workflowId
        ? html`<p class="cvt-details-meta">
            ${meta}${meta && d.workflowId ? html`<br />` : nothing}${d.workflowId ? html`Reference <code>${d.workflowId}</code>` : nothing}
          </p>`
        : nothing}
    </section>`;
  }
}
