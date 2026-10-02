---
"@civitai/components": patch
"@civitai/blocks-react": patch
---

docs: the "default = light" claim is false under @civitai/theme's dark base

Both packages document the unthemed default, and both descriptions become wrong
the moment `@civitai/theme@0.5.0` ships. They are consumer-facing in the strict
sense — `MARKUP.md` is `@civitai/components`' self-declared canonical contract,
`README.md` is its npm page, and the `@civitai/blocks-react` JSDoc ships inside
the published `.d.ts` — so leaving them would have published a default that
contradicts the one the tokens emit.

- `@civitai/components` `MARKUP.md` / `README.md`: the default is now the **dark**
  palette and nothing consults the OS preference. Only `light` and `dark` select a
  token block; any other value selects none and inherits the dark base. Both say
  what the previous behaviour was, so a reader upgrading can tell which world
  their own code was written for, and that an explicit `data-theme` added *only*
  to defeat the OS can now be dropped.
- `@civitai/blocks-react` `src/ui/styles.ts`: the JSDoc asserted the deleted
  `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` as live
  fact, and opened with a 🔴 warning that reading "no `data-theme`" as non-light
  "is how the explicit attribute gets deleted" — exactly backwards once the base
  is dark. Replaced, with the reversal stated rather than quietly rewritten.
- `@civitai/blocks-react` `src/ui/BlockGate.tsx`: `readDocumentTheme`'s doc called
  the explicit wrapper attribute "load-bearing" because only it could stop the OS
  deciding. That reason is gone. The attribute **stays**, and the doc now gives
  the one difference that survives: the read is `document.documentElement`, while
  inheritance takes the nearest `[data-theme]` ancestor — the same on a direct
  load, but that is a property of the deployment, not of the code.

No behaviour change in either package; prose and JSDoc only. A patch release is
needed because the published artifacts *are* these documents.
