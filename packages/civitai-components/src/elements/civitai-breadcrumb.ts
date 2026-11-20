import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-breadcrumb';

export interface Crumb {
  label: string;
  href?: string;
}

export class CivitaiBreadcrumb extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
      }
      ol {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: 13px;
      }
      /* The separator belongs to the item, not to a slot: a pseudo-element is
         not announced, which is what keeps it out of the crumb trail. */
      li:not(:first-child)::before {
        content: var(--civitai-breadcrumb-separator, '/');
        margin-inline-end: 6px;
        color: var(--civitai-color-text-dimmed);
      }
      a {
        color: var(--civitai-color-text-dimmed);
        text-decoration: none;
      }
      a:hover {
        color: var(--civitai-color-text);
        text-decoration: underline;
      }
      a:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 2px;
        border-radius: 2px;
      }
      [aria-current='page'] {
        color: var(--civitai-color-text);
        font-weight: 600;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    data: { attribute: false },
    label: { reflect: true },
  };

  declare data: Crumb[];
  declare label: string;

  constructor() {
    super();
    this.data = [];
    this.label = 'Breadcrumb';
  }

  override render(): TemplateResult {
    const last = this.data.length - 1;
    return html`
      <nav part="nav" aria-label=${this.label}>
        <ol part="list">
          ${this.data.map((crumb, index) =>
            index === last || crumb.href === undefined
              ? html`<li part="crumb">
                  <span part="current" aria-current=${index === last ? 'page' : nothing}
                    >${crumb.label}</span
                  >
                </li>`
              : html`<li part="crumb">
                  <a part="link" href=${ifDefined(crumb.href)}>${crumb.label}</a>
                </li>`
          )}
        </ol>
      </nav>
    `;
  }
}

export function defineCivitaiBreadcrumb(): void {
  defineElement(TAG, CivitaiBreadcrumb);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-breadcrumb': CivitaiBreadcrumb;
  }
}
