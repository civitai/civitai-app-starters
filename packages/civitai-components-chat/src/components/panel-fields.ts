import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import type { GenerationJob, JobState } from '../orchestration/job.js';
import type { Panel } from '../panels/panel.js';
import { layoutRows, type PanelInput } from '../panels/spec.js';
import type { Attachment } from '../types.js';

const PICKER_IMAGES = 12;
// Wider sets scroll sideways in a segmented control; a select shows them all.
const SEGMENTS_MAX = 4;
const SEGMENTS_CHARS = 32;

export interface FieldOptions {
  /** Most characters of option labels shown as buttons; past that a choice is a dropdown. */
  segmentChars?: number;
}

const RUN_STATE: Record<JobState, string> = {
  pricing: 'starting',
  awaiting_confirmation: 'waiting for you',
  submitting: 'starting',
  running: 'in progress',
  succeeded: 'done',
  failed: 'failed',
  expired: 'failed',
  rejected: 'not enough Buzz',
  canceled: 'stopped',
  declined: 'not run',
};

/** A panel's controls, Run button and runs strip, shared by the card in the thread and the studio view. */
export function panelFields(panel: Panel, files: () => Attachment[], options: FieldOptions = {}): TemplateResult {
  return html`<div class="cvt-panel-fields">
    ${layoutRows(panel.spec).map((row) => html`<div class="cvt-panel-row">${row.map((key) => field(key, panel.spec.inputs[key]!, panel, files, options))}</div>`)}
  </div>`;
}

export function runButton(panel: Panel): TemplateResult {
  const label = panel.spec.button ?? 'Run';
  const price = panel.asks ? '' : panel.quoting ? ' · checking price…' : panel.price ? ` · ≈ ${panel.price.variable ? 'from ' : ''}${panel.price.total.toLocaleString()} Buzz` : '';
  return html`<civitai-button ?disabled=${!panel.canRun || panel.insufficientBuzz} @click=${() => void panel.run()}>${label}${price}</civitai-button>`;
}

export function panelHint(panel: Panel): TemplateResult | typeof nothing {
  const missing = panel.missing;
  if (missing.length) return html`<span class="cvt-panel-hint">Fill in ${missing.join(' and ')} to run.</span>`;
  if (panel.insufficientBuzz) return html`<span class="cvt-panel-hint cvt-panel-hint-error">You don't have enough Buzz for this.</span>`;
  if (panel.quoteError) return html`<span class="cvt-panel-hint cvt-panel-hint-error">${panel.quoteError.message}</span>`;
  if (panel.asks) return html`<span class="cvt-panel-hint">${panel.forkedFrom ? 'Puts the request in your message box to check and send.' : 'Asks the assistant; its answer appears in the chat.'}</span>`;
  return nothing;
}

/** Remembers which thumbnails have loaded, so each keeps its spinner until then. */
export class ThumbLoads {
  #loaded = new Set<string>();
  constructor(private readonly changed: () => void) {}
  has(url: string): boolean {
    return this.#loaded.has(url);
  }
  done = (url: string): void => {
    this.#loaded.add(url);
    this.changed();
  };
}

export function runStrip(panel: Panel, selected: GenerationJob, thumbs: ThumbLoads): TemplateResult {
  const jobs = panel.jobs;
  return html`<div class="cvt-panel-run-list" role="group" aria-label="Runs">
    ${[...jobs].reverse().map((job, index) => {
      const label = `Run ${jobs.length - index}, ${RUN_STATE[job.state]}`;
      return html`<button type="button" class="cvt-panel-run" data-state=${job.state} aria-pressed=${String(job === selected)} aria-label=${label} title=${label} @click=${() => panel.select(job.id)}>
        ${runThumb(job, thumbs)}
      </button>`;
    })}
  </div>`;
}

/** The run on show: the one the user picked, else the newest. */
export function selectedRun(panel: Panel): GenerationJob | undefined {
  const jobs = panel.jobs;
  return jobs.find((job) => job.id === panel.selected) ?? jobs.at(-1);
}

/** Offered when the controls no longer match the run on show. */
export function reuseButton(panel: Panel, job: GenerationJob): TemplateResult | typeof nothing {
  const run = panel.runs.find((r) => r.job === job.id);
  if (!run || JSON.stringify(run.values) === JSON.stringify(panel.values)) return nothing;
  return html`<civitai-button size="sm" variant="subtle" @click=${() => panel.reuse(job.id)}>Use this run's settings</civitai-button>`;
}

