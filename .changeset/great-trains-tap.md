---
'@civitai/components-react': minor
---

Add `@civitai/components-react/elements` — React bindings for the custom
elements.

`ButtonElement`, `TextInputElement` and `SegmentedControlElement` are separate
from the existing `Button`/`TextInput`/`SegmentedControl`, which keep rendering
the attribute markup. Nothing an existing consumer imports changes, and the `.`
entry still reaches neither Lit nor an element module — a test asserts it.

Props are assigned as properties after mount rather than left to React's own
prop handling. React decides between attribute and property by whether the
element has upgraded yet, so an un-upgraded element takes a boolean as the
string `""` and Lit's converter never runs — `loading` would be truthy but not
`true`. Assigning directly behaves the same on React 18 and 19, and is the only
way to pass the segmented control's `data` array at all.
