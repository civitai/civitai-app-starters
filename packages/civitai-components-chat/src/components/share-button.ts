import { html, type TemplateResult } from 'lit';

import type { Panel } from '../panels/panel.js';
import { emit } from './light.js';

const COPIED_MS = 2000;

/**
 * Share for a panel: emits `panel-share`, and the chat answers on the event with whether the link
 * reached the clipboard, so the button can say so.
 */
export class ShareState {
  copied = false;
  #timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly changed: () => void) {}

  button(host: HTMLElement, panel: Panel, className = ''): TemplateResult {
    return html`<civitai-button class=${className} size="sm" variant="subtle" @click=${() => void this.#share(host, panel)}>${this.copied ? 'Link copied ✓' : 'Share'}</civitai-button>`;
  }

  async #share(host: HTMLElement, panel: Panel): Promise<void> {
    const detail: { panel: Panel; copied?: Promise<boolean> } = { panel };
    emit(host, 'panel-share', detail);
    if (!(await detail.copied)) return;
    this.copied = true;
    this.changed();
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.copied = false;
      this.changed();
    }, COPIED_MS);
  }
}
