---
"@civitai/blocks-react": minor
---

Add form primitives to the `@civitai/blocks-react/ui` component pack: `Slider`, `NumberInput`, `Select`, and `Collapse`.

These are the controls block apps (e.g. Custom Generators) previously hand-rolled on native elements; the pack versions let those apps drop the hand-rolls and get consistent theming + accessibility for free.

- **`Slider`** — labeled range control (`value: number`, `onChange`, `min`/`max`/`step`, `disabled`, `showValue`). Native `input[type="range"]` — keyboard-operable, implicit `role="slider"`; accent tracks `--ci-color-primary`. (The LoRA-weights control.)
- **`NumberInput`** — labeled numeric input (`value: number | null`, `onChange`, `min`/`max`/`step`, `disabled`). Rejects non-numeric input (never emits `NaN`), clamps to `[min, max]` on blur, empty → `null`. (steps / cfg / quantity params.)
- **`Select`** — labeled dropdown (`value: string`, `onChange`, `options: {value,label,disabled}[]` or `<option>` children, `placeholder`, `disabled`). (sampler / base-model / workflow-type.)
- **`Collapse`** — controlled disclosure (`open` + `onOpenChange`, `title`, `disabled`) for the "advanced params reveal" — `aria-expanded`/`aria-controls` wired, content region `hidden` when closed. (Optional extra.)

All are controlled, ref-forwarded, and follow the pack's conventions: `useBlocksStyles()` auto-injection, `data-civitai-ui="…"` styling hooks, `data-theme` light/dark theming, and the shared `label` / `description` / `error` / `required` a11y wiring (`htmlFor`/`id`, `aria-describedby`, `aria-invalid`, `role="alert"`). Exported from `@civitai/blocks-react/ui`. No SDK change — UI only.
