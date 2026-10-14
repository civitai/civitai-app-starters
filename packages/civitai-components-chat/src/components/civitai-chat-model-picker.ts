import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { priceLabel, type ChatModelEntry } from '../agent/model-list.js';
import { LightElement, emit } from './light.js';

/** How many matches the menu shows at once; typing narrows the rest. */
const SHOWN = 150;

/** A model's name for the button: its listed label, else the last part of its id. */
export function modelLabel(id: string, models: ChatModelEntry[]): string {
  const entry = models.find((model) => model.id === id);
  if (entry) return entry.label;
  return id.split(/[/:]/).filter(Boolean).at(-1) ?? id;
}

/**
 * The open chat's model, as a button by the message box: it opens a searchable list and fires
 * `cvt-model-pick` with `{ model }` (`undefined` = follow the default). `cvt-model-open` fires each
 * time the list opens, so the chat can load it then.
 */
export class CivitaiChatModelPicker extends LightElement {
  static override properties: PropertyDeclarations = {
    value: {},
    own: { type: Boolean },
    defaultModel: { attribute: false },
    models: { attribute: false },
    loading: { type: Boolean },
    disabled: { type: Boolean },
    open: { state: true },
    query: { state: true },
  };

  /** The model the chat's next reply uses. */
  declare value: string;
  /** The chat picked `value` itself, rather than following the default. */
  declare own: boolean;
  /** What "Default" means for this viewer: their own default model, when they set one. */
  declare defaultModel: string | undefined;
  declare models: ChatModelEntry[];
  declare loading: boolean;
  declare disabled: boolean;
  declare open: boolean;
  declare query: string;

  constructor() {
    super();
    this.value = '';
    this.own = false;
    this.models = [];
    this.loading = false;
    this.disabled = false;
    this.open = false;
    this.query = '';
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.#onOutside, true);
  }

  protected override updated(changed: PropertyValues): void {
    if (!changed.has('open')) return;
    if (this.open) {
      document.addEventListener('pointerdown', this.#onOutside, true);
      this.querySelector<HTMLInputElement>('.cvt-model-search')?.focus();
    } else {
      document.removeEventListener('pointerdown', this.#onOutside, true);
    }
  }

  #onOutside = (event: PointerEvent): void => {
    if (!event.composedPath().includes(this)) this.open = false;
  };

  #toggle(): void {
    this.open = !this.open;
    this.query = '';
    if (this.open) emit(this, 'cvt-model-open');
  }

  #close(): void {
    this.open = false;
    this.querySelector<HTMLButtonElement>('.cvt-model-chip')?.focus();
  }

  #pick(model: string | undefined): void {
    this.#close();
    emit(this, 'cvt-model-pick', { model });
  }

  /** The models the search matches, the page's default left out: "Default" stands for it. */
  #matches(): ChatModelEntry[] {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.models.filter((model) => model.source !== 'default' && words.every((word) => model.label.toLowerCase().includes(word) || model.id.toLowerCase().includes(word)));
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.#close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const typed = this.query.trim();
      if (!typed) return;
      // An exact id or name picks that model. A typed id (one word with / or :) is meant as is,
      // never swapped for a longer id it begins; anything else, like "OpenAI: GPT-4o", is a search.
      const wanted = typed.toLowerCase();
      // "Default", by name or as typed, means what the Default row means: follow the viewer's default.
      if (wanted === 'default') return this.#pick(undefined);
      const exact = this.models.find((model) => model.id.toLowerCase() === wanted || (model.source !== 'default' && model.label.toLowerCase() === wanted));
      if (exact) return this.#pick(exact.id);
      const [first] = this.#matches();
      this.#pick(first && !/^\S*[/:]\S*$/.test(typed) ? first.id : typed);
    }
  };

  #option(entry: ChatModelEntry): TemplateResult {
    const selected = this.own && entry.id === this.value;
    const price = entry.source === 'hosted' ? 'Hosted' : priceLabel(entry);
    return html`<li>
      <button type="button" role="option" aria-selected=${String(selected)} @click=${() => this.#pick(entry.id)}>
        <span class="cvt-model-name">${entry.label}</span>
        ${price ? html`<span class="cvt-model-price">${price}</span>` : nothing}
        ${entry.label !== entry.id ? html`<span class="cvt-model-id">${entry.id}</span>` : nothing}
      </button>
    </li>`;
  }

  #menu(): TemplateResult {
    const matches = this.#matches();
    const typed = this.query.trim();
    const custom = typed !== '' && !this.models.some((model) => model.id === typed);
    const fallback = this.defaultModel ? `Your default: ${modelLabel(this.defaultModel, this.models)}` : "The app's default model";
    return html`<div class="cvt-model-menu" role="dialog" aria-label="Model for this chat" @keydown=${this.#onKeyDown}>
      <input
        class="cvt-model-search"
        type="search"
        placeholder="Search models, or type a model id"
        aria-label="Search models, or type a model id"
        .value=${this.query}
        @input=${(event: Event) => (this.query = (event.target as HTMLInputElement).value)}
      />
      <ul class="cvt-model-options" role="listbox" aria-label="Models">
        ${typed === ''
          ? html`<li>
              <button type="button" role="option" aria-selected=${String(!this.own)} @click=${() => this.#pick(undefined)}>
                <span class="cvt-model-name">Default</span>
                <span class="cvt-model-id">${fallback}</span>
              </button>
            </li>`
          : nothing}
        ${matches.slice(0, SHOWN).map((entry) => this.#option(entry))}
        ${custom
          ? html`<li>
              <button type="button" role="option" aria-selected="false" class="cvt-model-custom" @click=${() => this.#pick(typed)}>
                <span class="cvt-model-name">Use “${typed}”</span>
                <span class="cvt-model-id">Any chat model id the Civitai orchestrator serves</span>
              </button>
            </li>`
          : nothing}
      </ul>
      ${this.loading ? html`<p class="cvt-model-status" role="status">Loading more models…</p>` : nothing}
      ${matches.length > SHOWN ? html`<p class="cvt-model-status">${matches.length - SHOWN} more; type to narrow the list.</p>` : nothing}
    </div>`;
  }

  override render(): TemplateResult {
    // The page's default is listed as "Default"; any other model shows its own name.
    const name = modelLabel(this.value, this.models);
    return html`<button
        class="cvt-model-chip"
        type="button"
        aria-haspopup="dialog"
        aria-expanded=${String(this.open)}
        title=${`Model for this chat: ${this.value}`}
        ?disabled=${this.disabled}
        @click=${() => this.#toggle()}
      >
        <span class="cvt-visually-hidden">Model for this chat: </span><span class="cvt-model-chip-name">${name}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      ${this.open ? this.#menu() : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-model-picker': CivitaiChatModelPicker;
  }
}
