import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement, deepActiveElement } from './base.js';
import type { CivitaiMenuItem } from './civitai-menu-item.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-menu';

export type MenuPlacement = 'bottom-start' | 'bottom-end';

export interface MenuSelectDetail {
  value: string;
}

const GAP = 6;

export class CivitaiMenu extends CivitaiElement {
  /**
   * 🔴 THE PANEL'S VISIBILITY IS DECIDED BY AN ATTRIBUTE THIS ELEMENT WRITES
   * (`data-open`, bound in `render()`), NOT BY `:popover-open`.
   *
   * A non-browser DOM has no popover API, so a rule keyed on that pseudo-class
   * cannot be right there: it throws when evaluated (some `nwsapi` versions under
   * jsdom), or is permanently true and pins the panel shut (happy-dom). Either
   * way the element was un-adoptable by an App Block (#485). An attribute is true
   * in every DOM, which is also what makes open state assertable outside a real
   * browser.
   *
   * In a real browser the UA's own `[popover]:not(:popover-open)` rule still
   * applies on top of this one, and the `showPopover()` call in `updated()` is
   * what lifts it. The two agree because both follow `this.open`.
   *
   * Keep prose OUT of the stylesheet below. A comment inside the tagged template
   * survives minification and ships in `elements.js`, which has a 32 kB gzip
   * budget with little room in it — the first draft of this note cost 340 gzip
   * bytes there. A comment here is stripped; one in there is not.
   */
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
      /* data-open, not :popover-open — see the note above styles. */
      .panel:not([data-open]) {
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

  /**
   * Whether `showPopover()` has been called on the panel without a matching
   * `hidePopover()`. This is bookkeeping, NOT the element's open state — that is
   * `this.open`, and the `data-open` attribute it drives.
   *
   * It exists because light dismiss and Escape close the popover WITHOUT going
   * through `hide()`, and a redundant `hidePopover()` should then throw
   * `InvalidStateError` per spec. Measured: **chromium 153 does not throw** on a
   * redundant show, a redundant hide, or a hide of a hidden popover — so no
   * browser test in this repo can see a stale flag. The thing that can is the
   * spec-compliant shim in `@civitai/blocks-react/testing`; see
   * `packages/civitai-blocks-react/test/popoverShim.test.ts`.
   *
   * The guard it replaces read `panel.matches(':popover-open')`, which is the
   * call that threw in a non-browser DOM (#485).
   */
  #popoverRequestedOpen = false;

  get #panel(): HTMLElement | null {
    return this.shadowRoot?.querySelector('.panel') ?? null;
  }

  get #trigger(): HTMLElement | null {
    const slot = this.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="trigger"]');
    return (slot?.assignedElements({ flatten: true })[0] as HTMLElement | undefined) ?? null;
  }

  /**
   * Every slotted `[role=menuitem]`, in DOM order — including items a consumer
   * has wrapped in a container of their own.
   *
   * `assignedElements({ flatten: true })` flattens nested `<slot>`s, NOT
   * arbitrary wrappers, so a `<div data-testid="items">` around the items used
   * to make this getter return 0 of them: `show()` focused nothing and arrow-key
   * navigation had nothing to walk (#485). Descending one level is what lets the
   * items sit inside a consumer-owned container, and that container is the only
   * place a `document.querySelector`-able hook CAN live — it is light DOM. The
   * panel is in the shadow root, and `::part()` is a CSS-only mechanism, so
   * neither is reachable from a document query.
   *
   * `querySelectorAll` returns tree order, so DOM order survives the descent.
   */
  get #items(): CivitaiMenuItem[] {
    const slot = this.shadowRoot?.querySelector<HTMLSlotElement>('.panel slot:not([name])');
    return (slot?.assignedElements({ flatten: true }) ?? []).flatMap((el) =>
      el.matches('[role="menuitem"]')
        ? [el as CivitaiMenuItem]
        : [...el.querySelectorAll<CivitaiMenuItem>('[role="menuitem"]')]
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

    // The popover API is ADDITIVE here. `data-open`, bound in `render()`, is what
    // decides whether the panel is visible; these two calls buy the two things
    // the top layer buys and CSS cannot — escaping a clipping ancestor, and
    // native light dismiss. `?.()` is what lets the element run in a DOM that has
    // no popover API at all, which is every non-browser DOM (#485).
    if (this.open !== this.#popoverRequestedOpen) {
      this.#popoverRequestedOpen = this.open;
      if (this.open) panel.showPopover?.();
      else panel.hidePopover?.();
    }
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
        ?data-open=${this.open}
        role="menu"
        aria-label=${this.label || 'Menu'}
        @toggle=${(event: ToggleEvent) => {
          // Light dismiss and Escape close the popover without going through
          // `hide()`, so the property has to follow the element, not lead it.
          const nowOpen = event.newState === 'open';
          // Resync the bookkeeping FIRST and unconditionally: the browser has
          // already moved the popover, so a later `hidePopover()` on an
          // already-hidden popover would throw `InvalidStateError`. This runs on
          // our own calls too, where it is a no-op.
          this.#popoverRequestedOpen = nowOpen;
          if (nowOpen === this.open) return;
          this.open = nowOpen;
          if (!nowOpen) this.#trigger?.focus();
        }}
        @click=${(event: Event) => {
          const item = event.composedPath().find(
            (node) => node instanceof HTMLElement && node.getAttribute('role') === 'menuitem'
          ) as CivitaiMenuItem | undefined;
          if (!item || item.disabled) return;
          const detail: MenuSelectDetail = { value: item.selectedValue };
          this.dispatchEvent(
            new CustomEvent('select', { detail, bubbles: true, composed: true })
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
