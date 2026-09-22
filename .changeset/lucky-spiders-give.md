---
'@civitai/components': minor
---

Add the first civitai.com vocabulary elements: `<civitai-avatar>` (initials
fallback, cosmetic frame), `<civitai-rating-badge>` (the `g`/`pg`/`pg13`/`r`/`x`
ladder, spelled as the site already spells it) and `<civitai-tag>` (the votable
tag pill, emitting `vote` with `{ name, vote }`).

They ship in a second CDN bundle, `site-elements.js`, which is the generic kit
plus these — load one bundle or the other, never both. Two disjoint bundles
would each carry their own 8.5 kB of Lit, and a page with a tag in it wants
buttons too.

These elements are presentational: state in as attributes, intent out as an
event. Nothing here talks to the host.
