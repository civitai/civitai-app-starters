---
"@civitai/app-sdk": patch
---

Docs: correct the block-scope count in the README from "10" to "15". The `BLOCK_SCOPES` enum has grown to 15 members (adding `apps:storage:shared:*` and the three `collections:*` scopes), and the README (which ships to npm as the package listing) still described "the 10 known block scope strings" in two places. README-only change; no code or contract change.
