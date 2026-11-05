# Handoff: appblocks-snapshot-mirror-gap — 2026-10-02

## Run this first — the index, one command
```bash
$DEVRC/scripts/cairn-ops/read.sh recall --repo "/home/zach/workspace/civit/civitai-app-starters"
```
Terse pointers this doc does not carry, curated by past sessions and outliving it.
🔴 RECALL, NOT LIVE OBSERVATION — every line is a pointer to VERIFY, never a current
reading, and it may describe a gotcha already fixed. `scope-absent`/`scope-empty` means
nothing is recorded yet: ordinary, not an error, and not a clean bill of health.
Non-blocking: if it exits non-zero, print the stderr line and carry on.

## Goal

Close the half-shipped `BlockWorkflowSnapshot` contract: the host emits five output
fields that `@civitai/app-sdk` never mirrored, so a block can submit the
`chat-completion` step correctly and has no typed or documented way to read the reply.

- **closing-condition:** `check` — `snapshot.textOutputs` typechecks in a freshly
  scaffolded app with no cast, **and** removing any one host `BlockWorkflowSnapshot`
  field from the SDK's mirrored type makes civitai's `tsc --noEmit` fail naming a
  field-axis parity gate. Both halves, because the first alone is a one-time patch of
  a class that has already recurred four times.

## State now

- **Nothing coded. Four issues filed, cross-linked, each with a closing condition.**
  - `civitai/civitai-app-starters#524` — widen the SDK's `BlockWorkflowSnapshot` + its
    validator. The one that unblocks the others; fixes the generated docs for free.
  - `civitai/civitai#5325` — add the field-axis parity gate beside
    `src/components/AppBlocks/hostHandlerParity.ts`. The durable half.
  - `civitai/civitai-app-starters#525` — the mock host answers a `chat-completion`
    step with fabricated `imageUrls` and no text.
  - `civitai/civitai-developer-docs#144` — cross-link the orchestration
    `promptEnhancement` recipe and the in-block `chat-completion` step.
  - Suggested order: **#524 → #5325 → #525**, #144 any time.
- **The measurement, so it is not re-derived.** Host `BlockWorkflowSnapshot`
  (`civitai/civitai` `src/server/schema/blocks/workflow.schema.ts`) declares 12 fields.
  The SDK mirrors **7**: `workflowId`, `status`, `cost?`, `imageUrls?`, `error?`,
  `spentAccountType?`, `autoClaim?`. It does **not** mirror
  `modelSubstitutions?`, `textOutputs?`, `textOutputWithheld?`, `toolCalls?`,
  `stepOutputs?` — i.e. every non-image output channel.
- **Measured on the published artifact, not just source:**
  `@civitai/app-sdk@0.55.0` `dist/blocks/types.d.ts` contains `imageUrls`
  (positive control fires) and **zero** occurrences of `textOutputs`.
- **The host already records the debt and nothing tracked it.** The doc comment on
  `textOutputs` reads *"additive on the type `@civitai/app-sdk`'s `blocks/types.ts`
  mirrors, exactly like `modelSubstitutions` above. The SDK's inbound validator does
  not know it yet … tracked separately"*. No open issue in `civitai`,
  `civitai-app-starters`, `civitai-developer-docs` or `cli` mentioned it before #524.
  `toolCalls` carries the same comment and cites `textOutputs`, which cites
  `modelSubstitutions`. Each addition cited the previous instead of closing it.
- **`civitai#3637`** ("chat-completion step has no tool/function-calling surface") is
  partly obsolete host-side — `toolCalls` and `BlockStepToolCall` exist — but since the
  SDK never mirrored them it still reads as open from inside a block. The mirror gap
  makes a shipped host feature indistinguishable from an unshipped one.
- **Deploy/verify status:** nothing deployed, nothing coded, nothing verified against a
  live host. Every finding here is from reading code and the published dist.

## Open investigations — live diagnosis state

### Does a block actually RECEIVE `textOutputs` at runtime? Established by code-reading only, never observed live
- as-of: 2026-10-02

- **Symptom + exact repro:** not a failure — an unverified claim load-bearing for
  whether any block shipping an enhance feature works today. To observe it, submit a
  `{ kind: 'step', step: 'chat-completion', params: { model, messages, maxTokens } }`
  body from a block in `dev:live` and log `Object.keys(snapshot)` on the terminal poll.
- **Observed (with values):** nothing in the SDK strips unknown keys.
  `isValidWorkflowSnapshot` and `isValidWorkflowReply`
  (`packages/civitai-blocks-react/src/transport/validate.ts`) are pure boolean guards
  that `return true` without rebuilding the object; the validator dispatch table
  returns predicates per message type; `extractSnapshot`
  (`packages/civitai-blocks-react/src/internal/liveHost.ts`) ends
  `return snapshot as BlockWorkflowSnapshot` — a pure cast.
- **Ruled out:** that the SDK projects or whitelists snapshot fields, which would make
  the field unreadable rather than merely untyped. `via: code`
- **Ruled out:** that the field name is a guess. The host declares
  `textOutputs?: string[]` and it is written by exactly one producer,
  `attachModeratedStepTextOutputs`, on `blocks.pollWorkflow` and
  `blocks.cancelWorkflow` only. `via: code`
- **Leading hypothesis:** the field does arrive and is readable through a cast, so
  blocks reading it via `(snapshot as any).textOutputs` work today. No live
  confirmation exists, and "probably works" is the honest state.
- **Next probe:** one `dev:live` run — one enhance plus one generation — logging
  `Object.keys(snapshot)` and the `textOutputs` value on the terminal poll. That single
  observation settles it; no amount of further code-reading can.

### The `textOutputWithheld` branch is the one blocks will get wrong, and nothing exercises it
- as-of: 2026-10-02

