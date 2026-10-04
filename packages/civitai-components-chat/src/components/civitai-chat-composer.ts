import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import type { PendingUpload } from '../session.js';
import type { Attachment } from '../types.js';
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from '../uploads/upload.js';
import { suggestCommands, type ChatCommand } from '../ux/commands.js';
import type { CivitaiChatDropzone } from './lib/civitai-chat-dropzone.js';
import type { StripItem } from './lib/civitai-chat-attachment-strip.js';
import { LightElement, emit } from './light.js';

export class CivitaiChatComposer extends LightElement {
  static override properties: PropertyDeclarations = {
    running: { type: Boolean },
    disabled: { type: Boolean },
    uploads: { attribute: false },
    refs: { attribute: false },
    placeholder: {},
    text: { state: true },
  };

  declare running: boolean;
  declare disabled: boolean;
  declare uploads: PendingUpload[];
  declare refs: Attachment[];
  declare placeholder: string;
  declare text: string;

  constructor() {
    super();
    this.running = false;
    this.disabled = false;
    this.uploads = [];
    this.refs = [];
    this.placeholder = 'Ask for a picture, a video, a song… or anything about Civitai';
    this.text = '';
  }

  get draft(): string {
    return this.text;
  }

  set draft(value: string) {
    this.text = value;
    void this.updateComplete.then(() => this.#autosize());
  }

  override focus(): void {
    this.querySelector('textarea')?.focus();
  }

  browse(): void {
    this.querySelector<CivitaiChatDropzone>('civitai-chat-dropzone')?.browse();
  }

  get #uploading(): boolean {
    return this.uploads.some((upload) => !upload.attachment && !upload.error);
  }

  get #canSend(): boolean {
    const hasContent = this.text.trim() !== '' || this.uploads.some((u) => u.attachment) || this.refs.length > 0;
    return hasContent && !this.running && !this.disabled && !this.#uploading;
  }

  #send(): void {
    if (!this.#canSend) return;
    emit(this, 'cvt-send', { text: this.text.trim() });
    this.text = '';
    void this.updateComplete.then(() => this.#autosize());
  }

  #complete(command: ChatCommand): void {
    this.text = `/${command.name} `;
    void this.updateComplete.then(() => {
      const area = this.querySelector('textarea');
      area?.focus();
      area?.setSelectionRange(this.text.length, this.text.length);
    });
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    const suggestions = suggestCommands(this.text);
    if (event.key === 'Tab' && suggestions.length === 1) {
      event.preventDefault();
      this.#complete(suggestions[0]!);
      return;
    }
    if (event.key === 'Escape' && this.running) {
      event.preventDefault();
      emit(this, 'cvt-stop');
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.#send();
  };

  #onInput = (event: Event): void => {
    this.text = (event.target as HTMLTextAreaElement).value;
    this.#autosize();
  };

  // Browsers without `field-sizing: content` still grow the box as the message does.
  #autosize(): void {
    const area = this.querySelector('textarea');
    if (!area || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 240)}px`;
  }

  #items(): StripItem[] {
    return [
      ...this.uploads.map((upload) => ({
        key: upload.key,
        kind: upload.attachment?.kind ?? (upload.file.type.split('/')[0] as StripItem['kind']),
        src: upload.attachment?.url,
        label: upload.file.name,
        progress: upload.attachment || upload.error ? undefined : upload.progress,
        error: upload.error,
      })),
      ...this.refs.map((ref) => ({ key: ref.id, kind: ref.kind, src: ref.url, label: 'Earlier result' })),
    ];
  }

  #onRemove = (event: CustomEvent<{ key: string }>): void => {
    event.stopPropagation();
    emit(this, 'cvt-remove-file', { key: event.detail.key });
  };

  #suggestions(): TemplateResult | typeof nothing {
    const suggestions = suggestCommands(this.text);
    if (suggestions.length === 0) return nothing;
    return html`<ul class="cvt-commands" aria-label="Commands">
      ${suggestions.map(
        (command) => html`<li>
          <button type="button" @click=${() => this.#complete(command)}><code>${command.usage}</code><span>${command.help}</span></button>
        </li>`,
      )}
    </ul>`;
  }

  override render(): TemplateResult {
    const items = this.#items();
    return html`<civitai-chat-dropzone
      no-drop
      accept=${ACCEPT_ATTRIBUTE}
      max-size=${MAX_UPLOAD_BYTES}
      multiple
      ?disabled=${this.disabled}
      @files=${(event: CustomEvent<{ files: File[] }>) => emit(this, 'cvt-files', { files: event.detail.files })}
      @rejected=${(event: CustomEvent<{ reason: string }>) => emit(this, 'cvt-files-rejected', event.detail)}
    >
      <div class="cvt-composer-box">
        ${this.#suggestions()}
        ${items.length ? html`<civitai-chat-attachment-strip removable size="sm" .items=${items} @remove=${this.#onRemove}></civitai-chat-attachment-strip>` : nothing}
        <textarea
          rows="1"
          .value=${this.text}
          placeholder=${this.placeholder}
          aria-label="Message"
          aria-describedby="cvt-composer-hint"
          ?disabled=${this.disabled}
          @input=${this.#onInput}
          @keydown=${this.#onKeyDown}
        ></textarea>
        <div class="cvt-composer-actions">
          <button class="cvt-icon-button" type="button" aria-label="Add a photo, video or audio file" ?disabled=${this.disabled} @click=${() => this.browse()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <span id="cvt-composer-hint" class="cvt-hint">Enter to send, Shift+Enter for a new line</span>
          ${this.running
            ? html`<button class="cvt-send" type="button" aria-label="Stop" aria-keyshortcuts="Escape" @click=${() => emit(this, 'cvt-stop')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
              </button>`
            : html`<button class="cvt-send" type="button" aria-label="Send" ?disabled=${!this.#canSend} @click=${() => this.#send()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>
              </button>`}
        </div>
      </div>
    </civitai-chat-dropzone>`;
  }
}
