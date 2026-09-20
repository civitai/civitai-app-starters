/** `@civitai/elements/select` — registers `<civitai-select>` and nothing else. */
import { CivitaiSelect } from './select/civitai-select.js';
import { define } from './internal/define.js';

define('civitai-select', CivitaiSelect);

export { CivitaiSelect };
export type { SelectOption, SelectChangeDetail } from './select/civitai-select.js';
