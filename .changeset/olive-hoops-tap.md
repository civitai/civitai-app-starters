---
'@civitai/components': minor
---

A utility layer, at `./utilities.css`. Elements cover the components; they
cannot cover the markup between them — the row, the gap, the margin — and this
package had no answer for that, so every hand-HTML author wrote their own. An
API review put a number on it: of the 205 Bootstrap classes one real consumer
uses, **135 are layout and spacing**, none of which an element can replace.

217 classes under a `ci-` prefix, generated from `src/utilities.spec.ts` and
spending the same tokens the elements do: colour utilities name
`--civitai-color-*` rather than a shade, so they follow the theme into dark
mode. Spacing is a scale of its own, `--civitai-space-0` through `-6`, because
Mantine expresses spacing per component and `@civitai/theme` has nothing to
derive a ramp from. The grid is CSS Grid rather than floats or percentages.

`./bootstrap-compat.css` ships alongside it and is **transitional**: Bootstrap's
own class names mapped onto the same declarations, keeping Bootstrap's
breakpoints rather than ours, so a page adopts the tokens before it touches its
markup. A browser test asserts all 214 aliases compute identically to the `ci-`
utility behind them, which is what makes deleting a rule safe once its markup
moves.
