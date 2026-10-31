import { CivitaiElement, defineElement, hostBaseline } from '@civitai/components/internals';
import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

const TAG = 'civitai-chat-dropzone';

export type RejectReason = 'type' | 'size';

/** Turns dropped, pasted or picked files into one `files` event, filtered by `accept` and `max-size`. */
export class CivitaiChatDropzone extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
        position: relative;
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        border: 2px dashed var(--civitai-color-primary);
        border-radius: var(--civitai-radius, 8px);
        background: color-mix(in srgb, var(--civitai-color-body) 85%, transparent);
        color: var(--civitai-color-text);
        font-weight: 600;
        pointer-events: none;
        z-index: 2;
      }
      .overlay[hidden],
      input {
        display: none;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    accept: { reflect: true },
    multiple: { type: Boolean, reflect: true },
    maxSize: { type: Number, reflect: true, attribute: 'max-size' },
    disabled: { type: Boolean, reflect: true },
    noDrop: { type: Boolean, reflect: true, attribute: 'no-drop' },
    dragging: { state: true },
  };

  /** Comma-separated MIME types; `image/*` wildcards work. Empty accepts anything. */
  declare accept: string;
  declare multiple: boolean;
  /** Bytes; 0 means no limit. */
  declare maxSize: number;
  declare disabled: boolean;
  /** Takes pasted and picked files only, leaving drops to an outer zone. */
  declare noDrop: boolean;
  declare dragging: boolean;

  #depth = 0;

  constructor() {
    super();
    this.accept = '';
    this.multiple = true;
    this.maxSize = 0;
    this.disabled = false;
    this.noDrop = false;
    this.dragging = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('dragenter', this.#onDragEnter);
    this.addEventListener('dragover', this.#onDragOver);
    this.addEventListener('dragleave', this.#onDragLeave);
    this.addEventListener('drop', this.#onDrop);
    this.addEventListener('paste', this.#onPaste);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('dragenter', this.#onDragEnter);
    this.removeEventListener('dragover', this.#onDragOver);
    this.removeEventListener('dragleave', this.#onDragLeave);
    this.removeEventListener('drop', this.#onDrop);
    this.removeEventListener('paste', this.#onPaste);
  }

  /** Opens the file picker. */
  browse(): void {
    if (!this.disabled) this.renderRoot.querySelector('input')?.click();
  }

  accepts(file: File): boolean {
    const accepted = this.accept.split(',').map((type) => type.trim()).filter(Boolean);
    if (accepted.length === 0) return true;
    return accepted.some((type) => (type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type));
  }

  take(files: File[]): void {
    if (this.disabled || files.length === 0) return;
    const chosen = this.multiple ? files : files.slice(0, 1);
    const wrongType = chosen.filter((file) => !this.accepts(file));
    const tooBig = chosen.filter((file) => this.accepts(file) && this.maxSize > 0 && file.size > this.maxSize);
    const good = chosen.filter((file) => !wrongType.includes(file) && !tooBig.includes(file));
    if (wrongType.length) this.#dispatch('rejected', { files: wrongType, reason: 'type' });
    if (tooBig.length) this.#dispatch('rejected', { files: tooBig, reason: 'size' });
    if (good.length) this.#dispatch('files', { files: good });
  }

  #dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }

  #hasFiles(event: DragEvent): boolean {
    return !this.disabled && !this.noDrop && (event.dataTransfer?.types ?? []).includes('Files');
  }

  #onDragEnter = (event: DragEvent): void => {
    if (!this.#hasFiles(event)) return;
    event.preventDefault();
    this.#depth++;
    this.dragging = true;
  };

  #onDragOver = (event: DragEvent): void => {
    if (!this.#hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  // Children fire their own enter/leave pairs; only the outermost leave ends the drag.
  #onDragLeave = (): void => {
    this.#depth = Math.max(0, this.#depth - 1);
    if (this.#depth === 0) this.dragging = false;
  };

  #onDrop = (event: DragEvent): void => {
    if (!this.#hasFiles(event)) return;
    event.preventDefault();
    this.#depth = 0;
    this.dragging = false;
    this.take([...(event.dataTransfer?.files ?? [])]);
  };

  #onPaste = (event: ClipboardEvent): void => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length === 0 || this.disabled) return;
    event.preventDefault();
    this.take(files);
  };

  #onPick = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    this.take([...(input.files ?? [])]);
    input.value = '';
  };

  override render(): TemplateResult {
    return html`
      <slot></slot>
      <div class="overlay" part="overlay" ?hidden=${!this.dragging}><slot name="overlay">Drop files to add them</slot></div>
      <input type="file" accept=${this.accept} ?multiple=${this.multiple} @change=${this.#onPick} tabindex="-1" aria-hidden="true" />
    `;
  }
}

export function defineCivitaiChatDropzone(): void {
  defineElement(TAG, CivitaiChatDropzone);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-dropzone': CivitaiChatDropzone;
  }
}
