import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { CivitaiElement, defineElement } from '../elements/internals.js';
import { hostBaseline } from '../elements/shared-styles.js';
import '../elements/civitai-badge.define.js';
import '../elements/civitai-button.define.js';
import '../elements/civitai-loader.define.js';
import '../elements/civitai-modal.define.js';
import {
  ResourceSourceError,
  type PickedResource,
  type ResourceAccess,
  type ResourceItem,
  type ResourceOwner,
  type ResourceSearchParams,
  type ResourceSource,
  type ResourceSourceErrorKind,
  type ResourceVersion,
} from './resource-source.js';

export {
  appClientSource,
  blockTokenSource,
  buildResourceSearchUrl,
  parseResourcePage,
  resourceSearchQuery,
  BLOCK_MODELS_PATH,
  DEFAULT_RETRY_AFTER_MS,
  ResourceSourceError,
} from './resource-source.js';
export type {
  BlockTokenSourceOptions,
  PickedResource,
  ResourceAccess,
  ResourceItem,
  ResourceOwner,
  ResourcePage,
  ResourceSearchParams,
  ResourceSource,
  ResourceSourceErrorKind,
  ResourceVersion,
  SiteReader,
} from './resource-source.js';

const TAG = 'civitai-resource-picker';

/** Where the picker is. Exported so a consumer can name `phase`. */
export type ResourcePickerPhase = 'idle' | 'loading' | 'ready' | 'retrying' | 'error';

/** Automatic retries of a busy (429/503) search before the picker asks the viewer. */
export const MAX_AUTO_RETRIES = 2;

/** A server asking for longer than this is waited on by the viewer, not by a timer. */
const MAX_RETRY_WAIT_MS = 10_000;

let sequence = 0;

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const accessOf = (version: ResourceVersion): ResourceAccess => version.access ?? 'open';

/**
 * Lets a viewer pick one version of a published resource — theirs, or anyone's
 * — from the Civitai catalog, through a {@link ResourceSource} the app supplies.
 *
 * 🔴 What it hands back is a CLAIM the app's code can alter, not proof. The
 * `owner` of a pick in particular says which list the viewer was looking at; a
 * server that must know the resource is the viewer's own checks that itself.
 */
