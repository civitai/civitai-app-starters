---
'@civitai/components': minor
'@civitai/components-react': minor
---

`<civitai-nav-list>` and `<civitai-nav-item>` — navigation primitives rather
than an app shell, because the reusable part of a sidebar is the nav tree's
behaviour and not the chrome around it. Lay the page out with the utilities.

`current` on the list is an `href`, matched exactly. It marks that item and
opens every group above it, however deep — the part sidebars usually get
wrong, landing on a nested route with the section containing it still
collapsed. An item is a link when it has an `href` and a disclosure when it
has children; an `href` *with* children is still a disclosure, never an anchor
that also toggles. Depth is counted by the item itself, so nesting indents
without anyone tracking levels in markup.

Icons stay slotted. The package ships no icon set, so an app brings its own and
pays for nothing it does not use.
