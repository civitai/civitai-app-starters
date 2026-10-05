---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Mirror the host's workflow-snapshot fields, and add the training-publish pair.

**`BlockWorkflowSnapshot` now types every field the host emits (#524).** Five
fields the host has sent for several releases were missing from the SDK type, so
a block could only read them through a cast: `modelSubstitutions`,
`textOutputs`, `textOutputWithheld`, `toolCalls` and `stepOutputs`.
`snapshot.textOutputs` — the reply of a `chat-completion` step — now
type-checks without one. New exported types: `BlockModelSubstitution`,
`ModelSubstitutionReason`, `BlockStepToolCall`.

**Training-publish fields (host support pending).** `trainedEpochs` on
`BlockWorkflowSnapshot` lists the epochs of a pass-through `training` /
`imageResourceTraining` step that produced a checkpoint; the checkpoint itself
is deliberately not exposed. The viewer publishes one by being navigated
(`useCivitaiNavigate`, `scope: 'site'`) to
`models/train/from-orchestrator?workflowId=<id>&epoch=<n>`. `publishedModel`
(on both `BlockWorkflowSnapshot` and `AppWorkflow`) then reports the resulting
model. Both are optional and absent on hosts that do not emit them yet. New
exported types: `BlockTrainedEpoch`, `BlockPublishedModel`.

**Validator (`@civitai/blocks-react`).** The inbound snapshot and `AppWorkflow`
guards now shape-check every new field when present, on the same terms as
`autoClaim`: absent is valid, present-but-malformed drops the message. The
open-ended string unions (`modelSubstitutions[].reason`, `trainedEpochs[].$type`)
are checked as strings rather than against today's members, so a host adding a
value does not drop polls in already-shipped blocks.

**Mock host.** A pass-through `training` / `imageResourceTraining` body now
succeeds with `trainedEpochs` (new `generation.trainedEpochs` knob, default `1`;
`0` omits the field) and, when `generation.trainingPublishedModel` is set, a
`publishedModel`. Only those two `$type`s get them. The mock never fabricates a
checkpoint url, and it does not simulate the real `maxBuzz` timeout.

**Docs.** `training` and `imageResourceTraining` were described as
platform-internal, "not an invitation". The host explicitly allows both on the
pass-through arm; the README and the orchestrator docblocks now say so, with the
bound that applies (`maxBuzz`, 1–250, is also the step timeout in seconds, so a
real training run will typically not fit).
