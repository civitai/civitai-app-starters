---
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

**Custom events: the docs now state the real contract, and `dev:live` warns about events production would drop.** Both hosts forward `TRACK_EVENT`, and the platform records an event only when the app's APPROVED manifest declares it under `analytics.events`.

- `@civitai/blocks-react`: `useBlockAnalytics()`'s TSDoc and README section are rewritten. They no longer promise that every event reaches a pipeline. They now say: only declared events are recorded (an undeclared one is counted as a drop and its name is not stored); only declared properties of the declared type are kept; there is no free-text string type (`enum`, `number`, `boolean`); each mount may send 10 events a second and 500 in total, in bodies of at most 32 KiB, and an over-limit event is dropped in the browser and counted nowhere; events are fire-and-forget; owners see aggregates in the app's analytics panel. The hook itself is unchanged.
- `@civitai/blocks-react/live`: new optional `LiveHostOptions.manifest`. Pass your imported `block.manifest.json` and every `TRACK_EVENT` is checked against its `analytics.events`. The console warns ONCE per distinct problem: an undeclared event, an undeclared property, or a value that does not match the declared type or enum. A declared, valid event logs nothing. The check never throws and never blocks the block, and there is still no reply. Without `manifest`, the first `TRACK_EVENT` says the check is off. Typed `unknown` because an imported JSON file widens its string literals.
- `@civitai/sdk`: new `app.host.track(eventName, properties?)`, which sends `TRACK_EVENT` on the same wire as `useBlockAnalytics().track`. `BREAKING.md` moves `TRACK_EVENT` from "Not carried" to carried and states the declared-only contract.
- Examples: every `starters/examples/*` `dev:live` harness passes `manifest`. `page-app` now declares its six events, and stops sending `modelId`, which no declaration can carry: property names are snake_case, and a number property should not carry an identifier.
