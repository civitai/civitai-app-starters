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

🔴 A COMPILE-TIME GUARD FOR THE PEER NOT RESOLVING. The unresolved import is in the shipped `steps.d.ts`, so `skipLibCheck: true` — the TypeScript-app default, and what every starter here sets — suppresses its `TS2307`, and the exports degrade to an error type that behaves like `any`: code compiles and nothing is checked. Measured on a consumer with the peer uninstalled: deliberately wrong `$type`, `input` and envelope fields produced no diagnostic at all, while a planted type error in the same project did report.

`keyof` over that error type is `string | number | symbol` rather than `any`, so `string extends keyof <template>` distinguishes the two states: `false` for every generated template (none of the 47 carries a string index signature — enumerated, both directions checked) and `true` for the error type. `WorkflowStepTemplateFor`, `WorkflowStepInputFor`, `AnyWorkflowStepTemplate` and `TypedWorkflowTemplate` now collapse to a message type when it fires, so you get a `TS2322` in YOUR file naming `pnpm add -D @civitai/client@beta` instead of silence. Peer installed, the consumer's diagnostics are byte-identical to the pre-guard build. Both arms are pinned by `test/orchestrator/steps-peer-guard.test.ts`, which compiles a consumer against the emitted declarations with the peer resolvable and unresolvable.

🔴 USE `"moduleResolution": "Bundler"` FOR THIS SUBPATH. `@civitai/client@0.2.0-beta.98` is published with `"type": "module"`, no `exports` map, and extensionless relative re-exports, which Node's ESM resolution does not resolve — so under `NodeNext`/`Node16` the peer degrades to the same error type even when correctly installed (measured: before the guard, only the planted control reported). The guard names this case in its message. Every starter here, and this package itself, use `Bundler`.

THIS IS TYPE SURFACE, NOT PERMISSION SURFACE. Nothing here changes what can be submitted. App Blocks post a `WorkflowBody` to the host, which validates server-side against its own schema — that contract (`@civitai/app-sdk/blocks`) is untouched. Standalone apps submit with the user's OAuth token and the orchestrator applies its own authorization; a body that compiles can still be rejected. Several of the 47 exist to serve Civitai's own pipelines; they're in the consumer spec so they're typed, not as an invitation. (`WORKFLOW_STEP_TYPES` marks only two of its 47 entries as platform internals — the map covers all 47 because a `$type`-keyed lookup has to be total to be sound, not because the catalog flags the internals.)

One deliberate divergence from the generated types: `currencies` is optional on `TypedWorkflowTemplate` where the spec marks it required. This package's own body builders have never emitted it, every starter submits through them, and civitai's orchestrator services pass it as `undefined`; requiring it would produce a type that contradicts working code. The spec describes the field as a limit on which currencies may pay for a workflow — that is what it does when present; what the orchestrator does when it is omitted is not verified. Pass it explicitly to scope payment. Pinned both ways in the type test, and reasoned from the spec and call sites rather than from a live submit.

Also: corrected the README's stale "44 in total" step-type count to 47, and registered the new subpath with the README-snippet typecheck gate.
