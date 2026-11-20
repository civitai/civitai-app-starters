import { css } from 'lit';

import { choiceStyles } from './choice-styles.js';
import { CivitaiCheckbox } from './civitai-checkbox.js';
import { fieldStyles } from './field-base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-switch';

/**
 * The checkbox wearing a track and a thumb. It stays a real
 * `<input type="checkbox">` because `role="switch"` is defined on one, and a
 * div pretending to be a control would lose the form and the keyboard.
 */
export class CivitaiSwitch extends CivitaiCheckbox {
  static override styles = [
    hostBaseline,
    fieldStyles,
    choiceStyles,
    css`
      input {
        -webkit-appearance: none;
        appearance: none;
        position: relative;
        width: 36px;
        height: 20px;
        border-radius: 999px;
        background: var(--civitai-color-surface-2);
        border: 1px solid var(--civitai-color-border);
        transition: background-color 140ms ease, border-color 140ms ease;
      }
      input::after {
        content: '';
        position: absolute;
        top: 2px;
        inset-inline-start: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--civitai-color-text-dimmed);
        /* Animated with translate rather than the inline start, so the thumb
           moves correctly in both writing directions. */
        transition: translate 140ms ease, background-color 140ms ease;
      }
      input:checked {
        background: var(--civitai-color-primary);
        border-color: var(--civitai-color-primary);
      }
      input:checked::after {
        translate: 16px 0;
        background: var(--civitai-color-primary-fg);
      }
      :host([dir='rtl']) input:checked::after,
      :dir(rtl) input:checked::after {
        translate: -16px 0;
      }
    `,
  ];

  protected override get inputRole(): string {
    return 'switch';
  }
}

export function defineCivitaiSwitch(): void {
  defineElement(TAG, CivitaiSwitch);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-switch': CivitaiSwitch;
  }
}
