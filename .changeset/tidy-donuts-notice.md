---
'@civitai/app-sdk': minor
---

Typed orchestrator step shapes via a new type-only subpath `@civitai/app-sdk/orchestrator/steps`.

`WORKFLOW_STEP_TYPES` told you which `$type`s exist; the body builders took `input: unknown`. This adds the other half — the real per-step input shapes, keyed by wire `$type` over the orchestrator's own generated client (`@civitai/client`) so they track the OpenAPI spec by codegen instead of by hand.

New exports (all types): `WorkflowStepTemplates` (`$type` → template, all 47), `WorkflowStepTemplateFor<T>`, `WorkflowStepInputFor<T>`, `AnyWorkflowStepTemplate` (discriminated union — `@civitai/client`'s base `WorkflowStepTemplate` has `$type` as a bare `string` and narrows nothing), `TypedWorkflowTemplate` (submit envelope with `steps` narrowed). The generated `*StepTemplate` and `*Input` names are deliberately not re-exported individually: using this subpath requires `@civitai/client` installed anyway, so import a name straight from there — and `WorkflowStepTemplateFor<T>` / `WorkflowStepInputFor<T>` take the wire `$type` you already have rather than the generated name you would have to look up.

TYPE-ONLY, ZERO RUNTIME. Every import and export is `type`; the built `dist/orchestrator/steps.js` is `export {};` and bundles to 0 bytes. The `.` and `./orchestrator` entry points are byte-identical before and after (12,986 and 6,438 bytes minified). Enforced by `test/orchestrator/steps-type-only.test.ts`, which compiles the module and asserts the EMITTED JavaScript carries no `@civitai/client` import — with positive controls, because a source-level "is it spelled `import type`" check is walkable by `import { type A, B }`.

`@civitai/client` is an OPTIONAL PEER, not a dependency: `dependencies` stays empty, so an app that never imports this subpath installs nothing new. Install it only if you do:

```sh
pnpm add -D @civitai/client@beta
```

Use the `beta` tag. `@civitai/client`'s npm `latest` is `0.1.1-beta.0` while the version the orchestrator is generated against ships under `beta` (`0.2.0-beta.98`, matching what civitai/civitai resolves). A plain `pnpm add @civitai/client` silently installs ~97 betas behind, missing most step types; the peer range `^0.2.0-beta.98` excludes 0.1.x by construction.

🔴 FORGETTING THE PEER IS SILENT, NOT AN ERROR. The unresolved import is in the shipped `steps.d.ts`, so `skipLibCheck: true` — the TypeScript-app default, and what every starter here sets — suppresses its `TS2307`, and every export from this subpath degrades to `any`: your code compiles and nothing is checked. Measured on a consumer with the peer uninstalled: 0 diagnostics on deliberately wrong `$type`, `input` and envelope fields, against a planted type error in the same project that did report. No type-level guard can close this — TypeScript propagates an unresolved import's error type as `any` through any computation over it, detector included — so if the step types seem not to be catching anything, check `node_modules/@civitai/client` exists first. Only this subpath is affected.

THIS IS TYPE SURFACE, NOT PERMISSION SURFACE. Nothing here changes what can be submitted. App Blocks post a `WorkflowBody` to the host, which validates server-side against its own schema — that contract (`@civitai/app-sdk/blocks`) is untouched. Standalone apps submit with the user's OAuth token and the orchestrator applies its own authorization; a body that compiles can still be rejected. Several of the 47 exist to serve Civitai's own pipelines; they're in the consumer spec so they're typed, not as an invitation. (`WORKFLOW_STEP_TYPES` marks only two of its 47 entries as platform internals — the map covers all 47 because a `$type`-keyed lookup has to be total to be sound, not because the catalog flags the internals.)

One deliberate divergence from the generated types: `currencies` is optional on `TypedWorkflowTemplate` where the spec marks it required. This package's own body builders have never emitted it, every starter submits through them, and civitai's orchestrator services pass it as `undefined`; requiring it would produce a type that contradicts working code. Note the direction: the spec calls the field a limit on which currencies may pay for a workflow, so omitting it is the permissive choice — pass it explicitly to scope payment. Pinned both ways in the type test, and reasoned from the spec and call sites rather than from a live submit.

Also: corrected the README's stale "44 in total" step-type count to 47, and registered the new subpath with the README-snippet typecheck gate.
