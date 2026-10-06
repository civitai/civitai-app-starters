import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import { chatConfig } from '../config.js';
import type { ConversationSummary } from '../types.js';
import { LightElement, emit } from './light.js';

const DAY_MS = 86_400_000;

export function groupByDay(summaries: ConversationSummary[], now = new Date()): { label: string; items: ConversationSummary[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = [
    { label: 'Today', from: startOfToday, items: [] as ConversationSummary[] },
    { label: 'Yesterday', from: startOfToday - DAY_MS, items: [] as ConversationSummary[] },
    { label: 'Previous 7 days', from: startOfToday - 7 * DAY_MS, items: [] as ConversationSummary[] },
    { label: 'Earlier', from: -Infinity, items: [] as ConversationSummary[] },
  ];
  for (const summary of summaries) {
    const at = Date.parse(summary.updatedAt);
    groups.find((group) => at >= group.from)?.items.push(summary);
  }
  return groups.filter((group) => group.items.length > 0);
}

export class CivitaiChatSidebar extends LightElement {
  static override properties: PropertyDeclarations = {
    summaries: { attribute: false },
    currentId: { attribute: false },
    hasMore: { type: Boolean },
    userName: {},
    editingId: { state: true },
  };

  declare summaries: ConversationSummary[];
  declare currentId: string | null;
  declare hasMore: boolean;
  declare userName: string;
  declare editingId: string | null;

  constructor() {
    super();
    this.summaries = [];
    this.currentId = null;
    this.hasMore = false;
    this.userName = '';
    this.editingId = null;
  }

  #commit(summary: ConversationSummary, input: HTMLInputElement): void {
    if (this.editingId !== summary.id) return;
    this.editingId = null;
    const title = input.value.trim();
    if (title && title !== summary.title) emit(this, 'cvt-rename', { id: summary.id, title });
  }

  #row(summary: ConversationSummary): TemplateResult {
    const current = summary.id === this.currentId;
    if (this.editingId === summary.id) {
      return html`<li class="cvt-chat-row" data-current=${current ? '' : nothing}>
        <input
          class="cvt-rename"
          aria-label="Chat name"
          .value=${summary.title}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter') this.#commit(summary, event.target as HTMLInputElement);
            if (event.key === 'Escape') this.editingId = null;
          }}
          @blur=${(event: FocusEvent) => this.#commit(summary, event.target as HTMLInputElement)}
        />
      </li>`;
    }
    return html`<li class="cvt-chat-row" data-current=${current ? '' : nothing}>
      <button class="cvt-chat-open" aria-current=${current ? 'page' : nothing} @click=${() => emit(this, 'cvt-open', { id: summary.id })}>${summary.title}</button>
      <span class="cvt-chat-actions">
        <button class="cvt-icon-button" aria-label=${`Rename ${summary.title}`} @click=${() => this.#startEditing(summary.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
        </button>
        <button class="cvt-icon-button" aria-label=${`Delete ${summary.title}`} @click=${() => emit(this, 'cvt-delete', { id: summary.id, title: summary.title })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg>
        </button>
      </span>
    </li>`;
  }

  async #startEditing(id: string): Promise<void> {
    this.editingId = id;
    await this.updateComplete;
    const input = this.querySelector<HTMLInputElement>('.cvt-rename');
    input?.focus();
    input?.select();
  }

  override render(): TemplateResult {
    return html`<nav class="cvt-sidebar-inner" aria-label="Chats">
      <div class="cvt-sidebar-top">
        <span class="cvt-brand">${chatConfig.name}</span>
        <civitai-button size="sm" variant="light" @click=${() => emit(this, 'cvt-new-chat')}>New chat</civitai-button>
      </div>
      <div class="cvt-chat-list">
        ${this.summaries.length === 0 ? html`<p class="cvt-empty">Your chats will appear here.</p>` : nothing}
        ${groupByDay(this.summaries).map(
          (group) => html`<section>
            <h2>${group.label}</h2>
            <ul>
              ${group.items.map((summary) => this.#row(summary))}
            </ul>
          </section>`,
        )}
        ${this.hasMore ? html`<civitai-button size="sm" variant="subtle" full-width @click=${() => emit(this, 'cvt-load-more')}>Show older chats</civitai-button>` : nothing}
      </div>
      <div class="cvt-sidebar-footer">
        <civitai-avatar size="sm" .name=${this.userName || 'You'}></civitai-avatar>
        <span class="cvt-user-name">${this.userName || 'You'}</span>
        <button class="cvt-icon-button" aria-label="Settings" @click=${() => emit(this, 'cvt-open-settings')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.2-.8.2-1.2z" /></svg>
        </button>
      </div>
    </nav>`;
  }
}
