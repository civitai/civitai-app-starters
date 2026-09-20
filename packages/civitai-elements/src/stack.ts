/** `@civitai/elements/stack` — registers `<civitai-stack>` and nothing else. */
import { CivitaiStack, GAP_STEPS } from './stack/civitai-stack.js';
import { define } from './internal/define.js';

define('civitai-stack', CivitaiStack);

export { CivitaiStack, GAP_STEPS };
export type { GapStep } from './stack/civitai-stack.js';
