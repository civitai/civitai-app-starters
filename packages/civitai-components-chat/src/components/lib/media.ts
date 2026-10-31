import '@civitai/components/civitai-audio/define';
import '@civitai/components/civitai-image/define';
import '@civitai/components/civitai-video/define';
import { css, html, type TemplateResult } from 'lit';

export type MediaKind = 'image' | 'video' | 'audio';
/** `thumb` fills a square, `inline` fits the chat column, `full` is the viewer's own. */
export type MediaMode = 'thumb' | 'inline' | 'full';

export interface MediaOptions {
  kind: MediaKind;
  mode: MediaMode;
  src?: string;
  alt?: string;
  /** Still being made: the file exists but has no URL yet. */
  pending?: boolean;
  /** Withheld as mature content. */
  blocked?: boolean;
  /** Known size, so an inline image holds its place while it downloads. */
  width?: number;
  height?: number;
  part?: string;
  /** Makes an image (or a thumbnail video) a button. */
  onOpen?: () => void;
  /** The file would not load; `fallback` text shows until `src` changes. */
  onError?: () => void;
}

const HIDDEN = html`<span slot="blocked">Hidden: mature content</span>`;
const GONE = 'This file is no longer available';

/** A result or upload as `<civitai-image>`, `<civitai-video>` or `<civitai-audio>`; each opens with a bubbling `open` event. */
export function media({ kind, mode, src = '', alt = '', pending = false, blocked = false, part = 'media', width, height, onOpen, onError }: MediaOptions): TemplateResult {
  const waiting = pending || (!src && !blocked);
  const fit = mode === 'thumb' ? 'cover' : 'contain';
  // The element's own `open` carries no detail; the owner sends one that says which file.
  const open = onOpen
    ? (event: Event) => {
        event.stopPropagation();
        onOpen();
      }
    : undefined;
  if (kind === 'audio') {
    return html`<civitai-audio part=${part} data-mode=${mode} .src=${src} .alt=${alt} .pending=${waiting} .blocked=${blocked} fallback=${GONE} @error=${onError}
      >${HIDDEN}</civitai-audio
    >`;
  }
  if (kind === 'video') {
    return html`<civitai-video
      part=${part}
      data-mode=${mode}
      .src=${src}
      .alt=${alt}
      .pending=${waiting}
      .blocked=${blocked}
      fit=${fit}
      ?preview=${mode === 'thumb'}
      ?openable=${mode === 'thumb' && !!onOpen}
      fallback=${GONE}
      @open=${open}
      @error=${onError}
      >${HIDDEN}</civitai-video
    >`;
  }
  return html`<civitai-image
    part=${part}
    data-mode=${mode}
    style=${width && height ? `--cvt-media-ratio: ${width} / ${height}` : ''}
    .src=${src}
    .alt=${alt}
    .pending=${waiting}
    .blocked=${blocked}
    fit=${fit}
    ?openable=${!!onOpen}
    fallback=${GONE}
    @open=${open}
    @error=${onError}
    >${HIDDEN}</civitai-image
  >`;
}

/** Sizes for `data-mode`, for the stylesheet of whichever shadow root renders `media()`. */
export const mediaSizes = css`
  [data-mode='thumb'] { aspect-ratio: 1; }
  [data-mode='inline'] { --civitai-media-max-height: var(--cvt-media-max-height, 480px); }
  /* A signed URL arrives long before its file; the box holds the image's place until it lands. */
  [data-mode='inline'][status='loading'] {
    aspect-ratio: var(--cvt-media-ratio, 1);
    max-height: var(--civitai-media-max-height);
    background: var(--civitai-color-border);
    animation: cvt-media-pulse 1.4s ease-in-out infinite;
  }
  [data-mode='inline'][status='loading']::after {
    content: '';
    position: absolute;
    inset: 0;
    width: 28px;
    height: 28px;
    margin: auto;
    border: 3px solid var(--civitai-color-text-dimmed);
    border-right-color: transparent;
    border-radius: 50%;
    animation: cvt-media-spin 0.8s linear infinite;
  }
  @keyframes cvt-media-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes cvt-media-pulse {
    50% { opacity: 0.55; }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-mode='inline'][status='loading'],
    [data-mode='inline'][status='loading']::after { animation: none; }
  }
  [data-mode='full'] { --civitai-media-max-height: var(--cvt-media-max-height, 80vh); }
`;
