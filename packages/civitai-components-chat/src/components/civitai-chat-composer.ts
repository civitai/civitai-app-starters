import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import type { PendingUpload } from '../session.js';
import type { Attachment } from '../types.js';
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from '../uploads/upload.js';
import { suggestCommands, type ChatCommand } from '../ux/commands.js';
import { VOICE_LANGUAGES } from '../voice/languages.js';
import { canStreamPcm, PcmRecorder } from '../voice/pcm-recorder.js';
import { canRecord, VoiceRecorder } from '../voice/recorder.js';
import type { CivitaiChatDropzone } from './lib/civitai-chat-dropzone.js';
import type { StripItem } from './lib/civitai-chat-attachment-strip.js';
import { LightElement, emit } from './light.js';

const LEVEL_BARS = 48;

export class CivitaiChatComposer extends LightElement {
  static override properties: PropertyDeclarations = {
    running: { type: Boolean },
    disabled: { type: Boolean },
    uploads: { attribute: false },
    refs: { attribute: false },
    placeholder: {},
    voice: { type: Boolean },
    transcribing: { type: Boolean },
    heard: {},
    voiceLanguage: { attribute: 'voice-language' },
    text: { state: true },
    recording: { state: true },
    levels: { state: true },
  };

  declare running: boolean;
  declare disabled: boolean;
  declare uploads: PendingUpload[];
  declare refs: Attachment[];
  declare placeholder: string;
  /** Offers the microphone; the chat transcribes each `cvt-voice-phrase` and shows the text in `heard`. */
  declare voice: boolean;
  declare transcribing: boolean;
  declare heard: string;
  declare voiceLanguage: string;
  declare text: string;
  declare recording: boolean;
  declare levels: number[];

  #recorder?: VoiceRecorder | PcmRecorder;

  constructor() {
    super();
    this.running = false;
    this.disabled = false;
    this.uploads = [];
    this.refs = [];
    this.placeholder = 'Ask for a picture, a video, a song… or anything about Civitai';
    this.text = '';
    this.voice = false;
    this.transcribing = false;
    this.heard = '';
    this.voiceLanguage = 'en';
    this.recording = false;
    this.levels = [];
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#recorder?.cancel();
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
    return hasContent && !this.running && !this.disabled && !this.#uploading && !this.transcribing;
  }

  async #record(): Promise<void> {
    if (this.recording) return;
    this.levels = [];
    let barAt = 0;
    const onLevel = (level: number) => {
      // A bar about every 70 ms keeps the meter moving at reading speed.
      const now = performance.now();
      if (now - barAt < 70) return;
      barAt = now;
      this.levels = [...this.levels.slice(-(LEVEL_BARS - 1)), level];
    };
    const onLimit = () => void this.#finish(false);
    try {
      let live = false;
      if (canStreamPcm()) {
        try {
          this.#recorder = await PcmRecorder.start({ onLevel, onAudio: (pcm) => emit(this, 'cvt-voice-audio', { pcm }), onLimit });
          live = true;
        } catch (error) {
          // A refused microphone is the viewer's answer; anything else (no worklet allowed) falls back to phrases.
          if ((error as { name?: unknown } | null)?.name === 'NotAllowedError') throw error;
        }
      }
      this.#recorder ??= await VoiceRecorder.start({ onLevel, onPhrase: (recording) => emit(this, 'cvt-voice-phrase', { recording }), onLimit });
      emit(this, 'cvt-voice-start', { live });
      this.recording = true;
    } catch (error) {
      emit(this, 'cvt-voice-error', { error });
    }
  }

  /** Ends a recording the chat can no longer use, e.g. when transcription stopped listening; its text goes in the box. */
  stopListening(): void {
    void this.#finish(false);
  }

  async #finish(send: boolean): Promise<void> {
    const recorder = this.#recorder;
    if (!recorder) return;
    this.#recorder = undefined;
    this.recording = false;
    await recorder.stop();
    emit(this, 'cvt-voice-done', { send });
  }

  #cancelRecording(): void {
    this.#recorder?.cancel();
    this.#recorder = undefined;
    this.recording = false;
    emit(this, 'cvt-voice-cancel');
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
    if (event.key === 'Escape' && this.recording) {
      event.preventDefault();
      this.#cancelRecording();
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

  #recordingBar(): TemplateResult {
    const bars = [...Array.from({ length: LEVEL_BARS - this.levels.length }, () => 0), ...this.levels];
    return html`${this.#heard()}<div class="cvt-recording" role="group" aria-label="Recording your voice" @keydown=${this.#onKeyDown}>
      <button class="cvt-icon-button" type="button" aria-label="Cancel recording" @click=${() => this.#cancelRecording()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <div class="cvt-levels" aria-hidden="true">${bars.map((level) => html`<span style="height:${Math.max(2, Math.round(level * 24))}px"></span>`)}</div>
      <button class="cvt-icon-button" type="button" aria-label="Stop and edit the text" @click=${() => void this.#finish(false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
      </button>
      <button class="cvt-send" type="button" aria-label="Send what you said" ?disabled=${this.running || this.disabled} @click=${() => void this.#finish(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>
      </button>
    </div>`;
  }

  #heard(): TemplateResult | typeof nothing {
    return this.heard ? html`<p class="cvt-heard" aria-live="polite">${this.heard}</p>` : nothing;
  }

  #transcribingBar(): TemplateResult {
    return html`${this.#heard()}<div class="cvt-transcribing" role="status">
      <span class="cvt-spinner" aria-hidden="true"></span>
      <span class="cvt-transcribing-label">${this.heard ? 'Catching your last words…' : 'Turning what you said into text…'}</span>
      <button class="cvt-icon-button" type="button" aria-label="Stop transcribing" @click=${() => emit(this, 'cvt-voice-cancel')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>`;
  }

  #languagePicker(): TemplateResult {
    return html`<label class="cvt-voice-language" title="The language you speak">
      <span aria-hidden="true">${this.voiceLanguage.toUpperCase()}</span>
      <select
        aria-label="The language you speak"
        .value=${this.voiceLanguage}
        ?disabled=${this.disabled}
        @change=${(event: Event) => emit(this, 'cvt-voice-language', { language: (event.target as HTMLSelectElement).value })}
      >
        ${VOICE_LANGUAGES.map((language) => html`<option value=${language.code} ?selected=${language.code === this.voiceLanguage}>${language.name}</option>`)}
      </select>
    </label>`;
  }

  #typing(): TemplateResult {
    return html`<textarea
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
          ${this.voice && (canStreamPcm() || canRecord()) && !this.running ? this.#languagePicker() : nothing}
          ${this.voice && (canStreamPcm() || canRecord()) && !this.running
            ? html`<button class="cvt-icon-button" type="button" aria-label="Talk instead of typing" title="Talk instead of typing (about 2 Buzz)" ?disabled=${this.disabled} @click=${() => void this.#record()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </button>`
            : nothing}
          ${this.running
            ? html`<button class="cvt-send" type="button" aria-label="Stop" aria-keyshortcuts="Escape" @click=${() => emit(this, 'cvt-stop')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
              </button>`
            : html`<button class="cvt-send" type="button" aria-label="Send" ?disabled=${!this.#canSend} @click=${() => this.#send()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>
              </button>`}
        </div>`;
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
        ${this.recording ? this.#recordingBar() : this.transcribing ? this.#transcribingBar() : this.#typing()}
      </div>
    </civitai-chat-dropzone>`;
  }
}
