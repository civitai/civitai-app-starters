---
'@civitai/app-sdk': patch
---

**`defineBlock` now reports the right error for a rejected `analytics` property declaration.** A property declaration is one of three shapes selected by its `type`, and a rejected one used to be reported with the first shape's rule whichever `type` it named. It is now reported against the shape its `type` names:

- `{ type: 'number', min: 0 }` and `{ type: 'boolean', label: 'x' }` used to say `…values is required`. They now name the unknown key: `…min is not a known property when \`type\` is "number"`.
- `{ type: 'number', values: ['1'] }` used to say `…type must be equal to constant`. It now says `…values is not a known property when \`type\` is "number"`.
- An unknown key on an `enum` declaration keeps its field and now ends `when \`type\` is "enum"` instead of `here`.

`BlockManifestError.field` moves with the message in the first two cases (to the offending key). **No verdict changes:** every manifest is accepted or rejected exactly as before, and every other message is unchanged.
