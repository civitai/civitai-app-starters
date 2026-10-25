---
'@civitai/app-sdk': minor
---

Add `checkComfyGraph(entry)` to `@civitai/app-sdk/blocks`: a pure, offline check that a workflow file entry (what `useResourceFile` returns) can run as an inline `customComfy` graph, before any Buzz is spent. It returns `{ runnable: true }` or `{ runnable: false, reasons }`, with a closed set of reason codes: `not-api-format`, `custom-nodes` (classes outside a core-node list generated from a pinned ComfyUI commit, plus `cnr_id` pack ids), `model-filenames` (loader inputs holding a filename instead of an AIR), `too-many-nodes` (over 300) and `too-large` (over 262144). Also exports the inline caps as `BLOCK_INLINE_COMFY_MAX_NODES` and `BLOCK_INLINE_COMFY_MAX_GRAPH_BYTES`, and the generated `COMFY_CORE_NODE_CLASSES` / `COMFY_CORE_NODES_COMMIT`. A Comfy estimate is a ceiling, never a price. No new dependencies.
