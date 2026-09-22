import { injectTokens } from '@civitai/theme';

import { HTMLElementBase } from './html-element.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-table';
const STYLE_MARKER = 'data-civitai-table';

/**
 * Light DOM on purpose: a slotted `<tr>` inside a shadow `<table>` leaves the
 * table formatting context, so the rows would stop being rows. This styles a
 * table the page already owns — including one a data grid generated.
 */
const STYLES = `
${TAG} {
  display: block;
  overflow-x: auto;
  font-family: var(--civitai-font);
  color: var(--civitai-color-text);
}
${TAG} table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
${TAG} caption {
  padding: 8px 12px;
  text-align: start;
  color: var(--civitai-color-text-dimmed);
  font-size: 12px;
}
${TAG} th,
${TAG} td {
  padding: 8px 12px;
  text-align: start;
  vertical-align: middle;
  border-block-end: 1px solid var(--civitai-color-border);
}
${TAG} thead th {
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--civitai-color-text-dimmed);
  background: var(--civitai-color-surface-2);
  white-space: nowrap;
}
/* A sortable grid puts a button in the header, and a button inherits neither
   font nor colour — so the header treatment would stop at it. */
${TAG} thead th button {
  font: inherit;
  color: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
}
${TAG} tbody tr:last-child th,
${TAG} tbody tr:last-child td {
  border-block-end: 0;
}
${TAG}[hoverable] tbody tr:hover {
  background: color-mix(in srgb, var(--civitai-color-text) 6%, transparent);
}
${TAG}[striped] tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--civitai-color-text) 3%, transparent);
}
${TAG}[dense] th,
${TAG}[dense] td {
  padding: 4px 8px;
}
${TAG}[with-border] table {
  border: 1px solid var(--civitai-color-border);
  border-radius: var(--civitai-radius);
  overflow: hidden;
}
/* A sticky header needs the scroll container to bound it, which is this host. */
${TAG}[sticky-header] thead th {
  position: sticky;
  top: 0;
  z-index: 1;
}
${TAG} td[data-numeric],
${TAG} th[data-numeric] {
  text-align: end;
  font-variant-numeric: tabular-nums;
}
`;

function injectTableStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export class CivitaiTable extends HTMLElementBase {
  connectedCallback(): void {
    injectTokens(this.ownerDocument);
    injectTableStyles(this.ownerDocument);
  }
}

export function defineCivitaiTable(): void {
  defineElement(TAG, CivitaiTable);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-table': CivitaiTable;
  }
}
