---
"@civitai/blocks-react": patch
---

docs: two README claims the shipped tokens had already falsified

**Default theme.** The auto-theming bullet told authors that with no `data-theme`
attribute the components render **light**, "matching the starter palette".
`@civitai/theme@0.5.0` flipped the base to **dark** and removed the
OS-preference override, so both halves have been false since that release.
Corrected by reusing the wording the canonical contract already carries
(`@civitai/components`' `MARKUP.md`): default (no attribute) is the dark
palette, and nothing consults the OS preference.

**Component-pack description.** The W6 section advertised "8px radius, the blue
primary, the dark/light surfaces". The shipped token is
`--civitai-radius: 0.25rem` — **4px** — and has been since `0.35.0`; the
package's own `src/ui/styles.ts` already records the `8px→4px` break. The
parenthetical is cut rather than re-specified, so it cannot go stale against
another package's tokens a third time.

Prose only — no behaviour change. A patch release is needed because the
published artifact *is* the document: both claims are live on the npm page for
`0.63.1`.
