import { defineCivitaiAlert } from './civitai-alert.js';
import { defineCivitaiBadge } from './civitai-badge.js';
import { defineCivitaiButton } from './civitai-button.js';
import { defineCivitaiCard } from './civitai-card.js';
import { defineCivitaiGroup } from './civitai-group.js';
import { defineCivitaiLoader } from './civitai-loader.js';
import { defineCivitaiSegmentedControl } from './civitai-segmented-control.js';
import { defineCivitaiStack } from './civitai-stack.js';
import { defineCivitaiTextInput } from './civitai-text-input.js';

/** Register every element in this package. Safe to call more than once. */
export function registerAll(): void {
  defineCivitaiAlert();
  defineCivitaiBadge();
  defineCivitaiButton();
  defineCivitaiCard();
  defineCivitaiGroup();
  defineCivitaiLoader();
  defineCivitaiSegmentedControl();
  defineCivitaiStack();
  defineCivitaiTextInput();
}

registerAll();
