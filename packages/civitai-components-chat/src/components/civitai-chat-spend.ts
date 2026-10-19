import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import type { Spend } from '../ux/spend.js';
import { LightElement } from './light.js';

let ids = 0;

/**
 * The chat's Buzz so far, as a badge in the top bar ("≈ 12") that opens the breakdown: the total,
 * what was made, the assistant, and a line saying it is an estimate. A click (or Enter/Space) opens
 * it; Escape closes it and puts focus back on the badge, and so does a second click; a click
 * anywhere else closes it and leaves focus where that click put it. Shows nothing at 0.
 */
export class CivitaiChatSpend extends LightElement {
  static override properties: PropertyDeclarations = {
    spend: { attribute: false },
    open: { state: true },
  };

  declare spend: Spend;
  declare open: boolean;
  #panelId = `cvt-spend-panel-${++ids}`;

  constructor() {
    super();
    this.spend = { total: 0, generations: 0, assistant: 0 };
    this.open = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#listen(false);
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('open')) this.#listen(this.open);
    // A chat whose spend went back to 0 (a new chat) has no badge to keep open.
    if (this.open && this.spend.total === 0) this.open = false;
  }

  #listen(on: boolean): void {
    if (on) {
      document.addEventListener('pointerdown', this.#onOutside, true);
      document.addEventListener('keydown', this.#onKey, true);
    } else {
      document.removeEventListener('pointerdown', this.#onOutside, true);
      document.removeEventListener('keydown', this.#onKey, true);
    }
  }

  #onOutside = (event: PointerEvent): void => {
    if (!event.composedPath().includes(this)) this.open = false;
  };

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.open = false;
    this.querySelector<HTMLButtonElement>('.cvt-spend')?.focus();
  };

  override render(): TemplateResult | typeof nothing {
    const { total, generations, assistant } = this.spend;
    if (total === 0) return nothing;
    const n = (value: number) => value.toLocaleString();
    return html`<button
        type="button"
        class="cvt-spend"
        aria-expanded=${String(this.open)}
        aria-controls=${this.#panelId}
        aria-label=${`About ${n(total)} Buzz spent in this chat. Show the breakdown`}
        @click=${() => (this.open = !this.open)}
      >
        <span class="cvt-spend-pill" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>≈ ${n(total)}
        </span>
      </button>
      <div class="cvt-spend-panel" id=${this.#panelId} role="region" aria-label="Buzz in this chat" ?hidden=${!this.open}>
        <dl class="cvt-spend-rows">
          <div class="cvt-spend-row cvt-spend-total"><dt>Total so far</dt><dd data-spend="total">≈ ${n(total)}</dd></div>
          <div class="cvt-spend-row"><dt>For what was made</dt><dd data-spend="generations">${n(generations)}</dd></div>
          <div class="cvt-spend-row"><dt>For the assistant</dt><dd data-spend="assistant">${n(assistant)}</dd></div>
        </dl>
        <p class="cvt-spend-note">
          An estimate of the Buzz spent in this chat: what it made, plus the assistant's replies and saving the chat. Model searches and captions
          aren't counted.
        </p>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-spend': CivitaiChatSpend;
  }
}
