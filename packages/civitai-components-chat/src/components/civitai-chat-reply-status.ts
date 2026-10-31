import { html, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { LightElement } from './light.js';

/** How long the status region is on the page, empty, before a first state other than working goes in. */
const ANNOUNCE_AFTER_MS = 100;

/** What a live reply is doing, as its status line says it. */
export type ReplyStatusState = 'working' | 'reconnecting' | 'approval' | 'server';

export const REPLY_STATUS_LABEL: Record<ReplyStatusState, string> = {
  working: 'Working',
  reconnecting: 'Reconnecting…',
  approval: 'Waiting for your approval',
  server: 'Still working on the server',
};

/** How long a reply has run, as `m:ss` (`h:mm:ss` from an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * The line a live reply shows under what it has said so far, from the moment it starts until it ends,
 * whatever it is doing: what state it is in, and for how long it has run. It is its own element so its
 * once-a-second tick redraws only itself, not the reply above it.
 *
 * Its polite `role="status"` region carries the state for a screen reader; the visible words, dots and
 * seconds are hidden from it, so it never hears the seconds. As the line appears the region is empty: a
 * line that starts as working says nothing (the thread already says a reply started), and one that
 * starts in another state (a reply followed again, a call waiting for approval) says it a moment later,
 * once the region is on the page. Each later change of state is said once.
 */
export class CivitaiChatReplyStatus extends LightElement {
  static override properties: PropertyDeclarations = {
    state: { reflect: true },
    since: { type: Number },
  };

  declare state: ReplyStatusState;
  /** When the reply started (ms since the epoch). */
  declare since: number;

  #tick?: ReturnType<typeof setInterval>;
  /** What the status region says: the state, once it changed after the line appeared. */
  #announcement = '';

  constructor() {
    super();
    this.state = 'working';
    this.since = Date.now();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#tick = setInterval(() => this.requestUpdate(), 1000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#tick);
    this.#tick = undefined;
    clearTimeout(this.#first);
  }

  #first?: ReturnType<typeof setTimeout>;

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this.hasUpdated && changed.has('state')) {
      clearTimeout(this.#first);
      this.#announcement = this.#label();
    }
  }

  protected override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    if (this.state === 'working') return;
    const state = this.state;
    this.#first = setTimeout(() => {
      if (this.state !== state || this.#announcement !== '') return;
      this.#announcement = this.#label();
      this.requestUpdate();
    }, ANNOUNCE_AFTER_MS);
  }

  #label(): string {
    return REPLY_STATUS_LABEL[this.state] ?? REPLY_STATUS_LABEL.working;
  }

  override render(): TemplateResult {
    return html`<span class="cvt-reply-status-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="cvt-reply-status-label" aria-hidden="true">${this.#label()}</span>
      <span class="cvt-reply-status-time" aria-hidden="true">· ${formatElapsed(Date.now() - this.since)}</span>
      <span class="cvt-visually-hidden" role="status" aria-live="polite">${this.#announcement}</span>`;
  }
}
