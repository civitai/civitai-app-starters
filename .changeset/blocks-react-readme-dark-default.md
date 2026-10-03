---
"@civitai/blocks-react": patch
"@civitai/theme": patch
---

docs: three README claims the shipped tokens had already falsified

**`@civitai/blocks-react` — default theme.** The auto-theming bullet told authors
that with no `data-theme` attribute the components render **light**, "matching
the starter palette". `@civitai/theme@0.5.0` flipped the base to **dark** and
removed the OS-preference override, so both halves have been false since that
release. Corrected by reusing the wording the canonical contract already carries
(`@civitai/components`' `MARKUP.md`): default (no attribute) is the dark palette,
and nothing consults the OS preference.

**`@civitai/blocks-react` — component-pack description.** The W6 section
advertised "8px radius, the blue primary, the dark/light surfaces". The shipped
token is `--civitai-radius: 0.25rem` — **4px** — and has been since `0.35.0`; the
package's own `src/ui/styles.ts` already records the `8px→4px` break. The
parenthetical is cut rather than re-specified, so it cannot go stale against
another package's tokens a third time.

**`@civitai/theme` — the opening description.** The first bullet described
`dist/tokens.css` as "a `:root` + `[data-theme='light'|'dark']` + **OS-preference**
stylesheet". The same file already says the opposite twice — *"Dark is the base,
and nothing here consults the OS"*, and *"There is deliberately no
`@media (prefers-color-scheme: …)` block, in either direction"* — and the shipped
`dist/tokens.css` contains zero such at-rules. The two words are cut; the
accurate explanation below them is left to stand.

Prose only — no behaviour change in either package. Patch releases are needed
because the published artifacts *are* these documents: all three claims are live
in the published READMEs that ship inside the `0.63.1` and `0.5.1` tarballs.
