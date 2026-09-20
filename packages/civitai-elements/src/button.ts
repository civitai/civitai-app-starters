/**
 * `@civitai/elements/button` — registers `<civitai-button>` and nothing else.
 *
 * Per-component entrypoints are the bundle story: importing this module drags
 * Button's rule text and no other component's. See scripts/measure-bundle.mjs.
 */
import { CivitaiButton } from './button/civitai-button.js';
import { define } from './internal/define.js';

define('civitai-button', CivitaiButton);

export { CivitaiButton };
export type { ButtonVariant, ButtonSize, ButtonType } from './button/civitai-button.js';
