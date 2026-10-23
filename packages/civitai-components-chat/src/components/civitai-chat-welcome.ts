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

export class CivitaiChatWelcome extends LightElement {
  static override properties: PropertyDeclarations = {
    userName: {},
    plain: { type: Boolean },
    examples: { attribute: false },
    threadEnd: { type: Boolean, attribute: 'thread-end' },
  };

  declare userName: string;
  /**
   * Only a greeting: none of the built-in examples of making things, no word of Buzz. For a chat on a
   * host's own backend. The page's own `examples` still show.
   */
  declare plain: boolean;
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
    this.threadEnd = false;
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
      <p class="cvt-fineprint">Making things spends Buzz from your Civitai account; you'll see the price first. Chats are kept for ${RETENTION_DAYS} days.</p>
    </div></slot>${this.#end()}`;
  }
}
