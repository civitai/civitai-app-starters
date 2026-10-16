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
  };

  declare userName: string;
  /** Only a greeting: no examples of making things, no word of Buzz. For a chat on a host's own backend. */
  declare plain: boolean;
  /** The page's own examples in place of {@link EXAMPLES}; an empty list shows none. */
  declare examples?: readonly Example[];

  constructor() {
    super();
    this.userName = '';
    this.plain = false;
  }

  override render(): TemplateResult {
    // Inside <civitai-chat>'s shadow root, so the page embedding the chat can fill this slot.
    if (this.plain) {
      return html`<slot name="welcome"><div class="cvt-welcome-inner">
        <h1>${this.userName ? `Hi ${this.userName}, how can I help?` : 'How can I help?'}</h1>
        <p>Ask in your own words.</p>
      </div></slot>`;
    }
    const examples = this.examples ?? EXAMPLES;
    return html`<slot name="welcome"><div class="cvt-welcome-inner">
      <h1>${this.userName ? `Hi ${this.userName}, what shall we make?` : 'What shall we make?'}</h1>
      <p>Describe what you want in your own words. Add your own photos, videos or audio with the + button, or drop them here.</p>
      ${examples.length
        ? html`<div class="cvt-examples">
            ${examples.map(
              (example) => html`<button class="cvt-example" type="button" @click=${() => emit(this, 'cvt-example', example)}>
                <strong>${example.title}</strong>
                <span>${example.prompt}</span>
              </button>`,
            )}
          </div>`
        : nothing}
      <p class="cvt-fineprint">Making things spends Buzz from your Civitai account; you'll see the price first. Chats are kept for ${RETENTION_DAYS} days.</p>
    </div></slot>`;
  }
}
