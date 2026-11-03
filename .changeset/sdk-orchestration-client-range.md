---
'@civitai/sdk': minor
---

`@civitai/orchestration-client` is now a `^0.2.0` range rather than an exact `0.2.0-beta.101` pin, so an app that installs the client itself shares one copy with the SDK instead of getting a second one. The `Step` and `StepTemplate` unions are regenerated from `0.2.0` and gain the step types added since `beta.101`.
