import { useEffect } from 'react';

import { injectStyles } from '@civitai/components';

/**
 * Inject the `@civitai/components` stylesheet (and `--civitai-*` tokens) once on
 * mount. Every component in this package calls it, so rendering any of them is
 * enough to get styling — no CSS import or setup step. Mirrors
 * `@civitai/blocks-react`'s `useBlocksStyles()`.
 */
export function useComponentStyles(): void {
  useEffect(() => {
    injectStyles();
  }, []);
}

export { injectStyles };
