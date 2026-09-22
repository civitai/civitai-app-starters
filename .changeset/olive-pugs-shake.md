---
'@civitai/components': minor
---

Add custom elements: `<civitai-button>`, `<civitai-text-input>` and
`<civitai-segmented-control>`.

Behaviour has only ever existed in the React layer — `MARKUP.md` tells
hand-HTML authors to implement the segmented control's keyboard handling
themselves — so the two Svelte starters got a stylesheet and homework. These
elements carry the behaviour with the style, identically in plain HTML, Svelte,
Vue and React.

New entry points, all additive: `./register`, `./<tag>`, `./<tag>/define` and
`./internals`. `./styles.css` and the `.` entry are untouched, and the `.` entry
still pulls no renderer, so nothing an existing consumer imports changes.

All three are form-associated, which gives back what a control inside a shadow
root otherwise loses: `type="submit"`/`type="reset"` on the button, `FormData`
round-tripping and Enter-to-submit on the text input, and `form.reset()` on all
of them. `change` is re-dispatched across the boundary, because it is
`composed: false` and would otherwise never reach a consumer's listener.

`<civitai-segmented-control>` implements the WAI-ARIA roving tabindex: the group
is one tab stop, arrows wrap across enabled segments, Home/End jump to the ends,
and selection follows focus. It is a `radiogroup` only — the React binding's
`mode="tabs"` is deliberately absent, because a tab's `aria-controls` is an
IDREF and an IDREF cannot reach a light-DOM panel from inside a shadow root.
axe flags it, so tabs get their own element rather than a broken mode here.

One deliberate difference from the React binding: `error` also makes the field
*invalid* (`setValidity({ customError })`), so a form will not submit while a
message is showing. The React binding only draws it, which contradicts the
`aria-invalid` it sets. Clear `error` when the problem is fixed.

Computed-style parity against the attribute markup each element replaces is
asserted across every variant, size and theme.
