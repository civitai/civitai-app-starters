import { LitElement } from 'lit';

/** App elements render into light DOM so one stylesheet on the design tokens styles them all. */
export abstract class LightElement extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }
}

export function emit(target: EventTarget, type: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
}
