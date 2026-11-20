---
'@civitai/app-sdk': minor
---

**`createOrchestratorClient` takes an optional `logger`.** `callOrchestrator` logs a failed orchestrator response (status plus up to 500 bytes of the raw body) before it throws `OrchestratorError`. That line went to `console.error` with no way to change it. Pass `logger: { error }` to send it somewhere else, or `logger: null` to turn it off. Omitting `logger` keeps the old `console.error` behaviour. The thrown `OrchestratorError` (status and body) does not change. Adds the exported type `OrchestratorLogger`. Contributed by @PBandDev (#34).
