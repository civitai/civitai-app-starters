import { injectTokens } from '@civitai/theme';
import { LitElement, type PropertyValues } from 'lit';

/**
 * Events a shadow root swallows: `composed: false` means they stop at the
 * boundary, so a consumer listening on the host — or on `document` — never
 * sees them. `invalid` does not bubble either, hence the capture listener.
 */
const RETARGETED: readonly { type: string; capture: boolean }[] = [
  { type: 'change', capture: false },
  { type: 'invalid', capture: true },
];

const TOKENS_INJECTED = new WeakSet<Document>();

/**
 * Deepest focused node, crossing every shadow boundary. `document.activeElement`
 * stops at the outermost host, which is never the node that actually has focus.
 */
export function deepActiveElement(root: DocumentOrShadowRoot = document): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export abstract class CivitaiElement extends LitElement {
  override connectedCallback(): void {
    super.connectedCallback();
    const doc = this.ownerDocument;
    if (!TOKENS_INJECTED.has(doc)) {
      TOKENS_INJECTED.add(doc);
      injectTokens(doc);
    }
  }

  protected override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    for (const { type, capture } of RETARGETED) {
      this.renderRoot.addEventListener(
        type,
        () => {
          this.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
        },
        { capture }
      );
    }
  }
}
