import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CUSTOM_INSTRUCTIONS_MAX, RETENTION_DAYS, type ChatModelOption } from '../config.js';
import type { Settings } from '../types.js';
import { LightElement, emit } from './light.js';

/** "Never ask" is stored as a number JSON can hold. */
export const NEVER_ASK = 1_000_000;

const LIMITS = [
  { value: '0', label: 'Always ask' },
  { value: '25', label: '25 Buzz' },
  { value: '50', label: '50 Buzz' },
  { value: '100', label: '100 Buzz' },
  { value: '250', label: '250 Buzz' },
  { value: String(NEVER_ASK), label: 'Never ask' },
];

const CUSTOM = 'custom';

export class CivitaiChatSettingsDialog extends LightElement {
  static override properties: PropertyDeclarations = {
    open: { type: Boolean },
    settings: { attribute: false },
    userName: {},
    canExport: { type: Boolean },
    canSignOut: { type: Boolean },
    canTheme: { type: Boolean },
    models: { attribute: false },
    customModel: { state: true },
  };

  declare open: boolean;
  declare settings: Settings;
  declare userName: string;
  declare canExport: boolean;
  /** Inside civitai.com the site owns the session. */
  declare canSignOut: boolean;
  /** Only when the chat is the whole page; embedded, the page around it sets the theme. */
  declare canTheme: boolean;
  declare models: ChatModelOption[];
  declare customModel: boolean;

  constructor() {
    super();
    this.open = false;
    this.userName = '';
    this.canExport = false;
    this.canSignOut = true;
    this.canTheme = true;
    this.models = [];
    this.customModel = false;
  }

  #change(patch: Partial<Settings>): void {
    emit(this, 'cvt-settings-change', patch);
  }

  #theme(): TemplateResult {
    return html`<civitai-segmented-control
      label="Appearance"
      .data=${[
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]}
      .value=${this.settings.theme}
      @change=${(event: Event) => this.#change({ theme: (event.target as HTMLInputElement).value as Settings['theme'] })}
    ></civitai-segmented-control>`;
  }

  #model(): TemplateResult {
    const current = this.settings.assistantModel ?? '';
    const listed = current === '' || this.models.some((model) => model.id === current);
    const custom = this.customModel || !listed;
    const data = [{ value: '', label: 'Default' }, ...this.models.map((model) => ({ value: model.id, label: model.label })), { value: CUSTOM, label: 'Custom…' }];
    const note = custom
      ? 'Any chat model the Civitai orchestrator serves; what a reply costs depends on the model.'
      : current === ''
        ? 'The cheapest.'
        : (this.models.find((model) => model.id === current)?.note ?? '');
    return html`<civitai-select
        label="Assistant"
        description=${note}
        .data=${data}
        .value=${custom ? CUSTOM : current}
        @change=${(event: Event) => {
          const value = (event.target as HTMLInputElement).value;
          this.customModel = value === CUSTOM;
          if (value !== CUSTOM) this.#change({ assistantModel: value || undefined });
        }}
      ></civitai-select>
      ${custom
        ? html`<civitai-text-input
            label="Model id"
            description="For example z-ai/glm-5.3-prime. Applies from the next reply."
            placeholder="provider/model"
            .value=${listed ? '' : current}
            @change=${(event: Event) => this.#change({ assistantModel: (event.target as HTMLInputElement).value.trim() || undefined })}
          ></civitai-text-input>`
        : nothing}`;
  }

  override render(): TemplateResult {
    const limit = LIMITS.some((option) => Number(option.value) === this.settings.autoRunLimit) ? String(this.settings.autoRunLimit) : '100';
    return html`<civitai-modal .open=${this.open} heading="Settings" with-close-button @close=${() => emit(this, 'cvt-close-settings')}>
      <div class="cvt-settings">
        ${this.canTheme ? this.#theme() : nothing}
        <civitai-select
          label="Ask before spending more than"
          description="Cheaper requests start right away; you always see the price."
          .data=${LIMITS}
          .value=${limit}
          @change=${(event: Event) => this.#change({ autoRunLimit: Number((event.target as HTMLInputElement).value) })}
        ></civitai-select>
        ${this.#model()}
        <civitai-textarea
          label="Custom instructions"
          description="Sent with every message. Tell the assistant about you, your style, or how you like answers."
          placeholder="For example: I make fantasy book covers. Keep answers short and suggest a bold color palette."
          rows="4"
          maxlength=${CUSTOM_INSTRUCTIONS_MAX}
          .value=${this.settings.customInstructions ?? ''}
          @input=${(event: Event) => this.#change({ customInstructions: (event.currentTarget as HTMLTextAreaElement).value || undefined })}
        ></civitai-textarea>
        <civitai-switch
          label="Show mature content"
          .checked=${this.settings.allowMature}
          @change=${(event: Event) => this.#change({ allowMature: (event.target as HTMLInputElement).checked })}
        ></civitai-switch>
        <section>
          <h3>Your chats</h3>
          <p>Chats are kept in your Civitai account for ${RETENTION_DAYS} days after your last message, and what you make for ${RETENTION_DAYS} days after it is made, so they follow you to any device.</p>
          <civitai-button size="sm" variant="light" ?disabled=${!this.canExport} @click=${() => emit(this, 'cvt-export')}>Save this chat as a file</civitai-button>
        </section>
        <section>
          <h3>Account</h3>
          <p>Signed in${this.userName ? ` as ${this.userName}` : ''}.</p>
          ${this.canSignOut
            ? html`<civitai-button size="sm" variant="subtle" color="error" @click=${() => emit(this, 'cvt-sign-out')}>Sign out</civitai-button>`
            : nothing}
        </section>
      </div>
    </civitai-modal>`;
  }
}
