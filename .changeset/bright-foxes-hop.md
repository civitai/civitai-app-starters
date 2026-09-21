---
'@civitai/components': minor
---

The utility layer is no longer in a cascade layer. A layered rule loses to any
unlayered one regardless of specificity, so every `ci-*` class silently lost to
legacy CSS it exists to beat — measured against Bootstrap's reboot, `ci-mt-6`
computed to `0px`. Components stay layered, so consumers can still override
those. Adds `ci-border-bottom` and `ci-border-end`.
