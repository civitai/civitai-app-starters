---
'@civitai/components': patch
---

README: drop the 68-line `#358` CSS-split pricing memo from the published tarball.

The tables, the two 🔴 row-attribution callouts and the `MEASURE_CARRIERS=1`
reproduction recipe priced an open issue for maintainers, not consumers — the
slices they measure are excluded from the tarball and nothing imports them. The
consumer-facing consequence is unchanged and still stated in full: there is no
supported way to import one component's rules. No API or behaviour change.
