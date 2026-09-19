---
'@civitai/components': minor
---

The image card, in parts: `<civitai-media-card>` (media plus `top-start`,
`top-end` and `bottom` overlay slots over a scrim), `<civitai-reaction>`
(emoji, abbreviated count, pressed state, emits `react`) and
`<civitai-action-button>` (a circle that expands to its label on hover or
focus, crossfading to a second icon in an inverted chip when it opens).

Two details that are easy to get wrong and are pinned by tests: the overlays are
SIBLINGS of the media link rather than children, because a menu button inside an
anchor is invalid and unreachable by keyboard; and a control sitting on the media
takes its contrast from the image, not the page, so the card overrides it to the
scheme-independent ramp instead of letting it follow the theme.

The `top-end` corner stacks vertically, since that is where the site hangs the
action button under the kebab; `top-start` and `bottom` stay rows.

Counts read the way civitai.com's own `abbreviateNumber` writes them —
`13100` is `13.1k`, uppercased in CSS.
