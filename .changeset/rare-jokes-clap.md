---
'@civitai/components': minor
---

Port six presentational primitives to elements: `<civitai-card>`,
`<civitai-stack>`, `<civitai-group>`, `<civitai-badge>`, `<civitai-loader>`
and `<civitai-alert>`.

Computed-style parity against the attribute markup each replaces is asserted
across every variant, size, colour and both themes — 58 cases.

Two fidelity fixes fell out of that. The shared `:host` baseline was setting
`line-height: 1`, which the legacy `[data-civitai-ui]` rule never did, so
every element whose counterpart inherited a line height was being relaid out;
the baseline now carries exactly what that rule carries. And the loader's ring
is the host's own box rather than an inline child's, so it keeps the legacy
`inline-block` box instead of gaining descender space beneath it.

`<civitai-alert>` names its heading `heading`, not `title`: `title` is a
global attribute and would render a browser tooltip over the whole alert.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
