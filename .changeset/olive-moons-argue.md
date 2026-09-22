---
'@civitai/components': minor
---

One field contract, not four. `<civitai-checkbox>`, `<civitai-radio-group>` and
`<civitai-segmented-control>` each carried their own `ElementInternals` plumbing;
`<civitai-slider>` re-rendered the label, description and error chrome by hand.
All four now sit on `CivitaiField`, which grew three hooks for the cases that
genuinely differ — `formValue()`, `missing` and `missingMessage`.

The visible part: `<civitai-segmented-control>` gains `label`, `description`,
`error`, `required` and `disabled`, with the `label` and `error` parts and the
`reportValidity()` the others already had. Previously `required` on it set no
validity at all, so a form submitted regardless. Checkbox and radio group gain
`reportValidity()`.

**Breaking — `select` carries a value, not an element.** `<civitai-menu>`'s
`select` detail was `{ item: HTMLElement }`, which no framework outside the DOM
can receive: it cannot be serialized to Blazor, and React handlers had to read
`textContent` back off the node. It is now `{ value: string }`, and
`<civitai-menu-item>` takes a `value` attribute that falls back to the item's own
text the way an `<option>` does.

**Breaking — two parts renamed.** `part="title"` on alert, modal and toast is now
`part="heading"`, matching the property that fills it. `part="trigger"` on
collapse is now `part="button"`, matching every other element that renders one.

`<civitai-tabs>` marks `change` `composed`, so it escapes a consumer's shadow
root rather than stopping at it. `<civitai-image>` dispatches `load` and `error`
under literal names; the computed one left `custom-elements.json` with an event
that had no `name` field, and the manifest now describes all 11 events.
