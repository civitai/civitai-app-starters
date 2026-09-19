import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement, deepActiveElement } from './base.js';
import type { CivitaiMenuItem } from './civitai-menu-item.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-menu';

export type MenuPlacement = 'bottom-start' | 'bottom-end';

const GAP = 6;

export class CivitaiMenu extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: inline-flex;
      }
      /* The top layer is what lets a menu escape an ancestor's clipping — a tag
         pill hides its own overflow for the confidence bar, and would clip this. */
      .panel {
        position: fixed;
        margin: 0;
        padding: 4px 0;
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius);
        background: var(--civitai-color-surface);
        color: var(--civitai-color-text);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.28);
        min-width: 180px;
        max-height: 70vh;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .panel:not(:popover-open) {
        display: none;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    open: { type: Boolean, reflect: true },
    placement: { reflect: true },
    label: { reflect: true },
  };

  declare open: boolean;
  declare placement: MenuPlacement;
  /** Names the menu for a screen reader, e.g. "Image actions". */
  declare label: string;

  constructor() {
    super();
    this.open = false;
    this.placement = 'bottom-start';
    this.label = '';
  }

  get #panel(): HTMLElement | null {
    return this.shadowRoot?.querySelector('.panel') ?? null;
  }

  get #trigger(): HTMLElement | null {
    const slot = this.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="trigger"]');
    return (slot?.assignedElements({ flatten: true })[0] as HTMLElement | undefined) ?? null;
  }

  get #items(): CivitaiMenuItem[] {
    const slot = this.shadowRoot?.querySelector<HTMLSlotElement>('.panel slot:not([name])');
    return (slot?.assignedElements({ flatten: true }) ?? []).filter(
      (el): el is CivitaiMenuItem => el.getAttribute('role') === 'menuitem'
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keydown', this.#onKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.#onKeydown);
    window.removeEventListener('resize', this.#position);
    window.removeEventListener('scroll', this.#position, true);
  }

  override updated(changed: Map<string, unknown>): void {
    const panel = this.#panel;
    const trigger = this.#trigger;
    trigger?.setAttribute('aria-haspopup', 'menu');
    trigger?.setAttribute('aria-expanded', this.open ? 'true' : 'false');
    if (!panel || !changed.has('open')) return;

    if (this.open && !panel.matches(':popover-open')) panel.showPopover();
    else if (!this.open && panel.matches(':popover-open')) panel.hidePopover();
    if (this.open) this.#position();
  }

  /** Opens the menu and puts focus on the first item, as a menu button does. */
  show(): void {
    if (this.open) return;
    this.open = true;
    void this.updateComplete.then(() => this.#focusItem(0));
  }

  hide(options: { restoreFocus?: boolean } = {}): void {
    if (!this.open) return;
    this.open = false;
    if (options.restoreFocus !== false) this.#trigger?.focus();
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  readonly #position = (): void => {
    const panel = this.#panel;
    const trigger = this.#trigger ?? this;
    if (!panel) return;

    const anchor = trigger.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom - GAP;
    // Flip above only when there is genuinely more room there, so a menu near
    // the fold does not open off-screen.
    const flip = below < box.height && anchor.top - GAP > below;
    const top = flip ? Math.max(GAP, anchor.top - GAP - box.height) : anchor.bottom + GAP;

    const wanted = this.placement === 'bottom-end' ? anchor.right - box.width : anchor.left;
    const left = Math.min(Math.max(GAP, wanted), window.innerWidth - box.width - GAP);

    panel.style.top = `${top}px`;
    panel.style.left = `${Math.max(GAP, left)}px`;
  };

  #focusItem(index: number): void {
    const items = this.#items;
    if (items.length === 0) return;
    const wrapped = ((index % items.length) + items.length) % items.length;
    items[wrapped]!.focus();
  }

  #focusOffset(step: number): void {
    const items = this.#items;
    const active = deepActiveElement();
    const current = items.findIndex((item) => item === active);
    this.#focusItem(current === -1 ? (step > 0 ? 0 : items.length - 1) : current + step);
  }

  readonly #onKeydown = (event: KeyboardEvent): void => {
    if (!this.open) {
      if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target !== this.#trigger) return;
      event.preventDefault();
      this.show();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#focusOffset(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.#focusOffset(-1);
        break;
      case 'Home':
        event.preventDefault();
        this.#focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        this.#focusItem(this.#items.length - 1);
        break;
      case 'Tab':
        this.hide({ restoreFocus: false });
        break;
      default:
    }
  };

  override render(): TemplateResult {
    return html`
      <slot name="trigger" @click=${() => this.toggle()}></slot>
      <div
        class="panel"
        part="panel"
        popover="auto"
        role="menu"
        aria-label=${this.label || 'Menu'}
        @toggle=${(event: ToggleEvent) => {
          // Light dismiss and Escape close the popover without going through
          // `hide()`, so the property has to follow the element, not lead it.
          const nowOpen = event.newState === 'open';
          if (nowOpen === this.open) return;
          this.open = nowOpen;
          if (!nowOpen) this.#trigger?.focus();
        }}
        @click=${(event: Event) => {
          const item = event.composedPath().find(
            (node) => node instanceof HTMLElement && node.getAttribute('role') === 'menuitem'
          ) as CivitaiMenuItem | undefined;
          if (!item || item.disabled) return;
          this.dispatchEvent(
            new CustomEvent('select', { detail: { item }, bubbles: true, composed: true })
          );
          this.hide();
        }}
      >
        <slot></slot>
      </div>
    `;
  }
}

export function defineCivitaiMenu(): void {
  defineElement(TAG, CivitaiMenu);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-menu': CivitaiMenu;
  }
}
