---
'@civitai/app-sdk': minor
---

Add `WorkflowBodyTextToImage.sourceImages?: BlockSourceImage[]` — multi-image conditioning for App Blocks generations — and deprecate the singular `sourceImage`.

Mirrors civitai/civitai's `blockTextToImageBodySchema.sourceImages` (`z.array(blockSourceImageSchema).min(1).max(BLOCK_SOURCE_IMAGES_WIRE_MAX)`). The element type is unchanged (`{ url, width, height }`, all required), so an existing `sourceImage` value drops straight into a 1-element array.

- **`sourceImage` stays, deprecated.** It is a permanent alias — every deployed block and the published developer docs ship it, and the server normalizes it into a 1-element array so both forms produce a byte-identical generation. Only the JSDoc changed (`@deprecated` → `sourceImages`); the type is untouched.
- **The maximum count is PER-ECOSYSTEM, not a constant** — derived server-side from the checkpoint's own generation-graph `images` node: SD-family / Flux.1 Kontext / Boogu / MAI **1**; Qwen / Qwen2 / MageFlow **3**; Reve / HiDream-O1 **4**; WanImage **5**; Flux.2 / Flux.2 Klein / OpenAI / NanoBanana / Seedream / Grok **7**. Over-cap is rejected, never silently truncated. A flat wire bound of 10 rejects an oversized array before parse; it is not the product cap.
- **Every element is validated individually** (Civitai-hosted https URL + 64–2048 dimensions) — no "first element only" path. An empty array is rejected (omit the field for text-to-image). Source images are **PAGE-only**: the server rejects them on a model-bound token, array form included. Sending **both** `sourceImage` and `sourceImages` is rejected as ambiguous (TypeScript cannot express that mutual exclusion, so it surfaces as a server-side error).
- Also corrects a now-stale constraint in the singular field's JSDoc: img2img is not SD-family-only — edit-capable ecosystems (OpenAI / Qwen / Flux Kontext / …) route to the `img2img:edit` variant, and only an ecosystem supporting neither variant is rejected fail-closed.

🔴 **Host dependency — do not publish before civitai/civitai#3518 deploys.** The text-to-image body schema is not `.strict()`, so a host predating #3518 does not reject `sourceImages`: it silently strips the field and bills a plain text-to-image generation with no conditioning. The deprecated singular `sourceImage` works on hosts either side of #3518 and is the safe choice until it lands.
