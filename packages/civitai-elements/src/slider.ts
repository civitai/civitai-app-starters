/** `@civitai/elements/slider` — registers `<civitai-slider>` and nothing else. */
import { CivitaiSlider } from './slider/civitai-slider.js';
import { define } from './internal/define.js';

define('civitai-slider', CivitaiSlider);

export { CivitaiSlider };
export type { SliderChangeDetail } from './slider/civitai-slider.js';
