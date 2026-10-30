import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { AUTO_RUN_STEPS, CUSTOM_INSTRUCTIONS_MAX, chatConfig, OUTPUT_TOKENS_MAX, OUTPUT_TOKENS_MIN, RETENTION_DAYS, outputTokenCap } from '../config.js';
import type { Settings } from '../types.js';
import { balanceDetails, type BalanceView } from './civitai-chat-balance.js';
import { LightElement, emit } from './light.js';

/** "Never ask" is stored as a number JSON can hold. */
export const NEVER_ASK = 1_000_000;

const LIMITS = [
  { value: '0', label: 'Always ask' },
  ...AUTO_RUN_STEPS.map((limit) => ({ value: String(limit), label: `${limit} Buzz` })),
  { value: String(NEVER_ASK), label: 'Never ask' },
];

export class CivitaiChatSettingsDialog extends LightElement {
  static override properties: PropertyDeclarations = {
    open: { type: Boolean },
    settings: { attribute: false },
    userName: {},
    canExport: { type: Boolean },
    canDeleteAll: { type: Boolean },
    balance: { attribute: false },
    canSignOut: { type: Boolean },
    canTheme: { type: Boolean },
    hosted: { type: Boolean },
  };

  declare open: boolean;
  declare settings: Settings;
  declare userName: string;
  declare canExport: boolean;
  declare canDeleteAll: boolean;
  /** Free replies and the chat balance; none where replies are not Civitai's to bill. */
  declare balance?: BalanceView;
  /** Inside civitai.com the site owns the session. */
  declare canSignOut: boolean;
  /** Only when the chat is the whole page; embedded, the page around it sets the theme. */
  declare canTheme: boolean;
  /**
   * The chat runs on its host's own backend: no Buzz limit, mature
   * switch or Civitai account here, and chats are kept by the host.
   */
  declare hosted: boolean;

  constructor() {
    super();
    this.open = false;
    this.userName = '';
    this.canExport = false;
    this.canDeleteAll = false;
    this.canSignOut = true;
    this.canTheme = true;
    this.hosted = false;
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

  #outputTokens(): TemplateResult {
    return html`<civitai-number-input
      label="Longest reply step"
      description=${`The most tokens the assistant may write in one step, its thinking and any file it writes included: ${OUTPUT_TOKENS_MIN.toLocaleString('en-US')} to ${OUTPUT_TOKENS_MAX.toLocaleString('en-US')}. Raise it if replies stop short or files come out cut off.`}
      min=${OUTPUT_TOKENS_MIN}
      max=${OUTPUT_TOKENS_MAX}
      step="1024"
      .value=${live(String(outputTokenCap(this.settings.maxOutputTokens)))}
      @change=${(event: Event) => {
        const typed = (event.target as HTMLInputElement).value.trim();
        // Cleared, it goes back to the page's default; anything else is kept within the range.
        this.#change({ maxOutputTokens: typed === '' || !Number.isFinite(Number(typed)) ? undefined : outputTokenCap(Number(typed)) });
        this.requestUpdate();
      }}
    ></civitai-number-input>`;
  }

  #instructions(): TemplateResult {
    return html`<civitai-textarea
      label="Custom instructions"
      description="Sent with every message. Tell the assistant about you, your style, or how you like answers."
      placeholder="For example: I make fantasy book covers. Keep answers short and suggest a bold color palette."
      rows="4"
      maxlength=${CUSTOM_INSTRUCTIONS_MAX}
      .value=${this.settings.customInstructions ?? ''}
      @input=${(event: Event) => this.#change({ customInstructions: (event.currentTarget as HTMLTextAreaElement).value || undefined })}
    ></civitai-textarea>`;
  }

  #hosted(): TemplateResult {
    return html`<civitai-modal .open=${this.open} heading="Settings" with-close-button @close=${() => emit(this, 'cvt-close-settings')}>
      <div class="cvt-settings">
        ${this.canTheme ? this.#theme() : nothing}
        ${this.#outputTokens()}
        ${this.#instructions()}
        <section>
          <h3>Your chats</h3>
          <div class="cvt-settings-actions">
            <civitai-button size="sm" variant="light" ?disabled=${!this.canExport} @click=${() => emit(this, 'cvt-export')}>Save this chat as a file</civitai-button>
            ${this.canDeleteAll ? html`<civitai-button size="sm" variant="subtle" color="error" @click=${() => emit(this, 'cvt-delete-all')}>Delete all chats</civitai-button>` : nothing}
          </div>
        </section>
      </div>
    </civitai-modal>`;
  }

  override render(): TemplateResult {
    if (this.hosted) return this.#hosted();
    const limit = LIMITS.some((option) => Number(option.value) === this.settings.autoRunLimit) ? String(this.settings.autoRunLimit) : '0';
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
        ${this.#outputTokens()}
        ${this.#instructions()}
        ${this.balance ? html`<section class="cvt-balance-panel"><h3>Replies</h3>${balanceDetails(this.balance, this)}</section>` : nothing}
        ${chatConfig.modelsOnly
          ? nothing
          : html`<civitai-switch
              label="Premium models"
              description="Pick another model for a chat, such as Claude or GPT. Their replies cost Buzz at the model's own price, shown as an estimate."
              .checked=${this.settings.premiumModels === true}
              @change=${(event: Event) => this.#change({ premiumModels: (event.target as HTMLInputElement).checked })}
            ></civitai-switch>`}
        <civitai-switch
          label="Show mature content"
          .checked=${this.settings.allowMature}
          @change=${(event: Event) => this.#change({ allowMature: (event.target as HTMLInputElement).checked })}
        ></civitai-switch>
        <section>
          <h3>Your chats</h3>
          <p>Chats are kept in your Civitai account for ${RETENTION_DAYS} days after your last message, and what you make for ${RETENTION_DAYS} days after it is made, so they follow you to any device.</p>
          <div class="cvt-settings-actions">
            <civitai-button size="sm" variant="light" ?disabled=${!this.canExport} @click=${() => emit(this, 'cvt-export')}>Save this chat as a file</civitai-button>
            ${this.canDeleteAll ? html`<civitai-button size="sm" variant="subtle" color="error" @click=${() => emit(this, 'cvt-delete-all')}>Delete all chats</civitai-button>` : nothing}
          </div>
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
