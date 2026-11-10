---
'@civitai/sdk': patch
---

Docs: `app.subListings.upsert`'s `itemKey` is the key of a document the viewer authored in a `shared` document-storage collection whose `write` is `own` or `anyone`, not a legacy shared-storage row. The README and the `SubListingUpsertInput.itemKey` TSDoc now say the key is the document's key (not its collection), at most 64 characters, looked up in the production namespace only and unique across the app's item collections (a key two of them hold reads as `item_not_found`). An app whose approved manifest declares no such collection still resolves its old shared-storage rows, which can no longer be created since civitai.com removed the legacy shared store on 2026-11-10: https://developer.civitai.com/apps/guide/storage#moving-from-the-legacy-stores. No code change.
