---
'@civitai/app-sdk': patch
---

**The `@civitai/app-sdk/orchestrator/steps` docs now say that its peer, `@civitai/client`, is frozen.** That package was renamed to `@civitai/orchestration-client`, and `0.2.0-beta.98` is its last release. The README and the module's doc comment no longer claim that a later `@civitai/client` release will close the gap between the step catalog and the typed map. They now say that this subpath still imports `@civitai/client` on purpose, so installing only the renamed package does not satisfy it, and that `@civitai/sdk` types its steps from `@civitai/orchestration-client`. Documentation only: no type or behaviour changes.
