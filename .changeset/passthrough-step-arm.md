---
'@civitai/app-sdk': minor
---

`WorkflowBody` gains the pass-through arm of `kind: 'step'` — `WorkflowBodyPassThroughStep`.

The host shipped a second arm on the `kind: 'step'` wire member (`blockPassThroughStepBodySchema`): a body that OMITS `step`, names an orchestrator `$type` directly, and has the host forward `input` unmodified. The SDK did not type it, and **the SDK was the only thing stopping a block from authoring that body** — `@civitai/blocks-react`'s transport validator is inbound-only, so nothing validates an outbound body at runtime. A block author who wanted to reach an unregistered orchestrator step had to cast away `WorkflowBody`, which is exactly the shape that goes stale silently.

**The type.** A fourth union member, `WorkflowBodyPassThroughStep`:

```ts
{
  kind: 'step';
  step?: undefined;            // the ARM DISCRIMINATOR — omit the key
  $type: string;               // orchestrator step type, 1…64 chars
  input: Record<string, unknown>;   // forwarded UNMODIFIED, ≤256 KB serialized
  maxBuzz: number;             // integer 1…250, and ALSO the step timeout in seconds
}
```

`step` is typed `step?: undefined` rather than omitted, so omitting it satisfies the type while setting it is a compile error. The wire body carries no `step` key at all — JSON cannot express `undefined`, and the host's own fixture omits it. (The host spells the arm `step: z.undefined()` because zod's discriminated union needs a definite discriminator value per option; that is a schema-construction detail, not a payload one. Confirmed against production: a `blocks.submitWorkflow` with `{"kind":"step","$type":"imageBackgroundRemoval","input":{…},"maxBuzz":10}` and no `step` key was accepted and billed.)

**ADDITIVE, hence `minor`.** `WorkflowBodyStep` is untouched — every deployed block and every published SDK body still satisfies the union and still behaves identically. Consumers that `switch` exhaustively over `kind` are unaffected too, since the new member shares `kind: 'step'`. What DOES change for a consumer is that `kind === 'step'` no longer narrows to one object type: `step` reads as `string | undefined` there, and `params` is not reachable until you narrow again with `'$type' in body`.

**Two docstrings were wrong the moment this arm existed, and are corrected here.** `WorkflowBodyStep`'s docblock and its `step` field both claimed, unqualified, that *"an unregistered id is rejected fail-closed at the schema, before any translator, any spend reservation, or any orchestrator call."* That is true of the REGISTRY arm only — on the pass-through arm an id the registry has never heard of is the supported case. Both sentences are now scoped to the registry arm and cross-reference the new member.

**What the pass-through arm gives up, documented on the type** so it reads as a decision rather than an oversight: no per-step `.strict()` param schema (`input` is opaque, and the orchestrator's own validation runs after the spend reservation), no moderation posture or prompt audit (moderation moved to the publish boundary), no `urn:air:` resource scan, and no `billingMode`/price invariant. What still bounds it is a denylist of platform-internal `$type`s (scanners, moderation classifiers, hashing/model ingestion, web egress — refused by the host router before any spend), the `$type` and `input` size caps, and `maxBuzz`, which the host stamps as `stepTimeoutSeconds` so the ceiling is physically enforced rather than asserted.

`@civitai/blocks-react` is deliberately NOT bumped: it does not re-export the `WorkflowBody*` types, and its only change here is a doc comment in `mockHost.ts` whose account-preference claim enumerated the host schemas by name.