export class CivitaiResourcePicker extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: contents;
      }
      .controls {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 12px;
      }
      fieldset {
        display: inline-flex;
        gap: 4px;
        margin: 0;
        padding: 3px;
        border: none;
        border-radius: var(--civitai-radius);
        background: var(--civitai-color-segmented-bg, var(--civitai-color-surface-2));
        width: fit-content;
      }
      legend {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .owner {
        position: relative;
        display: inline-flex;
      }
      .owner input {
        position: absolute;
        opacity: 0;
        inset: 0;
        margin: 0;
        cursor: pointer;
      }
      .owner span {
        padding: 6px 12px;
        border-radius: calc(var(--civitai-radius) - 2px);
        font-size: 14px;
        color: var(--civitai-color-text-dimmed);
      }
      .owner input:checked + span {
        background: var(--civitai-color-surface);
        color: var(--civitai-color-text);
        font-weight: 600;
      }
      .owner input:focus-visible + span {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 1px;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      input[type='search'],
      select {
        font: inherit;
        font-size: 14px;
        color: var(--civitai-color-text);
        background: var(--civitai-color-body);
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius);
        padding: 7px 10px;
        width: 100%;
      }
      input[type='search']:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 0;
        border-color: var(--civitai-color-primary);
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 60vh;
        overflow-y: auto;
      }
      .item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px 12px;
        align-items: center;
        padding: 10px 12px;
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius);
        background: var(--civitai-color-surface);
      }
      .name {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .by {
        font-size: 12px;
        color: var(--civitai-color-text-dimmed);
      }
      .version {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .version select {
        width: auto;
        max-width: 100%;
        flex: 1 1 200px;
      }
      .message {
        margin: 12px 0;
        font-size: 14px;
        color: var(--civitai-color-text-dimmed);
      }
      .message[role='alert'] {
        color: var(--civitai-color-text);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .loading {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .more {
        display: flex;
        justify-content: center;
        margin-top: 12px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    open: { type: Boolean, reflect: true },
    types: { reflect: true },
    owner: { reflect: true },
    heading: { reflect: true },
    noun: { reflect: true },
    debounce: { type: Number, reflect: true },
    limit: { type: Number, reflect: true },
    source: { attribute: false },
    phase: { state: true },
    items: { state: true },
    nextCursor: { state: true },
    query: { state: true },
    errorKind: { state: true },
    errorMessage: { state: true },
    loadingMore: { state: true },
    chosen: { state: true },
  };

  /** Shows the picker. Setting it false closes it without a pick or a `dismiss`. */
  declare open: boolean;
  /** Model types to list, space- or comma-separated, e.g. `Workflows ComfyWorkflows`. */
  declare types: string;
  /** Which list shows first, and which one the viewer is on. */
  declare owner: ResourceOwner;
  declare heading: string;
  /** What one item is called in the picker's own words; `s` is added for many. */
  declare noun: string;
  /** Milliseconds of quiet typing before a search runs. */
  declare debounce: number;
  /** Page size, 1–100. */
  declare limit: number;
  /** Where results come from. Required. */
  declare source?: ResourceSource;
  declare phase: ResourcePickerPhase;
  declare items: ResourceItem[];
  declare nextCursor: string | null;
  declare query: string;
  declare errorKind: ResourceSourceErrorKind | null;
  declare errorMessage: string;
  declare loadingMore: boolean;
  /** Version id the viewer has chosen per model id; absent means the newest. */
  declare chosen: Map<number, number>;

  readonly #id = `ci-picker-${(sequence += 1)}`;
  #seq = 0;
  #controller?: AbortController;
  #debounceTimer?: ReturnType<typeof setTimeout>;
  #retryTimer?: ReturnType<typeof setTimeout>;
  #retries = 0;
  #lastAppend = false;
  #pending?: (picked: PickedResource | null) => void;

  constructor() {
    super();
    this.open = false;
    this.types = '';
    this.owner = 'any';
    this.heading = 'Choose a resource';
    this.noun = 'resource';
    this.debounce = 300;
    this.limit = 20;
    this.phase = 'idle';
    this.items = [];
    this.nextCursor = null;
    this.query = '';
    this.errorKind = null;
    this.errorMessage = '';
    this.loadingMore = false;
    this.chosen = new Map();
  }

  /** Opens the picker; resolves with the pick, or `null` when it closes without one. */
  show(): Promise<PickedResource | null> {
    this.#pending?.(null);
    const result = new Promise<PickedResource | null>((resolve) => (this.#pending = resolve));
    this.open = true;
    return result;
  }

  /** Closes the picker as a dismissal: fires `dismiss` and resolves `show()` with `null`. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.#dismissed();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stop();
    this.#settle(null);
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (!changed.has('open')) {
      // A new source or type list while open answers a different question, so
      // ask it — this is also how a picker opened before its source existed
      // recovers once the source arrives.
      if (this.open && (changed.has('source') || changed.has('types'))) {
        this.#retries = 0;
        void this.#search(false);
      }
      return;
    }
    if (this.open) {
      void this.#search(false);
    } else if (changed.get('open') === true) {
      this.#stop();
      this.#settle(null);
    }
  }

  #typeList(): string[] {
    return this.types.split(/[\s,]+/).filter(Boolean);
  }

  #plural(): string {
    return `${this.noun}s`;
  }

  #stop(): void {
    clearTimeout(this.#debounceTimer);
    clearTimeout(this.#retryTimer);
    this.#controller?.abort();
    this.#controller = undefined;
    // A late answer to anything in flight is now about a closed picker.
    this.#seq += 1;
    this.loadingMore = false;
  }

  #settle(picked: PickedResource | null): void {
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.(picked);
  }

  #dismissed(): void {
    this.#stop();
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
    this.#settle(null);
  }

  #fail(kind: ResourceSourceErrorKind, message: string): void {
    this.items = [];
    this.nextCursor = null;
    this.loadingMore = false;
    this.errorKind = kind;
    this.errorMessage = message;
    this.phase = 'error';
  }

  async #search(append: boolean): Promise<void> {
    clearTimeout(this.#debounceTimer);
    clearTimeout(this.#retryTimer);
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const seq = (this.#seq += 1);
    this.#lastAppend = append;

    const source = this.source;
    const types = this.#typeList();
    if (!source) return this.#fail('failed', 'This picker has no source to list from.');
    if (types.length === 0) return this.#fail('failed', 'This picker was not told what to list.');

    const params: ResourceSearchParams = {
      types,
      owner: this.owner,
      query: this.query,
      limit: this.limit,
      ...(append && this.nextCursor ? { cursor: this.nextCursor } : {}),
    };

    if (append) {
      this.loadingMore = true;
    } else {
      // A new search never shows the last one's rows: they may be another list's.
      this.items = [];
      this.nextCursor = null;
      if (this.phase !== 'retrying') this.phase = 'loading';
    }
    this.errorKind = null;

    let page;
    try {
      page = await source.search(params, controller.signal);
    } catch (error) {
      if (seq !== this.#seq) return;
      this.loadingMore = false;
      const known = error instanceof ResourceSourceError ? error : null;
      if (known?.kind === 'busy' && this.#retries < MAX_AUTO_RETRIES) {
        this.#retries += 1;
        this.phase = 'retrying';
        this.errorKind = 'busy';
        this.errorMessage = known.message;
        const wait = Math.min(known.retryAfterMs ?? 0, MAX_RETRY_WAIT_MS);
        this.#retryTimer = setTimeout(() => void this.#search(append), wait);
        return;
      }
      if (known?.kind === 'unauthorized' && params.owner === 'mine') {
        return this.#fail('unauthorized', `Sign in to Civitai to see your own ${this.#plural()}.`);
      }
      return this.#fail(
        known?.kind ?? 'failed',
        known?.message ?? (error as Error)?.message ?? 'The search failed.'
      );
    }
    if (seq !== this.#seq) return;

    // 🔴 The source said so, or it did not happen: a `mine` page the server did
    // not confirm as owner-filtered is everybody's, and showing it as "yours"
    // is the one thing this list must never do.
    if (params.owner === 'mine' && page.owner !== 'mine') {
      return this.#fail(
        'owner-unsupported',
        `Civitai could not list only your own ${this.#plural()}, so none are shown.`
      );
    }

    this.#retries = 0;
    this.items = append ? [...this.items, ...page.items] : page.items;
    this.nextCursor = page.nextCursor;
    this.loadingMore = false;
    this.phase = 'ready';
  }

  #retry(): void {
    this.#retries = 0;
    void this.#search(this.#lastAppend);
  }

  #onModalClose(event: Event): void {
    // The modal's own `close` is not this element's.
    event.stopPropagation();
    if (this.open) {
      this.open = false;
      this.#dismissed();
    }
  }

  #onOwner(event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLInputElement).value as ResourceOwner;
    if (value === this.owner) return;
    this.owner = value;
    this.#retries = 0;
    void this.#search(false);
  }

  #onInput(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
    this.#retries = 0;
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => void this.#search(false), this.debounce);
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.#retries = 0;
    void this.#search(false);
  }

  #version(item: ResourceItem): ResourceVersion {
    const id = this.chosen.get(item.modelId);
    return item.versions.find((version) => version.id === id) ?? item.versions[0]!;
  }

  #onVersion(item: ResourceItem, event: Event): void {
    event.stopPropagation();
    const next = new Map(this.chosen);
    next.set(item.modelId, Number((event.target as HTMLSelectElement).value));
    this.chosen = next;
  }

  #pick(item: ResourceItem): void {
    const version = this.#version(item);
    const picked: PickedResource = {
      modelId: item.modelId,
      modelVersionId: version.id,
      name: item.name,
      versionName: version.name,
      creatorUsername: item.creatorUsername,
      baseModel: version.baseModel,
      ...(version.earlyAccessDeadline ? { earlyAccessDeadline: version.earlyAccessDeadline } : {}),
      access: accessOf(version),
      owner: this.owner,
    };
    this.#stop();
    this.open = false;
    this.dispatchEvent(new CustomEvent('pick', { bubbles: true, composed: true, detail: picked }));
    this.#settle(picked);
  }

  #optionText(version: ResourceVersion): string {
    const parts = [version.name];
    if (version.baseModel) parts.push(version.baseModel);
    const access = accessOf(version);
    if (access === 'early-access') parts.push('Early access');
    if (access === 'paid') parts.push('Paid');
    return parts.join(' · ');
  }

  #badges(version: ResourceVersion): TemplateResult | typeof nothing {
    const access = accessOf(version);
    if (access === 'early-access') {
      return html`<civitai-badge part="badge early-access" color="warning" variant="light" size="sm"
        >${version.earlyAccessDeadline
          ? `Early access until ${formatDate(version.earlyAccessDeadline)}`
          : 'Early access'}</civitai-badge
      >`;
    }
    if (access === 'paid') {
      return html`<civitai-badge part="badge paid" color="info" variant="light" size="sm"
        >Paid</civitai-badge
      >`;
    }
    return nothing;
  }

  #renderItem(item: ResourceItem): TemplateResult {
    const version = this.#version(item);
    const selectId = `${this.#id}-v-${item.modelId}`;
    return html`<li class="item" part="item" data-model-id=${item.modelId}>
      <div>
        <div class="name" part="name">${item.name}</div>
        ${item.creatorUsername
          ? html`<div class="by" part="creator">by ${item.creatorUsername}</div>`
          : nothing}
      </div>
      <civitai-button
        part="select"
        size="sm"
        aria-label=${`Select ${item.name}, ${version.name}`}
        @click=${() => this.#pick(item)}
        >Select</civitai-button
      >
      <div class="version">
        <label class="sr-only" for=${selectId}>Version of ${item.name}</label>
        <select
          id=${selectId}
          part="version"
          .value=${String(version.id)}
          @change=${(event: Event) => this.#onVersion(item, event)}
        >
          ${item.versions.map(
            (option) =>
              html`<option value=${option.id} ?selected=${option.id === version.id}>
                ${this.#optionText(option)}
              </option>`
          )}
        </select>
        ${this.#badges(version)}
      </div>
    </li>`;
  }

  #renderBody(): TemplateResult {
    const plural = this.#plural();
    if (this.phase === 'error') {
      return html`<div class="message" role="alert" part="error" data-kind=${this.errorKind ?? 'failed'}>
        <span>${this.errorMessage}</span>
        <civitai-button part="retry" size="sm" variant="light" @click=${() => this.#retry()}
          >Try again</civitai-button
        >
      </div>`;
    }
    if (this.phase === 'retrying') {
      return html`<div class="message loading" role="status" part="retrying">
        <civitai-loader size="sm"></civitai-loader>
        <span>Civitai is busy — trying again…</span>
      </div>`;
    }
    if (this.phase === 'loading' || this.phase === 'idle') {
      return html`<div class="message loading" role="status" part="loading">
        <civitai-loader size="sm"></civitai-loader>
        <span>Loading ${plural}…</span>
      </div>`;
    }
    if (this.items.length === 0) {
      const searched = this.query.trim() !== '';
      const text =
        this.owner === 'mine'
          ? searched
            ? `None of your published ${plural} match.`
            : `You have not published any ${plural} yet.`
          : searched
            ? `No ${plural} match.`
            : `No ${plural} found.`;
      return html`<p class="message" role="status" part="empty">${text}</p>`;
    }
    return html`<ul class="list" part="list" aria-label=${this.heading}>
        ${this.items.map((item) => this.#renderItem(item))}
      </ul>
      ${this.nextCursor
        ? html`<div class="more">
            <civitai-button
              part="more"
              size="sm"
              variant="outline"
              ?loading=${this.loadingMore}
              @click=${() => void this.#search(true)}
              >Load more</civitai-button
            >
          </div>`
        : nothing}`;
  }

  override render(): TemplateResult {
    const plural = this.#plural();
    return html`<civitai-modal
      part="modal"
      size="lg"
      .heading=${this.heading}
      .open=${this.open}
      @close=${this.#onModalClose}
    >
      <div class="controls">
        <fieldset part="owner" @change=${this.#onOwner}>
          <legend>Whose ${plural}</legend>
          <label class="owner"
            ><input
              type="radio"
              name="${this.#id}-owner"
              value="any"
              .checked=${this.owner === 'any'}
            /><span>All ${plural}</span></label
          >
          <label class="owner"
            ><input
              type="radio"
              name="${this.#id}-owner"
              value="mine"
              .checked=${this.owner === 'mine'}
            /><span>My ${plural}</span></label
          >
        </fieldset>
        <label class="sr-only" for="${this.#id}-q">Search ${plural}</label>
        <input
          id="${this.#id}-q"
          part="search"
          type="search"
          placeholder="Search ${plural}"
          autocomplete="off"
          .value=${this.query}
          @input=${this.#onInput}
          @change=${(event: Event) => event.stopPropagation()}
          @keydown=${this.#onKeydown}
        />
      </div>
      ${this.#renderBody()}
    </civitai-modal>`;
  }
}

export function defineCivitaiResourcePicker(): void {
  defineElement(TAG, CivitaiResourcePicker);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-resource-picker': CivitaiResourcePicker;
  }
}
