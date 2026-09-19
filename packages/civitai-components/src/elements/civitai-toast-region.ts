import { injectTokens } from '@civitai/theme';

import { defineElement } from './registry.js';

import type { Intent } from './civitai-badge.js';
import type { CivitaiToast } from './civitai-toast.js';

const TAG = 'civitai-toast-region';
const STYLE_MARKER = 'data-civitai-toast-region';

let sequence = 0;

export interface ToastOptions {
  message: string;
  heading?: string;
  color?: Intent;
  /** Milliseconds. `0` or less makes it sticky. */
  duration?: number;
  /** Announce assertively rather than politely. */
  urgent?: boolean;
}

/**
 * Light DOM: an `aria-live` region announces nodes ADDED TO ITSELF, so the
 * toasts have to be its own children rather than shadow content it renders.
 */
const STYLES = `
${TAG} {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(92vw, 380px);
  pointer-events: none;
  box-sizing: border-box;
}
`;

function injectRegionStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, 'true');
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export class CivitaiToastRegion extends HTMLElement {
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  connectedCallback(): void {
    injectTokens(this.ownerDocument);
    injectRegionStyles(this.ownerDocument);
    if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
    if (!this.hasAttribute('aria-live')) this.setAttribute('aria-live', 'polite');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', this.label);
  }

  disconnectedCallback(): void {
    // Timers outlive the element otherwise, and each one holds a toast.
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  get label(): string {
    return this.getAttribute('label') ?? 'Notifications';
  }

  get defaultDuration(): number {
    const declared = Number(this.getAttribute('default-duration'));
    return Number.isFinite(declared) && this.hasAttribute('default-duration') ? declared : 5000;
  }

  get toasts(): CivitaiToast[] {
    return [...this.querySelectorAll<CivitaiToast>('civitai-toast')];
  }

  /** Enqueues a toast and returns its id. */
  show(options: ToastOptions): string {
    const id = `ci-toast-${(sequence += 1)}`;
    const toast = this.ownerDocument.createElement('civitai-toast');
    toast.id = id;
    toast.textContent = options.message;
    if (options.heading !== undefined) toast.setAttribute('heading', options.heading);
    if (options.color !== undefined) toast.setAttribute('color', options.color);
    if (options.urgent === true) toast.setAttribute('urgent', '');
    toast.setAttribute('closable', '');
    toast.addEventListener('close', () => this.dismiss(id));
    this.append(toast);

    const duration = options.duration ?? this.defaultDuration;
    if (duration > 0) {
      this.#timers.set(
        id,
        setTimeout(() => this.dismiss(id), duration)
      );
    }
    return id;
  }

  dismiss(id: string): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
    this.querySelector(`#${CSS.escape(id)}`)?.remove();
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    for (const toast of this.toasts) toast.remove();
  }
}

export function defineCivitaiToastRegion(): void {
  defineElement(TAG, CivitaiToastRegion);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-toast-region': CivitaiToastRegion;
  }
}
