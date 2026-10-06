import { html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { RETENTION_DAYS } from '../config.js';
import { LightElement, emit } from './light.js';

export interface Example {
  title: string;
  prompt: string;
  wantsFile?: boolean;
}

export const EXAMPLES: Example[] = [
  { title: 'Make a picture', prompt: 'Paint a cozy cabin in a snowy forest at night, warm light in the windows' },
  { title: 'Change my photo', prompt: 'Turn my photo into a soft watercolor painting', wantsFile: true },
  { title: 'Make a short video', prompt: 'Make a short video of a paper boat sailing down a rainy street' },
  { title: 'Write a song', prompt: 'Write a short, upbeat jingle about morning coffee' },
  { title: 'Find a model', prompt: "What's a good Civitai model for anime portraits?" },
  { title: 'Say it out loud', prompt: 'Read "Welcome to Civitai Chat!" in a warm, friendly voice' },
];

export class CivitaiChatWelcome extends LightElement {
  static override properties: PropertyDeclarations = {
    userName: {},
  };

  declare userName: string;

  constructor() {
    super();
    this.userName = '';
  }

  override render(): TemplateResult {
    // Inside <civitai-chat>'s shadow root, so the page embedding the chat can fill this slot.
    return html`<slot name="welcome"><div class="cvt-welcome-inner">
      <h1>${this.userName ? `Hi ${this.userName}, what shall we make?` : 'What shall we make?'}</h1>
      <p>Describe what you want in your own words. Add your own photos, videos or audio with the + button, or drop them here.</p>
      <div class="cvt-examples">
        ${EXAMPLES.map(
          (example) => html`<button class="cvt-example" type="button" @click=${() => emit(this, 'cvt-example', example)}>
            <strong>${example.title}</strong>
            <span>${example.prompt}</span>
          </button>`,
        )}
      </div>
      <p class="cvt-fineprint">Making things spends Buzz from your Civitai account; you'll see the price first. Chats are kept for ${RETENTION_DAYS} days.</p>
    </div></slot>`;
  }
}
