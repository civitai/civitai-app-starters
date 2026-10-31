import type { MediaKind } from './media.js';

export interface CardAction {
  id: string;
  label: string;
}

export const DEFAULT_ACTIONS: Record<MediaKind, CardAction[]> = {
  image: [
    { id: 'reference', label: 'Use in chat' },
    { id: 'animate', label: 'Animate' },
    { id: 'upscale', label: 'Sharpen' },
    { id: 'info', label: 'Info' },
    { id: 'download', label: 'Download' },
  ],
  video: [
    { id: 'reference', label: 'Use in chat' },
    { id: 'upscale', label: 'Sharpen' },
    { id: 'info', label: 'Info' },
    { id: 'download', label: 'Download' },
  ],
  audio: [
    { id: 'info', label: 'Info' },
    { id: 'download', label: 'Download' },
  ],
};
