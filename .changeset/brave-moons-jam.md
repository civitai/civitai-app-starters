---
'@civitai/components': minor
'@civitai/components-react': minor
---

Three more: `<civitai-button-group>`, `<civitai-input-group>` and
`<civitai-confirm-dialog>`.

The two grouping elements are **light DOM**, for a reason worth recording:
joining controls means reaching their `::part(button)` and `::part(control)`,
and a part crosses exactly one shadow boundary. From the document those parts
are reachable; from a shadow root the controls had been slotted into they are
not. So the grouping element styles children the page owns.

`<civitai-confirm-dialog>` extends `<civitai-modal>` — the focus trap, the top
layer and Escape all come from one implementation, and the modal grew two
render hooks for it. `await dialog.ask()` resolves `true`, `false` on cancel,
and `false` on a dismissal, so a caller is never left waiting on a promise that
will not settle. A destructive confirmation lands focus on Cancel.

The React binding map now follows the superclass chain. That fixed a gap nobody
had noticed: `<civitai-switch>` extends `<civitai-checkbox>` rather than the
field base directly, so it had been generated **without** `onChange` or
`onInvalid` despite dispatching both.
