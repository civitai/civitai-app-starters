import { injectTokens } from '@civitai/theme';

import { defineElement } from './registry.js';

const TAG = 'civitai-tabs';
const PANEL_TAG = 'civitai-tab-panel';
const STYLE_MARKER = 'data-civitai-tabs';
const NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

let sequence = 0;

export interface TabItem {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Light DOM: a tab's `aria-controls` IDREF cannot reach a panel in the page
 * from inside a shadow root — the half the segmented control could not carry.
 */
const STYLES = `
${TAG} {
  display: block;
  box-sizing: border-box;
  font-family: var(--civitai-font);
}
${TAG} > [data-tablist] {
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  background: var(--civitai-color-segmented-bg, var(--civitai-color-gray-1));
  border-radius: var(--civitai-radius);
  max-width: 100%;
  overflow-x: auto;
}
${TAG} [data-tab] {
  -webkit-appearance: none;
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--civitai-color-text-dimmed);
  font-family: var(--civitai-font);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  border-radius: calc(var(--civitai-radius) - 1px);
  transition: background-color 120ms ease, color 120ms ease;
  height: 30px;
  padding: 0 14px;
  font-size: 13px;
}
${TAG}[size='sm'] [data-tab] { height: 26px; padding: 0 10px; font-size: 12px; }
${TAG}[size='lg'] [data-tab] { height: 38px; padding: 0 18px; font-size: 15px; }
${TAG} [data-tab]:hover:not(:disabled):not([aria-selected='true']) {
  color: var(--civitai-color-text);
}
${TAG} [data-tab][aria-selected='true'] {
  background: var(--civitai-color-surface);
  color: var(--civitai-color-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
${TAG} [data-tab]:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 2px;
}
${TAG} [data-tab]:disabled { opacity: 0.5; cursor: not-allowed; }
${PANEL_TAG} {
  display: block;
  color: var(--civitai-color-text);
}
${PANEL_TAG}[hidden] { display: none; }
${PANEL_TAG}:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 2px;
}
`;

function injectTabStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** A panel. Its `value` pairs it with the tab of the same value. */
export class CivitaiTabPanel extends HTMLElement {
  get value(): string {
    return this.getAttribute('value') ?? '';
  }
}

export class CivitaiTabs extends HTMLElement {
  static observedAttributes = ['value'];

  #tablist: HTMLElement | null = null;
  #data: TabItem[] = [];
  readonly #id = `ci-tabs-${(sequence += 1)}`;

  connectedCallback(): void {
    injectTokens(this.ownerDocument);
    injectTabStyles(this.ownerDocument);
    this.#render();
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  get data(): TabItem[] {
    return this.#data;
  }

  set data(value: TabItem[]) {
    this.#data = value;
    this.#render();
  }

  get value(): string {
    const declared = this.getAttribute('value') ?? '';
    if (this.#data.some((item) => item.value === declared)) return declared;
    return this.#enabled[0]?.value ?? '';
  }

  set value(next: string) {
    this.setAttribute('value', next);
  }

  get #enabled(): TabItem[] {
    return this.#data.filter((item) => !item.disabled);
  }

  get panels(): CivitaiTabPanel[] {
    return [...this.querySelectorAll<CivitaiTabPanel>(PANEL_TAG)];
  }

  #select(next: string, moveFocus: boolean): void {
    if (next !== this.value) {
      this.value = next;
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!moveFocus) return;
    this.#tablist?.querySelector<HTMLButtonElement>(`[data-tab][data-value="${next}"]`)?.focus();
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    const values = this.#enabled.map((item) => item.value);
    if (!NAV_KEYS.includes(event.key) || values.length === 0) return;
    event.preventDefault();

    const current = Math.max(0, values.indexOf(this.value));
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (current + 1) % values.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + values.length) % values.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else {
      next = values.length - 1;
    }
    this.#select(values[next]!, true);
  };

  #render(): void {
    if (!this.isConnected) return;
    if (!this.#tablist) {
      this.#tablist = this.ownerDocument.createElement('div');
      this.#tablist.setAttribute('data-tablist', '');
      this.#tablist.setAttribute('role', 'tablist');
      this.#tablist.addEventListener('keydown', this.#onKeyDown);
      this.prepend(this.#tablist);
    }
    const label = this.getAttribute('aria-label');
    if (label !== null) this.#tablist.setAttribute('aria-label', label);

    const selected = this.value;
    this.#tablist.replaceChildren(
      ...this.#data.map((item) => {
        const tab = this.ownerDocument.createElement('button');
        tab.type = 'button';
        tab.id = `${this.#id}-tab-${item.value}`;
        tab.dataset.value = item.value;
        tab.setAttribute('data-tab', '');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(item.value === selected));
        tab.tabIndex = item.value === selected ? 0 : -1;
        tab.disabled = item.disabled ?? false;
        tab.textContent = item.label;
        tab.addEventListener('click', () => this.#select(item.value, false));
        return tab;
      })
    );

    for (const panel of this.panels) {
      const tabId = `${this.#id}-tab-${panel.value}`;
      const isSelected = panel.value === selected;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tabId);
      panel.tabIndex = 0;
      panel.hidden = !isSelected;
      this.#tablist.querySelector(`#${CSS.escape(tabId)}`)?.setAttribute('aria-controls', panel.id || (panel.id = `${this.#id}-panel-${panel.value}`));
    }
  }
}

export function defineCivitaiTabs(): void {
  defineElement(PANEL_TAG, CivitaiTabPanel);
  defineElement(TAG, CivitaiTabs);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-tabs': CivitaiTabs;
    'civitai-tab-panel': CivitaiTabPanel;
  }
}
