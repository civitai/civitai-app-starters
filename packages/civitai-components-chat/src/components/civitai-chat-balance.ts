import '@civitai/components/civitai-progress/define';
import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { TOP_UP_BUZZ } from '../config.js';
import { LightElement, emit } from './light.js';

export interface BalanceView {
  /** Whether the free replies were read; the badge says nothing about them before. */
  loaded: boolean;
  /** The open chat model's free replies; none when it has no free tier. */
  free?: { remaining: number; limit: number; resetAt?: string };
  /** Undefined until it was read. */
  balance?: number;
  autoTopUp: boolean;
  /** A top-up is on its way. */
  busy: boolean;
}

let ids = 0;

/**
 * What the viewer has left to chat with: a top-bar badge ("187 free", else the chat balance) that
 * opens like `civitai-chat-spend`. Emits `cvt-top-up` (`{ auto: false }`) and `cvt-auto-top-up` (`{ on }`).
 */
export class CivitaiChatBalance extends LightElement {
  static override properties: PropertyDeclarations = {
    view: { attribute: false },
    open: { state: true },
  };

  declare view: BalanceView;
  declare open: boolean;
  #panelId = `cvt-balance-panel-${++ids}`;

  constructor() {
    super();
    this.view = { loaded: false, autoTopUp: false, busy: false };
    this.open = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#listen(false);
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('open')) this.#listen(this.open);
    if (changed.has('open') && this.open) emit(this, 'cvt-balance-open');
  }

  #listen(on: boolean): void {
    if (on) document.addEventListener('pointerdown', this.#onOutside, true);
    else document.removeEventListener('pointerdown', this.#onOutside, true);
  }

  #onOutside = (event: PointerEvent): void => {
    if (!event.composedPath().includes(this)) this.open = false;
  };

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.open) return;
    event.preventDefault();
    this.open = false;
    this.querySelector<HTMLButtonElement>('.cvt-spend')?.focus();
  };

  override render(): TemplateResult {
    const { loaded, free, balance, autoTopUp, busy } = this.view;
    const n = (value: number) => value.toLocaleString();
    const onFree = free !== undefined && free.remaining > 0;
    const pill = !loaded ? '…' : onFree ? `${n(free.remaining)} free` : balance === undefined ? '…' : `${n(balance)} left`;
    const label = !loaded ? 'Your free replies and chat balance' : onFree ? `${n(free.remaining)} free replies left` : `Chat balance ${n(balance ?? 0)} Buzz`;
    return html`<button
        type="button"
        class="cvt-spend"
        aria-expanded=${String(this.open)}
        aria-controls=${this.#panelId}
        aria-label=${`${label}. Show details`}
        @click=${() => (this.open = !this.open)}
        @keydown=${this.#onKey}
      >
        <span class="cvt-spend-pill" aria-hidden="true">
          <svg class="cvt-balance-icon" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>${pill}
        </span>
      </button>
      <div class="cvt-spend-panel cvt-balance-panel" id=${this.#panelId} role="region" aria-label="Your replies" tabindex="-1" ?hidden=${!this.open} @keydown=${this.#onKey}>
        <section>
          <h3>Free replies</h3>
          ${!loaded ? html`<p class="cvt-spend-note">…</p>` : free ? this.#free(free) : html`<p class="cvt-spend-note">This model has no free replies.</p>`}
        </section>
        <section>
          <h3>Chat balance</h3>
          <dl class="cvt-spend-rows"><div class="cvt-spend-row"><dt>Left</dt><dd data-balance="fund">${balance === undefined ? '…' : `${n(balance)} Buzz`}</dd></div></dl>
          <civitai-button size="sm" variant="light" ?disabled=${busy} @click=${() => emit(this, 'cvt-top-up', { auto: false })}>Top up ${TOP_UP_BUZZ} Buzz</civitai-button>
          <civitai-switch
            label="Top up when empty"
            .checked=${autoTopUp}
            @change=${(event: Event) => emit(this, 'cvt-auto-top-up', { on: (event.target as HTMLInputElement).checked })}
          ></civitai-switch>
        </section>
        <p class="cvt-spend-note">Replies use your free ones first, then the chat balance (about 1 Buzz each). A balance unused for 7 days expires.</p>
      </div>`;
  }

  #free(free: NonNullable<BalanceView['free']>): TemplateResult {
    const used = Math.max(0, free.limit - free.remaining);
    const reset = free.resetAt && used > 0 ? new Date(free.resetAt) : undefined;
    return html`<dl class="cvt-spend-rows"><div class="cvt-spend-row"><dt>${used.toLocaleString()} of ${free.limit.toLocaleString()} used</dt><dd data-balance="free">${reset ? `Resets ${when(reset)}` : nothing}</dd></div></dl>
      <civitai-progress size="sm" .value=${free.limit > 0 ? Math.round((used / free.limit) * 100) : 0} label="Free replies used"></civitai-progress>`;
  }
}

function when(at: Date): string {
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-balance': CivitaiChatBalance;
  }
}
