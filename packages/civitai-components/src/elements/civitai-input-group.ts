import { injectTokens } from '@civitai/theme';

import { HTMLElementBase } from './html-element.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-input-group';
const STYLE_MARKER = 'data-civitai-input-group';

/** Light DOM for the same reason the button group is: `::part` from the page. */
const STYLES = `
${TAG} {
  display: flex;
  align-items: stretch;
  font-family: var(--civitai-font);
}
${TAG} > civitai-text-input,
${TAG} > civitai-number-input,
${TAG} > civitai-select {
  flex: 1 1 auto;
  min-width: 0;
}
${TAG} > * {
  flex: 0 0 auto;
}
${TAG} > *::part(control),
${TAG} > *::part(button) {
  border-radius: 0;
}
${TAG} > :first-child::part(control),
${TAG} > :first-child::part(button) {
  border-start-start-radius: var(--civitai-radius);
  border-end-start-radius: var(--civitai-radius);
}
${TAG} > :last-child::part(control),
${TAG} > :last-child::part(button) {
  border-start-end-radius: var(--civitai-radius);
  border-end-end-radius: var(--civitai-radius);
}
${TAG} > * + *::part(control),
${TAG} > * + *::part(button) {
  margin-inline-start: -1px;
}
${TAG} > *:focus-within::part(control) {
  position: relative;
  z-index: 1;
}
/* A plain string or element between the controls reads as an affix. */
${TAG} > .affix,
${TAG} > [data-affix] {
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--civitai-color-border);
  background: var(--civitai-color-surface-2);
  color: var(--civitai-color-text-dimmed);
  font-size: 14px;
  white-space: nowrap;
}
`;

function injectGroupStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export class CivitaiInputGroup extends HTMLElementBase {
  connectedCallback(): void {
    injectTokens(this.ownerDocument);
    injectGroupStyles(this.ownerDocument);
  }
}

export function defineCivitaiInputGroup(): void {
  defineElement(TAG, CivitaiInputGroup);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-input-group': CivitaiInputGroup;
  }
}
