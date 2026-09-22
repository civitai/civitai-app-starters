---
'@civitai/blocks-react': minor
---

Name the `responseToResources` parameter, and gate the public type surface on the built `.d.ts` (#379).

**`minor`, and the only reason it is not `patch`: two types gain a public name.**
`@civitai/blocks-react` now exports `RawGenerationResourcesResponse` and
`RawGenerationResource`. Nothing is removed, nothing is renamed, no existing
import can break.

## What #379 actually was, re-measured

The issue reported **47 reference sites where a public export names a type the
consumer cannot import**, measured at `eed2df5`. Re-derived at `e993cf0` through
the TypeScript API over the built `.d.ts` of every `exports` key, the count is
still 47 — but it is **not the same 47**. #416 had already closed every
`Use<Hook>Return` the issue named; six further names it listed (`ScanEntry`,
`OriginMatcher`, `PendingRequest`, `ActiveToast`, and `liveHost`'s three trpc
result types) are local-variable and private-field types that never reach a
`.d.ts` at all; and `UseImageUploadOptions` is exported today. The matching total
is coincidence.

Classified by POSITION, **46 of the 47 are not friction**, and that was measured
rather than argued. An external consumer project — outside the workspace,
installed from the real `pnpm pack` tarballs — constructs, reads, stores and
wraps every affected exported type without ever naming the hidden one, at **0
type errors**, while a companion file importing the 8 hidden names directly
errors on **all 8** (`TS2305` / `TS2459` / `TS2724`). An exported interface that
`extends` a non-exported base inlines every member: a consumer writes
`ExchangeCodeOpts` and gets `clientId` / `clientSecret` / `baseUrl` /
`fallbackScope`, and `Pick<RefreshTokenOpts, …>` names the shared half.
`Extract<ResourceCardProps, { variant: 'card' }>` names a union arm.
`keyof WorkflowStepTemplates` is `keyof StepTemplateMap` — which is
non-exported **by design**, with an invariant and a test in
`@civitai/app-sdk/orchestrator/steps` that exporting it would break.

## The one real defect

`responseToResources(raw: RawGenerationResourcesResponse | null | undefined)` —
an exported function's **parameter**. A caller doing its own fetch has to produce
that value, and the only way to type the fetch was
`Parameters<typeof responseToResources>[0]`: naming the function in order to name
its input. Both the response and its row type are exported now, because a
response type whose `items` element had no name would move the same problem one
level down. They are the WIRE shape — every field optional and unvalidated, so
the mapper survives a malformed row. Type a fetch with them; the checked shape is
the `BlockResourceInfo[]` the mapper returns.

## The guard

`pnpm check:public-types` resolves every type reference in every built `.d.ts`
entry against what the `exports` map actually publishes. Return types, function
parameters and callback returns must be exported outright; every other position
is on an audited exemption ledger that records the name-free route a consumer
takes, asserted as an exact multiset so a new violation fails until someone
writes the route down. It fails loudly on an unbuilt tree rather than reporting a
vacuous zero, and `--self-test` runs a deliberately-unexported fixture and its
exported twin before the real scan is believed.
