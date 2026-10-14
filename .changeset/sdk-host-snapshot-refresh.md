---
'@civitai/sdk': patch
---

The host reply ledger is regenerated from a host snapshot that declares every request's
reply keys, so no request type is left to guess its reply shape from the payload.

- Eight replies whose keys were unknown now have them: `CREATE_POST_FROM_APP`,
  `PREPARE_TRAINING_DATASET`, `PUBLISH_GENERATION_OUTPUTS` and `SET_COLLECTION_FOLLOW`
  (nested under `result`), `ESTIMATE_WORKFLOW_BATCH` (`aggregate`, `snapshots`),
  `OPEN_IMAGE_PICKER` (`selected`, `selectedImages`), and `RUN_CONFIRMED_STEP` and
  `RUN_TRAINING` (`snapshot`). Reply names and framing are unchanged, and a reply in the
  shape the host sends resolves exactly as before.
- A success reply to one of the four `result` types that carries no `result` now rejects
  with `BridgeError` `malformed` ("reply carried no result") instead of resolving its
  bare fields. For `host.publishGenerationOutputs()` it already rejected `malformed`;
  only the message changes in that case.