- **Symptom + exact repro:** a block that handles only the happy path renders nothing
  and explains nothing when the host withholds text. Unreachable in mock mode today.
- **Observed (with values):** the host sets `textOutputWithheld?: { reason: string }`
  for **two** distinct causes — text produced but withheld by a fail-closed scan, and
  the step succeeded with nothing publishable — and its own doc states they are
  deliberately **not machine-separable** without matching the string, which is not a
  contract. Only the second cause is status-gated, so a **cancelled** workflow whose
  step succeeded can still set the field; `blocks.router.textOutputModeration.test.ts`
  pins exactly that case.
- **Ruled out:** that it is mutually exclusive with `textOutputs` — the host doc says a
  workflow with two text steps can release one and withhold the other, so both fields
  appear together. `via: code`
- **Leading hypothesis:** every block written against the current mock will assume text
  always arrives, because the mock cannot produce this branch at all (#525).
- **Next probe:** none for diagnosis. The work is #525's withheld arm, which is why that
  issue asks for it ahead of the happy path.

## Next steps (ranked)

1. **Widen the SDK's `BlockWorkflowSnapshot`** with the five unmirrored fields and
   extend `isValidWorkflowSnapshot` to shape-check them.
   `packages/civitai-app-sdk/src/blocks/types.ts` +
   `packages/civitai-blocks-react/src/transport/validate.ts`. Carry the host's
   two-cause `textOutputWithheld` doc comment across **as written** — a paraphrase
   loses the part consumers branch on. Tracked as `civitai-app-starters#524`.
   forcing: gate — #524's closing condition is unmet
2. **Add the field-axis parity gate** beside
   `src/components/AppBlocks/hostHandlerParity.ts` in `civitai/civitai`, same
   one-directional compile-time shape. Report the red/green pair from a deliberate
   one-field mutation. Tracked as `civitai#5325`.
   forcing: regression — the same drift has recurred across four field additions
3. **Teach the mock host to answer a text step**, withheld arm first.
   `packages/civitai-blocks-react/src/internal/mockHost.ts` `succeededSnapshot`.
   The interim half — stop reporting a text step as an image success — does not depend
   on rank 1. Tracked as `civitai-app-starters#525`.
   forcing: gate — #525's closing condition is unmet
4. **Cross-link the two prompt-enhancement pages** in `civitai-developer-docs`.
   Tracked as `civitai-developer-docs#144`. Cheapest item here and independent of the
   other three.
   forcing: none
5. **Get one live confirmation that a block reads `textOutputs`** — the `Next probe` in
   the first investigation block. Until then every claim that an enhance feature works
   rests on code-reading.
   forcing: user — an App Block has already shipped a feature reading this field

## Gotchas / decisions / dead-ends

- **The docs gap is DOWNSTREAM of the SDK gap, not a separate task.**
  `apps/reference/generation.md` is generated from SDK JSDoc, so `textOutputs` is
  undocumented *because* it is untyped. Rank 1 fixes both surfaces; do not open a
  separate docs issue for the field itself. (#144 is about page cross-linking, a
  different problem.)
- **`promptEnhancement` is NOT reachable from a block, and the docs do not say so.**
  It appears in exactly two tracked files in `civitai-developer-docs`
  (`orchestration/recipes/prompt-enhancement.md`, `openapi-snapshots/v2-consumers.json`)
  and **zero** times under `apps/`. It needs an orchestration token a block never holds,
  and there is no `promptEnhancement` entry in the block step registry — the registered
  ids are `convert-image` and `chat-completion`. The in-block equivalent is the
  `chat-completion` registry step, documented in detail on the **input** side.
- **`hostHandlerParity` is not the gate people assume it is.** It is one-directional on
  the **message-type** axis: every published SDK block→host message type must be an
  `INVENTORY` key with a registered handler. It asserts nothing about payload field
  shape, which is why five snapshot fields drifted while the message bridge stayed in
  sync. Its own docstring names this failure mode — *"authors test green locally then
  break in prod"* — one level up from where it bit.
- **Dead end: do not look for a stripper.** The first hypothesis was that the SDK's
  inbound validator drops unknown snapshot keys, making the field unreadable. Refuted
  by reading the guards: they are pure booleans and `extractSnapshot` is a pure cast.
  The defect is the type and the docs, not the transport.
- **This was surfaced by agent onboarding working, not failing.** A session building an
  App Block found the `chat-completion` step, the scope and consent rules and the
  pricing lifecycle from the docs unaided; what it could not find was the output field,
  because that information exists in no source the onboarding points at. It then
  guessed the field name correctly and flagged the uncertainty honestly rather than
  papering over it. Read this as a contract-completeness gap the onboarding exposed —
  not as an onboarding-routing gap.

## How to verify

```bash
S=/home/zach/workspace/civit/civitai-app-starters
C=/home/zach/workspace/civit/civitai

# the gap: 5 host fields absent from the SDK (expect ZERO hits in packages/)
git -C "$S" grep -c 'textOutputs' origin/main -- packages
git -C "$C" show origin/main:src/server/schema/blocks/workflow.schema.ts \
  | grep -nE '^  [a-zA-Z]+\??:' | awk -F: '$1>740'

# on the PUBLISHED artifact, with a positive control
T=$(mktemp -d); npm pack @civitai/app-sdk --pack-destination "$T" --silent >/dev/null
tar -xzf "$T"/*.tgz -C "$T"
grep -rl 'imageUrls'  "$T/package/dist"    # control: must hit
grep -rl 'textOutputs' "$T/package/"       # must be empty until rank 1 lands

# the docs half (expect ZERO under apps/)
D=/home/zach/workspace/civit/civitai-developer-docs
git -C "$D" grep -c 'promptEnhancement' origin/main -- apps
```
