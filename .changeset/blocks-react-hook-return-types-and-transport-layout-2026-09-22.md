---
'@civitai/blocks-react': minor
'@civitai/app-sdk': patch
---

Name every hook's return type, move the entry's transport modules out of `internal/`, and replace two stale docblock claims (#378, #380, #381, #388).

**`minor`, because the public type surface GREW (#380).** 19 hooks gained an exported `Use<Hook>` return type and roughly 25 new type exports landed on the package entry. Nothing was removed and nothing changed shape, so no consumer needs to do anything — but new exported API is a feature, not a patch. `@civitai/app-sdk` takes a `patch`: a comment-only correction that nevertheless ships, because JSDoc travels in `.d.ts`.

**Every hook exported from `@civitai/blocks-react` now ships a named, exported return type (#380).** Whether one existed was a coin flip — measured on `bcc24bf`: 37 files under `src/hooks/use*.ts`, 17 with an exported `Use<Hook>`, 20 without. A consumer wrapping `useBlockContext()` had to hand-copy a ten-field `Pick<BlockSnapshot, …>` that existed only on the function's own return annotation. `UseBuzzWorkflowReturn` — which existed but was never exported, the same defect from the other side — is now `UseBuzzWorkflow`.

The rule is "every hook **exported from the package entry**", not "every `use*.ts` file". `useRequestSequencer` is a hook-shaped file that #413 added as the shared request sequencer the public hooks build on; publishing a return type for it would publish an implementation detail to satisfy a guard. It is recorded as internal with that reason, and a separate assertion fails if it ever reaches the entry.

Inside the rule there are no exceptions: `UseBlockResize = void` and `UseBlockTheme = Theme` are aliases, because an exception list is a thing to remember and get wrong. `useImageUpload` is overloaded, so its return type is a family — each public overload names its own, and the implementation signature's type is asserted to stay OFF the entry.

Three checks, three different failure modes, none subsuming another: a guard asserts the hook SET against written ledgers (failing when the set **grows** as well as when a type is deleted), the same guard reads the return **annotation** and requires the name, and `src/hooks/returnTypeLedger.ts` asserts `Exact<ReturnType<typeof useX>, UseX>` for all 36 entry hooks. The third does not subsume the second — measured, not assumed: re-inlining an annotation as a literal of the same shape leaves `tsc` completely green.

**Nine modules moved from `src/internal/` to `src/transport/` (#378).** `src/index.ts` published 14 symbols out of a directory named `internal/`, six of them deliberately public per README § "Lower-level transport". The name told contributors that `IframeTransport`, `sendTypedRequest`, `getTransport` and `RequestTimeoutError` were private and free to move. **Nothing is removed and no import path a consumer can legitimately write has changed** — the exports map publishes `.`, `./ui`, `./testing` and `./live`, and all four are unchanged. Only the layout under `dist/` moved, which is not a supported import surface.

`src/internal/` keeps what the main entry does not reach — the mock host, the live host, the picker overlay, the catalog client, consent, the reply-error shaper — so the split now matches the export reality rather than a wholesale rename that would have filed the live host under `transport/`.

**Two stale docblock claims, both about things a reader would believe (#381, #388).** `useBuzzWorkflow`'s docblock said `WorkflowBody` has "THREE members" and then certified the list "otherwise unchanged"; it has four — `WorkflowBodyPassThroughStep` landed in #310. The count is now stated structurally or not at all: the prose states none, and a mutual-assignability assertion against the union fails `tsc` when it changes in either direction.

And `waitSeconds` was documented as "🔴 CURRENTLY ADVISORY … a host that does not yet read the field simply answers immediately". The deployed host honours and clamps it. The real contract is now written down, read off `civitai/civitai` @ `b0eb2820b5` (5.1.120): `MAX_BLOCK_POLL_WAIT_SECONDS = 15`, `Math.floor` applied **first** (so `0.9` is no hold at all, not a short one), a floored value `<= 0` meaning no hold, and otherwise `Math.min(floored, 15)`. Practically: only whole seconds are expressible, and asking for more than 15 buys nothing — `intervalMs` remains what bounds your request rate. The sha is quoted because this is prose about another repo and no guard in this one can check it; the honest check is a human read at a named revision.
