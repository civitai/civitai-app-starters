---
'@civitai/components': patch
---

README: correct the "exactly two exports" claim. The `exports` map has 100 keys, and three of
them are CSS (`./styles.css`, `./utilities.css`, `./bootstrap-compat.css`) — two of which this
same README documents further down. The true constraint is unchanged and is what the sentence
now says: no CSS subpath is per-component.
