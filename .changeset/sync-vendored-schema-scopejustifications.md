---
'@civitai/app-sdk': patch
---

Sync the vendored App Block manifest schema to the canonical: add the optional `scopeJustifications` field (per-scope free-text rationale shown to moderators during review; civitai #3195). Backward-compatible — omit it and the manifest stays valid. Restores byte-parity with `https://civitai.com/schemas/app-block/v1.json`.
