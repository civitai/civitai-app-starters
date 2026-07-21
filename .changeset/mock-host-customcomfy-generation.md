---
"@civitai/blocks-react": minor
---

`createMockHost` (the `@civitai/blocks-react/testing` harness) now documents and tests `customComfy` generation support, so a scaffolded App Block's `dev:harness` loop plus its unit/e2e tests can exercise a `{ kind: 'customComfy', recipe, params }` sample generation with no real backend.

The estimate → submit → poll → terminal money path was already kind-agnostic — it drives both `WorkflowBody` arms (`textToImage` and `customComfy`) through the identical lifecycle, honors the same `generation` / `buzz` scenario config (`costPerGen` / `failRate` / `failNext` / `insufficient` / `latencyMs`), and stamps `spentAccountType` from the customComfy body's `params.accountType`. This release makes that a documented, tested contract:

- A customComfy `estimate` returns a `cost.total` on a non-empty sentinel `workflowId` (survives the SDK inbound validator).
- A customComfy `submit` polls to `succeeded` carrying an image url and a `cost`.
- The fail / insufficient-Buzz / disallowed-account scenario config applies to customComfy identically to textToImage.
- The mock accepts **any** `recipe` id without validating it against a registry (the recipe registry is server-only) — it stands in for the server, fail-open.

No API surface change and no new config knobs; `@civitai/app-sdk` is unchanged (the `customComfy` `WorkflowBody` kind already ships there).
