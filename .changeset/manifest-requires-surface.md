---
'@civitai/app-sdk': minor
---

BREAKING (a `0.x` minor): `defineBlock` now refuses a manifest that declares no surface. A manifest must declare a `page` object (a full-page app) or a non-empty `targets` array (a model-page slot app), as civitai.com already requires at submit. The re-vendored canonical App Block manifest schema carries the rule, and the error names both fixes:

> manifest must declare at least one surface: add a "page" object for a full-page app (e.g. "page": { "path": "/", "title": "My App" }), or a non-empty "targets" array for a model-page slot app (e.g. "targets": [{ "slotId": "model.sidebar_top" }])

The same re-vendor declares the optional `bugs` field, a public issue-tracker or support link (an `https://` URL string, at most 200 characters), now typed on the manifest. A manifest that already carried a `bugs` key in another shape, such as npm's `{ url, email }` object, is refused.
