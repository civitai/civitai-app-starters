import { createHost, getTransport, type BlockTransport } from '@civitai/sdk';
import { CivitaiElement, defineElement } from '../elements/internals.js';
import '../elements/civitai-button.define.js';
import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

const TAG = 'civitai-sign-in-button';

/**
 * Starts the host's sign-in flow. Inert until `BLOCK_INIT` lands: there is no
 * validated host origin before then, so a press must send nothing at all.
 */
export class CivitaiSignInButton extends CivitaiElement {
  static override styles = [
    css`
      :host {
        display: inline-flex;
      }
      :host([hidden]) {
        display: none;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    returnUrl: { reflect: true, attribute: 'return-url' },
    variant: { reflect: true },
    size: { reflect: true },
    ready: { state: true },
    signedIn: { state: true },
  };

  /** A path within this app; the host sanitises it. */
  declare returnUrl: string;
  declare variant: string;
  declare size: string;
  declare ready: boolean;
  declare signedIn: boolean;

  /** Injectable so a test can drive it without a real parent frame. */
  transport?: BlockTransport;

  #unsubscribe?: () => void;

  constructor() {
    super();
    this.returnUrl = '';
    this.variant = 'filled';
    this.size = 'md';
    this.ready = false;
    this.signedIn = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const transport = this.#transport();
    this.#read(transport);
    this.#unsubscribe = transport.snapshot.subscribe(() => this.#read(transport));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  #transport(): BlockTransport {
    return (this.transport ??= getTransport());
  }

  #read(transport: BlockTransport): void {
    const snapshot = transport.snapshot.get();
    this.ready = snapshot.ready;
    this.signedIn = snapshot.viewer != null;
  }

  #signIn(): void {
    const transport = this.#transport();
    // Re-read the snapshot rather than trusting the rendered state: the
    // disabled control is a courtesy, this is the thing that must hold.
    const snapshot = transport.snapshot.get();
    if (!snapshot.ready || snapshot.viewer != null) return;
    createHost(transport).requestSignIn(
      this.returnUrl === '' ? {} : { returnUrl: this.returnUrl }
    );
  }

  override render(): TemplateResult | typeof nothing {
    if (this.signedIn) return nothing;
    return html`
      <civitai-button
        exportparts="button"
        .variant=${this.variant}
        .size=${this.size}
        .disabled=${!this.ready}
        @click=${this.#signIn}
      >
        <slot>Sign in</slot>
      </civitai-button>
    `;
  }
}

export function defineCivitaiSignInButton(): void {
  defineElement(TAG, CivitaiSignInButton);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-sign-in-button': CivitaiSignInButton;
  }
}
