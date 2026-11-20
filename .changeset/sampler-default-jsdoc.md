---
'@civitai/app-sdk': patch
'@civitai/sdk': patch
---

**`BlockTextToImageParams.sampler` no longer documents a default of `'Euler'`.** Since civitai/civitai#8859 the host uses the model family's own default sampler when `sampler` is omitted (`Euler a` for the SD families), and sends none for a family with no sampler control. The doc comment now says so, and points at `fetchGenerationSamplers` for the names a family offers. Documentation only: no type or behaviour changes.
