import { createHost, getTransport, type BlockTransport, type SignIn } from '@civitai/sdk';
import { CivitaiElement, defineElement } from '../elements/internals.js';
import '../elements/civitai-button.define.js';
import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';

const TAG = 'civitai-sign-in-button';

/**
 * Given a `signIn` from `createSignIn()`, leaves for Civitai itself; otherwise
 * asks the host page, and stays inert until `BLOCK_INIT` lands, since there is
 * no validated host origin before then.
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
    signIn: { attribute: false },
    ready: { state: true },
    signedIn: { state: true },
  };

  /** A path within this app; the host sanitises it. */
  declare returnUrl: string;
  declare variant: string;
  declare size: string;
  declare ready: boolean;
  declare signedIn: boolean;

  /** An app of its own signs the viewer in itself; without one, the host does. */
  declare signIn?: SignIn;

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
    if (this.hasUpdated) this.#follow();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unfollow();
  }

  // Not connectedCallback: `signIn` is set after the element is in the document,
  // and writing state after a render would cost a second one.
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!this.hasUpdated || changed.has('signIn')) this.#follow();
  }

  #follow(): void {
    this.#unfollow();
    if (this.signIn) {
      this.ready = true;
      this.signedIn = this.signIn.signedIn;
      return;
    }
    const transport = this.#transport();
    this.#read(transport);
    this.#unsubscribe = transport.snapshot.subscribe(() => this.#read(transport));
  }

  #unfollow(): void {
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

  #press(): void {
    const signIn = this.signIn;
    // Re-read rather than trusting the rendered state: the disabled control is
    // a courtesy, this is the thing that must hold.
    if (signIn) {
      if (!signIn.signedIn) void signIn.signIn();
      return;
    }
    const transport = this.#transport();
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
        @click=${this.#press}
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
