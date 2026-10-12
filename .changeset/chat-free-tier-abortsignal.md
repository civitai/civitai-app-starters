---
'@civitai/components-chat': patch
---

Chat replies on the free tier work again in browsers without `AbortSignal.any` (Safari before 17.4, Chrome before 116, Firefox before 124). Before this fix, every free reply in those browsers failed with `TypeError: AbortSignal.any is not a function`. The free request now follows the caller's abort by hand and stops following it once the reply ends, so no listener is left behind.
