---
'@civitai/blocks-react': minor
---

Live host (`createLiveHost`, used by `dev:live`) now SERVES the resource pickers locally instead of stubbing them. On `OPEN_CHECKPOINT_PICKER` / `OPEN_RESOURCE_PICKER` it opens an in-harness catalog-browser overlay (real models fetched with the dev block token via `/api/v1/blocks/models`, public `/api/v1/models` fallback), the dev picks one, and the host replies with a real `BlockCheckpointInfo` / `BlockResourceInfo` in the exact shape the production host returns — so `useCheckpointPicker()` / `useResourcePicker()` are byte-identical in `dev:live` and in production (protocol fidelity, not chrome fidelity). Honors the request filters (`baseModelGroup`/ecosystem, `resourceType`, `currentVersionId` pre-highlight). A pick is discovery only — the server re-validates and prices every id at estimate/submit. Production is unchanged; this only fills in a local dev-host capability.
