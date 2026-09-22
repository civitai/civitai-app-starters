---
'@civitai/components': minor
---

Publish a CDN bundle and the custom-elements manifest.

`elements.js` at the package root makes the one-script-tag form work: jsDelivr
ignores `exports`, so a subpath like `/register` 404s there — the same reason
`styles.css` is copied to the root. The build fails over **25 kB gzip**, which
is the budget the whole element set has to live within; three elements plus Lit
and the tokens currently come to about 11 kB.

`custom-elements.json` is the published contract — tags, attributes,
properties, parts and slots. It is derived from the element sources rather than
JSDoc: tag names come from `defineElement(TAG, …)`, parts and slots from the
Lit templates. Nothing is restated, so nothing can drift, and a test fails if
the manifest stops matching what the package registers.
