---
'@civitai/app-sdk': patch
---

Docs: stop the `imageGen` row of the step-type/builder table in the shipped
`README.md` from carrying a hand-maintained engine list, and fix its
characterisation.

The row read:

> Closed-source image-gen APIs — Nano Banana, Gemini, GPT-Image, Flux.1 Kontext,
> Flux.2, Seedream, Grok, fal. `IMAGE_GEN_ENGINES` lists the engines.

Two things were false. **The list was incomplete** — the live catalog has 12
engines (`comfy`, `fal`, `flux1-kontext`, `flux2`, `gemini`, `google`, `grok`,
`openai`, `qwen`, `sdcpp`, `seedream`, `wan`, per
`components.schemas.ImageGenInput.discriminator.mapping`), the prose named
roughly 8, and it was already non-exhaustive before `qwen` existed. **The
characterisation was wrong** — `sdcpp` is `SDCpp (self-hosted diffusion)` and
`comfy` is a Comfy graph run as an engine, neither of which is a closed-source
third-party API.

🔴 **The fix is deliberately NOT to make the list exhaustive.** An exhaustive
prose list would be a third hand-maintained copy of an enumeration that already
has a source of truth (`IMAGE_GEN_ENGINES`) and a CI drift-gate
(`pnpm check:catalogs`, which pins the catalog to the live orchestrator spec).
It would rot on the very next upstream engine addition and nothing would catch
it — the drift-check reads the catalog, not the README. That is exactly the
class that added `qwen` to the catalog while leaving this row stale.

So the row is now explicitly illustrative (`e.g.`), names `IMAGE_GEN_ENGINES` as
the authority, and says in-line that it is not exhaustive — a claim that stays
true however the catalog grows.
