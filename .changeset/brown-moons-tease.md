---
'@civitai/app-sdk': minor
---

**BREAKING (`minor` because this package is 0.x):** the orchestrator's
`WorkflowStatus` type is renamed to `OrchestratorWorkflowStatus`.

```diff
-import type { WorkflowStatus } from '@civitai/app-sdk';
+import type { OrchestratorWorkflowStatus } from '@civitai/app-sdk';

-import type { WorkflowStatus } from '@civitai/app-sdk/orchestrator';
+import type { OrchestratorWorkflowStatus } from '@civitai/app-sdk/orchestrator';
```

**Nothing else changes.** Same union, same members, still open-ended
(`| (string & {})`). `WorkflowSnapshot.status` carries the renamed type. No
runtime bytes move — this is a type-only rename.

**`@civitai/app-sdk/blocks`'s `WorkflowStatus` keeps its name and is
untouched.** That is the block-side hook lifecycle
(`'idle' | 'estimating' | 'submitting' | …`), a different union with 27 call
sites across the starters and the fleet apps. If your import is from
`/blocks`, change nothing.

**Why now.** Two unrelated unions shared one bare name, and the orchestrator
one sat on the *default* import surface because `src/index.ts` re-exports
`./orchestrator/index.js` wholesale. Both widen to `string`, so the compiler
could never flag a mix-up — the failure mode was a silently wrong annotation,
not a build error.

**Zero-consumer measurement.** A sweep of every `.ts` / `.tsx` / `.svelte` /
`.js` / `.md` / `.json` file in this repository (excluding `node_modules`,
`dist`, and changelogs) finds **seven** `WorkflowStatus` references. Two are
the orchestrator declaration and its single internal use in
`WorkflowSnapshot`; the other five are all the `/blocks` flavour
(`src/blocks/types.ts`, `src/blocks/index.ts`, `useBuzzWorkflow.ts` ×3, and a
README types list). **No consumer imports the orchestrator flavour by name**,
so the rename needs no codemod here. That measurement covers this repository
only — it cannot speak for npm consumers outside it, which is exactly why the
rename is taken now, before external adoption, rather than later.
