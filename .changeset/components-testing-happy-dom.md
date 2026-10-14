---
'@civitai/components': minor
---

Add `@civitai/components/testing/happy-dom`, a vitest setup file that installs a minimal `ElementInternals` / `attachInternals` stand-in when the test DOM lacks one. happy-dom implements neither, so `<civitai-button>` and every form control (checkbox, number-input, radio-group, segmented-control, select, slider, switch, text-input, textarea) threw `TypeError: this.attachInternals is not a function` on construction in a block's own test suite. Use it with `setupFiles: ['@civitai/components/testing/happy-dom']`. It does nothing where `attachInternals` exists, and no runtime entry imports it.
