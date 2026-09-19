import { defineCivitaiAlert } from './civitai-alert.js';
import { defineCivitaiBadge } from './civitai-badge.js';
import { defineCivitaiButton } from './civitai-button.js';
import { defineCivitaiCard } from './civitai-card.js';
import { defineCivitaiCheckbox } from './civitai-checkbox.js';
import { defineCivitaiCollapse } from './civitai-collapse.js';
import { defineCivitaiGroup } from './civitai-group.js';
import { defineCivitaiImage } from './civitai-image.js';
import { defineCivitaiLoader } from './civitai-loader.js';
import { defineCivitaiModal } from './civitai-modal.js';
import { defineCivitaiNumberInput } from './civitai-number-input.js';
import { defineCivitaiRadioGroup } from './civitai-radio-group.js';
import { defineCivitaiSegmentedControl } from './civitai-segmented-control.js';
import { defineCivitaiSelect } from './civitai-select.js';
import { defineCivitaiSlider } from './civitai-slider.js';
import { defineCivitaiStack } from './civitai-stack.js';
import { defineCivitaiTabs } from './civitai-tabs.js';
import { defineCivitaiTextInput } from './civitai-text-input.js';
import { defineCivitaiTextarea } from './civitai-textarea.js';
import { defineCivitaiTooltip } from './civitai-tooltip.js';

/** Register every element in this package. Safe to call more than once. */
export function registerAll(): void {
  defineCivitaiAlert();
  defineCivitaiBadge();
  defineCivitaiButton();
  defineCivitaiCard();
  defineCivitaiCheckbox();
  defineCivitaiCollapse();
  defineCivitaiGroup();
  defineCivitaiImage();
  defineCivitaiLoader();
  defineCivitaiModal();
  defineCivitaiNumberInput();
  defineCivitaiRadioGroup();
  defineCivitaiSegmentedControl();
  defineCivitaiSelect();
  defineCivitaiSlider();
  defineCivitaiStack();
  defineCivitaiTabs();
  defineCivitaiTextInput();
  defineCivitaiTextarea();
  defineCivitaiTooltip();
}

registerAll();
