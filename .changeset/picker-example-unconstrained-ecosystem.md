---
'@civitai/blocks-react': patch
---

docs: teach the UNCONSTRAINED resource pick as the default

`baseModelGroup` is an optional FILTER on `useResourcePicker` — the host hides
every resource outside the family it is given — and the SDK has always
implemented it that way. But the `@example` blocks and README examples passed a
hardcoded `'SDXL'`, and those `@example` blocks are generated into
`developer.civitai.com/apps/reference/hooks.md`, which AI coding agents fetch and
copy verbatim. Apps shipped with the picker pinned to one ecosystem, so viewers'
own valid LoRAs were invisible to them and the picker read as empty or broken.

No runtime behaviour changes. The examples now show `open({ resourceType:
'LORA' })` as the default and the derived `baseModelGroup: checkpoint.baseModel`
form (the shape the CLI's `page-money` scaffold already used) as the secondary
case, and the `baseModelGroup` JSDoc on both pickers says what a literal costs.
`tests/guards/picker-example-ecosystem-literals.test.mjs` fails the build if a
picker example passes `baseModelGroup` a string literal again.
