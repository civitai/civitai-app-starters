import { defineCivitaiButton } from './civitai-button.js';
import { defineCivitaiSegmentedControl } from './civitai-segmented-control.js';
import { defineCivitaiTextInput } from './civitai-text-input.js';

/** Register every element in this package. Safe to call more than once. */
export function registerAll(): void {
  defineCivitaiButton();
  defineCivitaiTextInput();
  defineCivitaiSegmentedControl();
}

registerAll();
