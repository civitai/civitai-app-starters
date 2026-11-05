import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

import type { Gap } from './civitai-stack.js';

const TAG = 'civitai-group';

export class CivitaiGroup extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      :host([nowrap]) {
        flex-wrap: nowrap;
      }
      :host([gap='sm']) {
        gap: 6px;
      }
      :host([gap='md']) {
        gap: 16px;
      }
      :host([gap='lg']) {
        gap: 24px;
      }
      /* A flex item refuses to shrink below its content width, so one long
         label pushes the row past its slot even with wrap.

         Zeroing the floor is right for anything that HAS content to shrink.
         It is wrong for a child with NO intrinsic width -- an aspect-ratio box
         such as civitai-media-card -- which then resolves to 0x0 and vanishes
         outright, so a gallery of tiles in a group rendered as nothing at all.
         Such a child cannot fix this from its own :host rule: for a SLOTTED
         element the outer tree's declaration wins over the inner tree's
         regardless of specificity, so this rule always beat it.

         Hence the knob rather than a flat 0. A child raises its own floor by
         setting --civitai-group-item-min-width on itself; the var() resolves
         against that child's computed value. The 0 fallback is byte-for-byte
         the previous behaviour for every child that does not set it. */
      ::slotted(*) {
        min-width: var(--civitai-group-item-min-width, 0);
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    gap: { reflect: true },
    nowrap: { type: Boolean, reflect: true },
  };

  declare gap: Gap | '';
  declare nowrap: boolean;

  constructor() {
    super();
    this.gap = '';
    this.nowrap = false;
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

export function defineCivitaiGroup(): void {
  defineElement(TAG, CivitaiGroup);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-group': CivitaiGroup;
  }
}
