---
'@civitai/blocks-react': patch
---

fix(blocks-react): treat a PRESENT `error` (not a truthy one) as the reject signal in the six hooks whose reply validators early-accept on `error` — `error: ''` is falsy, so it skipped the success-field checks and resolved with unvalidated garbage
