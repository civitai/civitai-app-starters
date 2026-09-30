---
'@civitai/blocks-react': patch
---

docs: teach the UNCONSTRAINED resource pick as the default

`baseModelGroup` is an optional FILTER on `useResourcePicker` — the host hides
every resource outside the family it is given — and the SDK has always
implemented it that way. But the `@example` blocks and README examples passed a
hardcoded `'SDXL'`, and those examples are generated into
developer.civitai.com `apps/reference/hooks` — the README's per-hook `tsx` fence
first, the hook's `@example` JSDoc only as its fallback — which AI coding agents
fetch and copy verbatim. Apps shipped with the picker pinned to one ecosystem, so
viewers' own valid LoRAs were invisible to them and the picker read as empty or
broken.

No runtime behaviour changes. The examples now show `open({ resourceType:
'LORA' })` as the default and the derived `baseModelGroup: checkpoint.baseModel`
form (the shape the CLI's `page-money` scaffold already used) as the secondary
case, and the `baseModelGroup` JSDoc on both pickers says what a literal costs.
`tests/guards/picker-example-ecosystem-literals.test.mjs` fails the build if a
picker example passes `baseModelGroup` a string literal again.

Two doc-accuracy fixes and two guard holes closed on review:

- The `''` note said the host resolves it to the ecosystem key `Other`, "so it
  narrows rather than widens". That is true on a **model slot** only — on a
  **page** the host drops a zero-length value and `''` behaves exactly like
  omitting it. The advice (never pass `''`) holds on both hosts; only the
  mechanism was wrong, and it lands verbatim in the published hook description.
- `useResourcePicker`'s JSDoc pointed at `useBlockContext().context.checkpoint
  ?.baseModel`, which does not exist on the only host that answers this hook:
  `checkpoint` is a `ModelSlotContext` field, `BlockContext` is a union with no
  index signature, and `OPEN_RESOURCE_PICKER` is page-only. The page-surface
  source is `BlockResourceInfo.baseModel` — the `baseModel` of a Checkpoint a
  prior `useResourcePicker({ resourceType: 'Checkpoint' })` returned — and the
  examples now show that, self-contained, instead of a bare undeclared
  `checkpoint`.
- The guard's markdown fence walker never recorded a fence whose info string was
  a language it does not scan (bash, json, html, sh, diff, …), so that fence's
  own closer opened a phantom block and swallowed the next real `ts`/`tsx` pair
  whole. Measured over the sweep corpus, **15** code fences were invisible to the
  scanner — including this package's own README quick-start, behind the bash
  install snippet above it — and a literal in any of them passed as clean. Now
  every fence opens a block; the count is 0.
- The detector was a per-line `baseModelGroup:\s*['"]` regex, which missed a
  value on the next line, `checkpoint?.baseModel ?? 'SDXL'`, a ternary, `('SDXL')`
  / `String('SDXL')`, and a quoted `'baseModelGroup':` key (the last not even
  counted, so it could not hold the coverage floor up). It now reads the value
  expression across lines out of a comment-stripped copy, so a literal in a
  trailing comment is no longer a false positive and an interpolated template
  literal stays legal.
- `useResourcePicker`'s two `@example` blocks are deliberately ordered
  constrained-then-unconstrained: the docs generator overwrites `jsdocExample` on
  each tag, so the LAST one is what gets published when the README fence is
  unavailable.
