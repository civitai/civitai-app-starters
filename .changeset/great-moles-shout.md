---
'@civitai/components': minor
---

Add `<civitai-menu>` with `<civitai-menu-item>` and `<civitai-menu-label>` — the
kebab popup the site uses on tags and on the image toolbar. It sits in the top
layer via the Popover API, which is what lets it escape a clipping ancestor;
arrow keys walk the items, Escape and a choice both return focus to the trigger,
and a disabled item is announced rather than skipped.

`<civitai-tag>` gains `confidence` (0–1 from the tagger), drawn as a bar behind
the label and tinted with the rating. It is separate from `score`, which is the
vote total.
