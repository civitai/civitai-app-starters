import { injectTokens } from '@civitai/theme';

import { HTMLElementBase } from './html-element.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-button-group';
const STYLE_MARKER = 'data-civitai-button-group';

/**
 * Light DOM because joining buttons means reaching their `::part(button)`, and
 * a part crosses exactly one boundary — from the document, never from a shadow
 * root the buttons were slotted into.
 */
const STYLES = `
${TAG} {
  display: inline-flex;
  vertical-align: middle;
  font-family: var(--civitai-font);
}
${TAG}[vertical] {
  flex-direction: column;
}
${TAG} > * {
  flex: 0 0 auto;
}
${TAG} > civitai-button::part(button) {
  border-radius: 0;
}
${TAG}:not([vertical]) > :first-child::part(button) {
  border-start-start-radius: var(--civitai-radius);
  border-end-start-radius: var(--civitai-radius);
}
${TAG}:not([vertical]) > :last-child::part(button) {
  border-start-end-radius: var(--civitai-radius);
  border-end-end-radius: var(--civitai-radius);
}
${TAG}[vertical] > :first-child::part(button) {
  border-start-start-radius: var(--civitai-radius);
  border-start-end-radius: var(--civitai-radius);
}
${TAG}[vertical] > :last-child::part(button) {
  border-end-start-radius: var(--civitai-radius);
  border-end-end-radius: var(--civitai-radius);
}
/* One hairline between neighbours rather than two butted together. */
${TAG}:not([vertical]) > * + civitai-button::part(button) {
  margin-inline-start: -1px;
}
${TAG}[vertical] > * + civitai-button::part(button) {
  margin-block-start: -1px;
}
${TAG} > civitai-button:hover::part(button),
${TAG} > civitai-button:focus-within::part(button) {
  position: relative;
  z-index: 1;
}
`;

function injectGroupStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export class CivitaiButtonGroup extends HTMLElementBase {
  connectedCallback(): void {
    injectTokens(this.ownerDocument);
    injectGroupStyles(this.ownerDocument);
    if (!this.hasAttribute('role')) this.setAttribute('role', 'group');
  }
}

export function defineCivitaiButtonGroup(): void {
  defineElement(TAG, CivitaiButtonGroup);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-button-group': CivitaiButtonGroup;
  }
}
