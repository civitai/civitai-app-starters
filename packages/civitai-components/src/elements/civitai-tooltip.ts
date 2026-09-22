import { injectTokens } from '@civitai/theme';

import { HTMLElementBase } from './html-element.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-tooltip';
const STYLE_MARKER = 'data-civitai-tooltip';

let sequence = 0;

/**
 * Light DOM, deliberately: an IDREF cannot cross a shadow boundary, so a bubble
 * in a shadow root could never describe a trigger the author slotted in.
 */
const STYLES = `
${TAG} {
  position: relative;
  display: inline-flex;
  box-sizing: border-box;
  font-family: var(--civitai-font);
}
${TAG} > [data-tooltip-bubble] {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  max-width: 260px;
  width: max-content;
  padding: 4px 8px;
  border-radius: var(--civitai-radius);
  background: var(--civitai-color-gray-9);
  color: var(--civitai-color-primary-fg);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  text-align: center;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease;
}
${TAG}:hover > [data-tooltip-bubble]:not([data-dismissed]),
${TAG}:focus-within > [data-tooltip-bubble]:not([data-dismissed]),
${TAG}[open] > [data-tooltip-bubble]:not([data-dismissed]) {
  opacity: 1;
  visibility: visible;
}
`;

function injectTooltipStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export class CivitaiTooltip extends HTMLElementBase {
  static observedAttributes = ['label'];

  #bubble: HTMLElement | null = null;
  readonly #id = `ci-tooltip-${(sequence += 1)}`;

  connectedCallback(): void {
    injectTokens(this.ownerDocument);
    injectTooltipStyles(this.ownerDocument);
    this.#ensure();
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('pointerenter', this.#reveal);
    this.addEventListener('focusin', this.#reveal);
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.#onKeyDown);
    this.removeEventListener('pointerenter', this.#reveal);
    this.removeEventListener('focusin', this.#reveal);
  }

  attributeChangedCallback(): void {
    if (this.#bubble) this.#bubble.textContent = this.label;
  }

  get label(): string {
    return this.getAttribute('label') ?? '';
  }

  set label(value: string) {
    this.setAttribute('label', value);
  }

  /** Forces the bubble open; hover and focus reveal it without this. */
  get open(): boolean {
    return this.hasAttribute('open');
  }

  set open(value: boolean) {
    this.toggleAttribute('open', value);
  }

  /** The element the tooltip describes: the first element child. */
  get trigger(): HTMLElement | null {
    for (const child of this.children) {
      if (child !== this.#bubble) return child as HTMLElement;
    }
    return null;
  }

  #ensure(): void {
    if (!this.#bubble) {
      this.#bubble = this.ownerDocument.createElement('span');
      this.#bubble.id = this.#id;
      this.#bubble.setAttribute('role', 'tooltip');
      this.#bubble.setAttribute('data-tooltip-bubble', '');
    }
    this.#bubble.textContent = this.label;
    if (this.#bubble.parentNode !== this) this.append(this.#bubble);

    const trigger = this.trigger;
    if (!trigger) return;
    // Join rather than replace: the trigger may already describe something.
    const existing = (trigger.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((id) => id !== '' && id !== this.#id);
    trigger.setAttribute('aria-describedby', [...existing, this.#id].join(' '));
  }

  readonly #reveal = (): void => {
    this.#bubble?.removeAttribute('data-dismissed');
  };

  /**
   * Escape genuinely hides it, even while the pointer still hovers — the CSS
   * reveal is gated on the absence of this flag.
   */
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.#bubble?.setAttribute('data-dismissed', '');
    this.open = false;
  };
}

export function defineCivitaiTooltip(): void {
  defineElement(TAG, CivitaiTooltip);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-tooltip': CivitaiTooltip;
  }
}
