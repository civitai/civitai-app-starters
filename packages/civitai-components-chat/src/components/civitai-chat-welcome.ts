import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

import { RETENTION_DAYS } from '../config.js';
import { LightElement, emit } from './light.js';

/** A starting point an empty chat offers: clicking it puts `prompt` in the message box. */
export interface Example {
  title: string;
  prompt: string;
  /** Also opens the file picker, for a prompt about the viewer's own photo or video. */
  wantsFile?: boolean;
}

/** What an empty chat offers when its page sets no `examples`. */
export const EXAMPLES: Example[] = [
  { title: 'Make a picture', prompt: 'Paint a cozy cabin in a snowy forest at night, warm light in the windows' },
  { title: 'Change my photo', prompt: 'Turn my photo into a soft watercolor painting', wantsFile: true },
  { title: 'Make a short video', prompt: 'Make a short video of a paper boat sailing down a rainy street' },
  { title: 'Write a song', prompt: 'Write a short, upbeat jingle about morning coffee' },
  { title: 'Find a model', prompt: "What's a good Civitai model for anime portraits?" },
  { title: 'Say it out loud', prompt: 'Read "Welcome aboard!" in a warm, friendly voice' },
];

/**
 * Who pays when replies run in the page (`freeTierFetch`): a model with a free allowance uses it, then
 * the chat balance; any other model, and whatever is made, the Civitai account. No price: it is the model's.
 */
export const BALANCE_BILLED = 'Replies and anything you make spend Buzz from your Civitai account, or from your free allowance and chat balance on models that have one.';
/** Who pays on a server runner: the Civitai account, once any free allowance is used up; never the chat balance. */
export const ACCOUNT_BILLED = 'Replies spend Buzz from your Civitai account once any free allowance is used up, about 1 per step, up to a daily limit. Making things costs extra.';

/** As the thread's: this close to the end counts as at the end. */
const NEAR_END_PX = 48;

export class CivitaiChatWelcome extends LightElement {
  static override properties: PropertyDeclarations = {
    userName: {},
    plain: { type: Boolean },
    accountBilled: { type: Boolean, attribute: 'account-billed' },
    examples: { attribute: false },
    threadEnd: { type: Boolean, attribute: 'thread-end' },
  };

  declare userName: string;
  /**
   * Only a greeting: none of the built-in examples of making things, no word of Buzz. For a chat on a
   * host's own backend. The page's own `examples` still show.
   */
  declare plain: boolean;
  /**
   * The replies run on a server runner, which bills each step to the viewer's Civitai account rather
   * than the chat balance: the fine print says so.
   */
  declare accountBilled: boolean;
  /** The page's own examples in place of {@link EXAMPLES}; an empty list shows none. */
  declare examples?: readonly Example[];
  /**
   * Shows the page's `thread-end` slot under the greeting, in the greeting's own scroll, as a chat
   * with messages shows it after the last one.
   */
  declare threadEnd: boolean;

  constructor() {
    super();
    this.userName = '';
    this.plain = false;
    this.accountBilled = false;
    this.threadEnd = false;
  }

  // The greeting is its own scroll. Content in thread-end that grows while the viewer is at the end
  // is followed, as the thread follows it once there are messages.
  #atEnd = true;
  #endSlot?: HTMLSlotElement;
  // Only for content the page put there: the empty slot's own first size report must not scroll.
  #resize = new ResizeObserver(() => {
    if (this.#atEnd && this.#endSlot?.assignedElements({ flatten: true }).length) this.scrollTop = this.scrollHeight;
  });
  #onScroll = (): void => {
    this.#atEnd = this.scrollHeight - this.scrollTop - this.clientHeight < NEAR_END_PX;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('scroll', this.#onScroll);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('scroll', this.#onScroll);
    this.#resize.disconnect();
    this.#endSlot = undefined;
  }

  protected override updated(): void {
    const slot = this.querySelector<HTMLSlotElement>('slot[name="thread-end"]') ?? undefined;
    if (slot === this.#endSlot) return;
    if (this.#endSlot) this.#resize.unobserve(this.#endSlot);
    this.#endSlot = slot;
    if (slot) this.#resize.observe(slot);
  }

  #end(): TemplateResult | typeof nothing {
    return this.threadEnd
      ? html`<slot name="thread-end" class="cvt-thread-end" @slotchange=${this.#onEndChange}></slot>`
      : nothing;
  }

  // Brought into view as it is after the last message.
  #onEndChange = (event: Event): void => {
    if ((event.target as HTMLSlotElement).assignedElements({ flatten: true }).length) this.scrollTop = this.scrollHeight;
  };

  #examples(examples: readonly Example[]): TemplateResult | typeof nothing {
    return examples.length
      ? html`<div class="cvt-examples">
          ${examples.map(
            (example) => html`<button class="cvt-example" type="button" @click=${() => emit(this, 'cvt-example', example)}>
              <strong>${example.title}</strong>
              <span>${example.prompt}</span>
            </button>`,
          )}
        </div>`
      : nothing;
  }

  override render(): TemplateResult {
    // Inside <civitai-chat>'s shadow root, so the page embedding the chat can fill this slot.
    if (this.plain) {
      // The built-in examples are about making things on Civitai, so a plain greeting shows only the page's.
      return html`<slot name="welcome"><div class="cvt-welcome-inner">
        <h1>${this.userName ? `Hi ${this.userName}, how can I help?` : 'How can I help?'}</h1>
        <p>Ask in your own words.</p>
        ${this.#examples(this.examples ?? [])}
      </div></slot>${this.#end()}`;
    }
    return html`<slot name="welcome"><div class="cvt-welcome-inner">
      <h1>${this.userName ? `Hi ${this.userName}, what shall we make?` : 'What shall we make?'}</h1>
      <p>Describe what you want in your own words. Add your own photos, videos or audio with the + button, or drop them here.</p>
      ${this.#examples(this.examples ?? EXAMPLES)}
      <p class="cvt-fineprint">${this.accountBilled ? ACCOUNT_BILLED : BALANCE_BILLED} Chats are kept for ${RETENTION_DAYS} days.</p>
    </div></slot>${this.#end()}`;
  }
}