function runThumb(job: GenerationJob, thumbs: ThumbLoads): TemplateResult {
  const first = job.results[0];
  if (first?.url && first.kind === 'image' && !first.blocked) {
    const { url } = first;
    // The URL comes well before the file; the spinner stays until the picture has actually loaded.
    return html`${thumbs.has(url) ? nothing : html`<civitai-loader size="sm"></civitai-loader>`}<img src=${url} alt="" ?hidden=${!thumbs.has(url)} @load=${() => thumbs.done(url)} />`;
  }
  switch (job.state) {
    case 'pricing':
    case 'submitting':
    case 'running':
      return html`<civitai-loader size="sm"></civitai-loader>`;
    case 'failed':
    case 'expired':
    case 'rejected':
      return html`<span class="cvt-panel-run-mark" aria-hidden="true">!</span>`;
    case 'succeeded':
      return html`<span class="cvt-panel-run-mark" aria-hidden="true">${first?.kind === 'audio' ? '♪' : first?.kind === 'video' ? '▶' : '✓'}</span>`;
    default:
      return html`<span class="cvt-panel-run-mark" aria-hidden="true">–</span>`;
  }
}

function field(key: string, input: PanelInput, panel: Panel, files: () => Attachment[], options: FieldOptions): TemplateResult {
  const label = input.label ?? key;
  const value = panel.values[key];
  const set = (next: string | number | boolean) => panel.setValue(key, next);
  switch (input.kind) {
    case 'text':
      return input.multiline
        ? html`<civitai-textarea label=${label} rows="2" placeholder=${input.placeholder ?? ''} maxlength=${input.maxLen ?? 500} ?required=${input.required === true} .value=${live(String(value))} @input=${(e: Event) => set((e.currentTarget as HTMLTextAreaElement).value)}></civitai-textarea>`
        : html`<civitai-text-input label=${label} placeholder=${input.placeholder ?? ''} maxlength=${input.maxLen ?? 500} ?required=${input.required === true} .value=${live(String(value))} @input=${(e: Event) => set((e.currentTarget as HTMLInputElement).value)}></civitai-text-input>`;
    case 'choice':
    case 'aspect': {
      const data = input.options.map((option) => ({ value: option, label: option }));
      const segmented = input.options.length <= SEGMENTS_MAX && input.options.join('').length <= (options.segmentChars ?? SEGMENTS_CHARS);
      return segmented
        ? html`<civitai-segmented-control size="sm" label=${label} .data=${data} .value=${live(String(value))} @change=${(e: Event) => set((e.target as HTMLInputElement).value)}></civitai-segmented-control>`
        : html`<civitai-select label=${label} .data=${data} .value=${live(String(value))} @change=${(e: Event) => set((e.target as HTMLInputElement).value)}></civitai-select>`;
    }
    case 'slider':
      return html`<civitai-slider label=${label} show-value min=${input.min} max=${input.max} step=${input.step ?? 'any'} .value=${live(String(value))} @change=${(e: Event) => set(Number((e.target as HTMLInputElement).value))}></civitai-slider>`;
    case 'count':
      return html`<civitai-number-input label=${label} description=${`${input.min ?? 1} to ${input.max}`} min=${input.min ?? 1} max=${input.max} step="1" .value=${live(String(value))} @change=${(e: Event) => set(Math.round(Number((e.target as HTMLInputElement).value)))}></civitai-number-input>`;
    case 'seed':
      return html`<civitai-number-input
        label=${label}
        description="Leave empty for a new one each run"
        placeholder="New each run"
        min="0"
        step="1"
        .value=${live(value === -1 ? '' : String(value))}
        @change=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          set(raw === '' ? -1 : Math.round(Number(raw)));
        }}
      ></civitai-number-input>`;
    case 'toggle':
      return html`<civitai-switch label=${label} .checked=${live(value === true)} @change=${(e: Event) => set((e.target as HTMLInputElement).checked)}></civitai-switch>`;
    case 'image':
      return imagePicker(key, label, String(value), input.required === true, set, files);
  }
}

function imagePicker(key: string, label: string, value: string, required: boolean, set: (id: string) => void, files: () => Attachment[]): TemplateResult {
  const images = files()
    .filter((file) => file.kind === 'image' && file.url && !file.blocked)
    .slice(-PICKER_IMAGES)
    .reverse();
  return html`<fieldset class="cvt-panel-images">
    <legend>${label}${required ? html`<span aria-hidden="true"> *</span>` : nothing}</legend>
    ${images.length === 0
      ? html`<p class="cvt-panel-hint">Add a picture to the chat to use it here.</p>`
      : html`<div class="cvt-panel-image-list" role="group" aria-label=${label}>
          ${required ? nothing : html`<button type="button" class="cvt-panel-image cvt-panel-image-none" aria-pressed=${String(value === '')} @click=${() => set('')}>None</button>`}
          ${images.map(
            (image) =>
              html`<button type="button" class="cvt-panel-image" aria-pressed=${String(value === image.id)} aria-label=${`${key}: ${image.name ?? image.id}`} @click=${() => set(image.id)}>
                <img src=${image.url!} alt="" loading="lazy" />
              </button>`,
          )}
        </div>`}
  </fieldset>`;
}
